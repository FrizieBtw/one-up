import { type AuthContext, type Client, type Deferred, Room, ServerError, matchMaker } from "colyseus";
import { schema, t, type SchemaType } from "@colyseus/schema";
import {
  CAPACITY_KEY,
  CHAT_RATE,
  EMOTE_RATE,
  HOST_GRACE_SECONDS,
  JoinError,
  LOBBY_SPAWN_RADIUS,
  LOBBY_TICK_MS,
  MAX_OPEN_PROPOSALS,
  PROPOSAL_RATE,
  RECONNECT_WINDOW_SECONDS,
  REPORT_RATE,
  clampDirection,
  clientMessages,
  createLobbyOptionsSchema,
  defaultSettings,
  filterChat,
  generateRoomCode,
  getGame,
  isValidCapacity,
  isValidSetting,
  parseSettings,
  stepLobbyPosition,
  type GameDefinition,
  type Identity,
  type ServerMessages,
} from "@stepup/shared";
import { verifyToken } from "../auth";
import { createRateLimiter } from "../rateLimit";

export const Player = schema(
  {
    id: t.string(),
    name: t.string(),
    kind: t.string(),
    ready: t.boolean(),
    connected: t.boolean(),
    x: t.float32(),
    z: t.float32(),
    dx: t.float32(),
    dz: t.float32(),
  },
  "Player",
);
export type Player = SchemaType<typeof Player>;

export const Proposal = schema(
  {
    id: t.string(),
    authorName: t.string(),
    key: t.string(),
    value: t.string(),
    votesFor: t.uint8(),
    votesAgainst: t.uint8(),
  },
  "Proposal",
);
export type Proposal = SchemaType<typeof Proposal>;

export const LobbyState = schema(
  {
    code: t.string(),
    gameId: t.string(),
    isPublic: t.boolean(),
    hostSessionId: t.string(),
    capacity: t.uint8(),
    phase: t.string().default("waiting"),
    settings: t.string().default("{}"),
    players: t.map(Player),
    proposals: t.map(Proposal),
  },
  "LobbyState",
);
export type LobbyState = SchemaType<typeof LobbyState>;

export interface LobbyMetadata {
  gameId: string;
  isPublic: boolean;
  hostName: string;
  phase: string;
}

async function uniqueRoomCode(): Promise<string> {
  for (;;) {
    const code = generateRoomCode();
    if ((await matchMaker.query({ roomId: code })).length === 0) return code;
  }
}

export class LobbyRoom extends Room<{ state: LobbyState; metadata: LobbyMetadata }> {
  state = new LobbyState();
  // Garde-fou global contre l'inondation de messages (le déplacement en envoie ~20/s au plus).
  maxMessagesPerSecond = 80;

  private game!: GameDefinition;
  private seats = new Map<string, Deferred>();
  /** Votes par proposition : identité du votant → pour (true) ou contre (false). */
  private votes = new Map<string, Map<string, boolean>>();
  private nextProposalId = 1;
  private chatAllowed = createRateLimiter(CHAT_RATE.max, CHAT_RATE.windowMs);
  private emoteAllowed = createRateLimiter(EMOTE_RATE.max, EMOTE_RATE.windowMs);
  private proposalAllowed = createRateLimiter(PROPOSAL_RATE.max, PROPOSAL_RATE.windowMs);
  private reportAllowed = createRateLimiter(REPORT_RATE.max, REPORT_RATE.windowMs);

  async onCreate(options: unknown) {
    const parsed = createLobbyOptionsSchema.safeParse(options);
    if (!parsed.success) throw new ServerError(400, "INVALID_OPTIONS");
    const { gameId, isPublic } = parsed.data;
    this.game = getGame(gameId)!;
    this.roomId = await uniqueRoomCode();
    this.maxClients = this.game.maxPlayers;

    this.state.code = this.roomId;
    this.state.gameId = gameId;
    this.state.isPublic = isPublic;
    this.state.capacity = this.maxClients;
    this.state.settings = JSON.stringify(defaultSettings(this.game));
    await this.syncMetadata();

    this.setSimulationInterval((deltaMs) => this.simulate(deltaMs / 1000), LOBBY_TICK_MS);

    this.onMessage("ready", clientMessages.ready, (client, { ready }) => {
      const player = this.state.players.get(client.sessionId);
      if (player) player.ready = ready;
    });

    // Le client n'envoie qu'une direction ; la position est simulée ici (vitesse et limites imposées).
    this.onMessage("move", clientMessages.move, (client, { x, z }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const direction = clampDirection(x, z);
      player.dx = direction.x;
      player.dz = direction.z;
    });

    this.onMessage("emote", clientMessages.emote, (client, { id }) => {
      if (!this.state.players.has(client.sessionId)) return;
      if (!this.emoteAllowed(client.sessionId)) return; // silencieux : simple anti-spam visuel
      this.announce("emote", { sessionId: client.sessionId, id });
    });

    this.onMessage("chat", clientMessages.chat, (client, { text }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (!this.chatAllowed(client.sessionId)) return this.refuse(client, "RATE_LIMITED", "Trop de messages, patientez un instant.");
      this.announce("chat", { fromId: player.id, name: player.name, text: filterChat(text), at: Date.now() });
    });

    // Les statuts « prêt » sont volontairement conservés lors d'un changement de règle (cahier des charges 5.4).
    this.onMessage("setSetting", clientMessages.setSetting, (client, { key, value }) => {
      if (!this.requireHost(client)) return;
      if (key === CAPACITY_KEY || !this.applyChange(key, value)) this.refuse(client, "INVALID", "Réglage invalide.");
    });

    this.onMessage("setCapacity", clientMessages.setCapacity, (client, { capacity }) => {
      if (!this.requireHost(client)) return;
      if (!this.applyChange(CAPACITY_KEY, capacity)) this.refuse(client, "INVALID", "Capacité invalide.");
    });

    // Propositions : tout joueur propose, tous votent, l'hôte tranche. Le vote n'applique rien.
    this.onMessage("propose", clientMessages.propose, (client, { key, value }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (!this.isValidChange(key, value)) return this.refuse(client, "INVALID", "Proposition invalide.");
      if (this.state.proposals.size >= MAX_OPEN_PROPOSALS) return this.refuse(client, "RATE_LIMITED", "Trop de propositions en attente.");
      if (!this.proposalAllowed(player.id)) return this.refuse(client, "RATE_LIMITED", "Attendez avant de proposer à nouveau.");
      const id = String(this.nextProposalId++);
      this.state.proposals.set(
        id,
        new Proposal({ id, authorName: player.name, key, value: JSON.stringify(value), votesFor: 0, votesAgainst: 0 }),
      );
      this.votes.set(id, new Map());
      this.announce("notice", { type: "proposalCreated", name: player.name, key });
    });

    this.onMessage("vote", clientMessages.vote, (client, { id, approve }) => {
      const player = this.state.players.get(client.sessionId);
      const proposal = this.state.proposals.get(id);
      const votes = this.votes.get(id);
      if (!player || !proposal || !votes) return;
      votes.set(player.id, approve); // un vote par identité, modifiable
      const approvals = [...votes.values()].filter(Boolean).length;
      proposal.votesFor = approvals;
      proposal.votesAgainst = votes.size - approvals;
    });

    this.onMessage("resolveProposal", clientMessages.resolveProposal, (client, { id, accept }) => {
      if (!this.requireHost(client)) return;
      const proposal = this.state.proposals.get(id);
      if (!proposal) return;
      this.state.proposals.delete(id);
      this.votes.delete(id);
      // La proposition a pu devenir invalide depuis (ex. capacité sous le nombre de joueurs présents).
      const applied = accept && this.applyChange(proposal.key, JSON.parse(proposal.value));
      if (accept && !applied) this.refuse(client, "INVALID", "Cette proposition n'est plus applicable.");
      this.announce("notice", { type: "proposalResolved", key: proposal.key, accepted: applied });
    });

    this.onMessage("report", clientMessages.report, (client, { sessionId, reason }) => {
      const reporter = this.state.players.get(client.sessionId);
      const target = this.state.players.get(sessionId);
      if (!reporter || !target || reporter === target) return;
      if (!this.reportAllowed(reporter.id)) return this.refuse(client, "RATE_LIMITED", "Trop de signalements, réessayez plus tard.");
      // shortcut: journalisé seulement ; à stocker en base avec outil de modération (phase 6).
      console.warn(JSON.stringify({ event: "report", room: this.roomId, reporter: reporter.id, target: target.id, targetName: target.name, reason, at: Date.now() }));
    });
  }

  async onAuth(_client: Client, _options: unknown, context: AuthContext): Promise<Identity> {
    const identity = await verifyToken(context.token);
    if (!identity) throw new ServerError(401, JoinError.Unauthorized);
    return identity;
  }

  onJoin(client: Client, _options: unknown, identity: Identity) {
    // Une identité = un seul siège. Un siège déconnecté est remplacé, un siège actif bloque le doublon.
    for (const [sessionId, existing] of this.state.players) {
      if (existing.id !== identity.id) continue;
      if (existing.connected) throw new ServerError(409, JoinError.AlreadyInRoom);
      this.state.players.delete(sessionId);
      this.seats.get(sessionId)?.reject(new Error("replaced"));
    }
    // Apparition sur un cercle autour du centre de la salle.
    const angle = Math.random() * Math.PI * 2;
    this.state.players.set(
      client.sessionId,
      new Player({
        id: identity.id,
        name: identity.name,
        kind: identity.kind,
        ready: false,
        connected: true,
        x: Math.cos(angle) * LOBBY_SPAWN_RADIUS,
        z: Math.sin(angle) * LOBBY_SPAWN_RADIUS,
        dx: 0,
        dz: 0,
      }),
    );
    this.ensureHost();
  }

  onDrop(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.connected = false;
    player.dx = 0;
    player.dz = 0;
    const seat = this.allowReconnection(client, RECONNECT_WINDOW_SECONDS);
    this.seats.set(client.sessionId, seat);
    seat.catch(() => {}); // expiration ou remplacement : onLeave fait le ménage
    // Un rechargement de page ne doit pas coûter le rôle d'hôte : transfert seulement si l'absence dure.
    this.clock.setTimeout(() => this.ensureHost(), HOST_GRACE_SECONDS * 1000);
  }

  onReconnect(client: Client) {
    this.seats.delete(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = true;
    this.ensureHost();
  }

  onLeave(client: Client) {
    this.seats.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.ensureHost();
  }

  private simulate(seconds: number) {
    for (const player of this.state.players.values()) {
      if (player.dx === 0 && player.dz === 0) continue;
      const position = { x: player.x, z: player.z };
      stepLobbyPosition(position, { x: player.dx, z: player.dz }, seconds);
      player.x = position.x;
      player.z = position.z;
    }
  }

  private isValidChange(key: string, value: unknown): boolean {
    return key === CAPACITY_KEY
      ? isValidCapacity(this.game, value, this.state.players.size)
      : isValidSetting(this.game, key, value);
  }

  /** Applique un changement de règle validé et l'annonce. Renvoie false s'il est invalide. */
  private applyChange(key: string, value: unknown): boolean {
    if (!this.isValidChange(key, value)) return false;
    if (key === CAPACITY_KEY) {
      this.maxClients = value as number;
      this.state.capacity = value as number;
      this.announce("notice", { type: "capacityChanged", capacity: value as number });
    } else {
      this.state.settings = JSON.stringify({ ...parseSettings(this.state.settings), [key]: value });
      this.announce("notice", { type: "settingChanged", key });
    }
    return true;
  }

  /**
   * Règle déterministe : si l'hôte est parti, ou déconnecté depuis plus de HOST_GRACE_SECONDS,
   * le rôle passe au joueur connecté le plus ancien (ordre d'arrivée). Un hôte qui revient après
   * le transfert ne récupère pas le rôle.
   */
  private ensureHost() {
    const current = this.state.players.get(this.state.hostSessionId);
    if (current?.connected) return;
    for (const [sessionId, player] of this.state.players) {
      if (!player.connected) continue;
      const previous = this.state.hostSessionId;
      const changed = Boolean(previous) && previous !== sessionId; // pas d'annonce pour le premier hôte
      this.state.hostSessionId = sessionId;
      void this.syncMetadata();
      if (changed) this.announce("notice", { type: "hostChanged", name: player.name });
      return;
    }
  }

  private requireHost(client: Client): boolean {
    if (client.sessionId === this.state.hostSessionId) return true;
    this.refuse(client, "FORBIDDEN", "Réservé à l'hôte.");
    return false;
  }

  private syncMetadata() {
    return this.setMetadata({
      gameId: this.state.gameId,
      isPublic: this.state.isPublic,
      hostName: this.state.players.get(this.state.hostSessionId)?.name ?? "",
      phase: this.state.phase,
    });
  }

  private refuse(client: Client, code: ServerMessages["error"]["code"], message: string) {
    client.send("error", { code, message } satisfies ServerMessages["error"]);
  }

  private announce<K extends keyof ServerMessages>(type: K, payload: ServerMessages[K]) {
    this.broadcast(type, payload);
  }
}
