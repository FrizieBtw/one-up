import { randomUUID } from "node:crypto";
import {
  type AuthContext,
  type Client,
  type Deferred,
  Room,
  ServerError,
  matchMaker,
} from "colyseus";
import { schema, t, type SchemaType } from "@colyseus/schema";
import type { Delayed } from "@colyseus/timer";
import {
  ROOM_CAPACITY,
  CHAT_RATE,
  EMOTE_RATE,
  FREE_EMOTE_IDS,
  HOST_GRACE_SECONDS,
  JoinError,
  LAUNCH_COUNTDOWN_SECONDS,
  ROOM_HALF,
  ROOM_SPAWN,
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
  isValidSetting,
  launchBlocker,
  parseSettings,
  pushApart,
  stepLobbyPosition,
  type GameDefinition,
  type Identity,
  type ServerMessages,
} from "@stepup/shared";
import { verifyToken } from "../auth";
import { BlackjackGame, BlackjackState, tuning } from "../games/blackjack";
import {
  fetchAvatar,
  fetchColor,
  fetchCosmetics,
  recordMatch,
} from "../persistence";
import { presence } from "../presence";
import { createRateLimiter } from "../rateLimit";

export const Player = schema(
  {
    id: t.string(),
    name: t.string(),
    kind: t.string(),
    ready: t.boolean(),
    connected: t.boolean(),
    avatar: t.string().default(""),
    cosmetics: t.string().default("{}"),
    color: t.string().default(""),
    x: t.float32(),
    z: t.float32(),
    dx: t.float32(),
    dz: t.float32(),
    run: t.boolean(),
    jump: t.boolean(),
    sit: t.boolean(),
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
    countdown: t.uint8().default(0),
    blackjack: t.ref(BlackjackState),
  },
  "LobbyState",
);
export type LobbyState = SchemaType<typeof LobbyState>;

/** Ce que `onAuth` transmet à `onJoin` : identité et apparence lues en base (vides pour un invité). */
interface JoinAuth extends Identity {
  avatar: string;
  cosmetics: string;
  color: string;
  ownedEmotes: string[];
}

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

export class LobbyRoom extends Room<{
  state: LobbyState;
  metadata: LobbyMetadata;
}> {
  state = new LobbyState();
  // Garde-fou global contre l'inondation de messages (le déplacement en envoie ~20/s au plus).
  maxMessagesPerSecond = 80;

  private game!: GameDefinition;
  private seats = new Map<string, Deferred>();
  /** Votes par proposition : identité du votant → pour (true) ou contre (false). */
  private votes = new Map<string, Map<string, boolean>>();
  private nextProposalId = 1;
  /** Emotes de boutique possédées, par session. Côté serveur seulement : jamais synchronisé. */
  private ownedEmotes = new Map<string, Set<string>>();
  private launchTimer: Delayed | null = null;
  /** Identités exclues par l'hôte : elles ne peuvent plus rejoindre ce salon. */
  private kicked = new Set<string>();
  /** Sièges qui ont déjà fixé leur position de départ (une seule fois). */
  private placed = new Set<string>();
  private blackjack: BlackjackGame | null = null;
  private chatAllowed = createRateLimiter(CHAT_RATE.max, CHAT_RATE.windowMs);
  private emoteAllowed = createRateLimiter(EMOTE_RATE.max, EMOTE_RATE.windowMs);
  private proposalAllowed = createRateLimiter(
    PROPOSAL_RATE.max,
    PROPOSAL_RATE.windowMs,
  );
  private reportAllowed = createRateLimiter(
    REPORT_RATE.max,
    REPORT_RATE.windowMs,
  );

  async onCreate(options: unknown) {
    const parsed = createLobbyOptionsSchema.safeParse(options);
    if (!parsed.success) throw new ServerError(400, "INVALID_OPTIONS");
    const { gameId, isPublic } = parsed.data;
    this.game = getGame(gameId)!;
    this.roomId = await uniqueRoomCode();
    this.maxClients = ROOM_CAPACITY;

    this.state.code = this.roomId;
    this.state.gameId = gameId;
    this.state.isPublic = isPublic;
    this.state.capacity = ROOM_CAPACITY;
    this.state.settings = JSON.stringify(defaultSettings(this.game));
    await this.syncMetadata();

    this.setSimulationInterval(
      (deltaMs) => this.simulate(deltaMs / 1000),
      LOBBY_TICK_MS,
    );

    this.onMessage("ready", clientMessages.ready, (client, { ready }) => {
      const player = this.state.players.get(client.sessionId);
      if (player) player.ready = ready;
    });

    // Le client n'envoie qu'une direction ; la position est simulée ici (vitesse et limites imposées).
    this.onMessage(
      "move",
      clientMessages.move,
      (client, { x, z, run, jump }) => {
        const player = this.state.players.get(client.sessionId);
        if (!player) return;
        const direction = clampDirection(x, z);
        player.dx = direction.x;
        player.dz = direction.z;
        player.run = Boolean(run);
        // Saut : une animation de 0,65 s, relancée au plus une fois à la fois.
        if (jump && !player.jump) {
          player.jump = true;
          this.clock.setTimeout(() => (player.jump = false), 650);
        }
      },
    );

    this.onMessage("emote", clientMessages.emote, (client, { id }) => {
      if (!this.state.players.has(client.sessionId)) return;
      // Les emotes de boutique ne sont utilisables que par leur propriétaire : le client ne s'en attribue aucune.
      if (
        !FREE_EMOTE_IDS.includes(id) &&
        !this.ownedEmotes.get(client.sessionId)?.has(id)
      ) {
        return this.refuse(
          client,
          "FORBIDDEN",
          "Cette emote n'est pas débloquée.",
        );
      }
      if (!this.emoteAllowed(client.sessionId)) return; // silencieux : simple anti-spam visuel
      this.announce("emote", { sessionId: client.sessionId, id });
    });

    this.onMessage("chat", clientMessages.chat, (client, { text }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (!this.chatAllowed(client.sessionId))
        return this.refuse(
          client,
          "RATE_LIMITED",
          "Trop de messages, patientez un instant.",
        );
      this.announce("chat", {
        fromId: player.id,
        name: player.name,
        color: player.color,
        text: filterChat(text),
        at: Date.now(),
      });
    });

    // Les statuts « prêt » sont volontairement conservés lors d'un changement de règle (cahier des charges 5.4).
    this.onMessage(
      "setSetting",
      clientMessages.setSetting,
      (client, { key, value }) => {
        if (!this.requireHost(client)) return;
        if (!this.applyChange(key, value))
          this.refuse(client, "INVALID", "Réglage invalide.");
      },
    );

    // Chambre : l'hôte change de jeu avant de lancer, et ouvre ou ferme l'accès public.
    this.onMessage("setGame", clientMessages.setGame, (client, { gameId }) => {
      if (!this.requireHost(client)) return;
      const game = getGame(gameId);
      if (!game || this.state.phase !== "waiting")
        return this.refuse(client, "INVALID", "Jeu invalide.");
      this.game = game;
      this.state.gameId = gameId;
      this.announce("notice", { type: "gameChanged", gameId });
      this.state.settings = JSON.stringify(defaultSettings(game));
      void this.syncMetadata();
    });

    // Fermeture de la chambre : les autres en sont prévenus puis tout le monde est déconnecté ; le code disparaît avec le salon.
    this.onMessage("closeRoom", clientMessages.closeRoom, (client) => {
      if (!this.requireHost(client)) return;
      this.broadcast("closed", {} satisfies ServerMessages["closed"]);
      void this.disconnect();
    });

    this.onMessage("kick", clientMessages.kick, (client, { sessionId }) => {
      if (!this.requireHost(client)) return;
      const target = this.clients.find((c) => c.sessionId === sessionId);
      const player = this.state.players.get(sessionId);
      if (!target || !player || sessionId === client.sessionId)
        return this.refuse(client, "INVALID", "Joueur introuvable.");
      this.kicked.add(player.id);
      target.send("kicked", {
        by: this.state.players.get(client.sessionId)?.name ?? "",
      } satisfies ServerMessages["kicked"]);
      // Retiré de l'état tout de suite : les autres le voient partir sans attendre la fermeture de sa connexion.
      this.state.players.delete(sessionId);
      this.blackjack?.removePlayer(sessionId);
      target.leave();
      this.announce("notice", { type: "playerKicked", name: player.name });
    });

    // Le créateur d'un salon garde sa place : sa position locale remplace l'apparition aléatoire, une seule fois.
    this.onMessage("spawnAt", clientMessages.spawnAt, (client, { x, z }) => {
      const player = this.state.players.get(client.sessionId);
      if (
        !player ||
        this.placed.has(client.sessionId) ||
        !Number.isFinite(x) ||
        !Number.isFinite(z)
      )
        return;
      this.placed.add(client.sessionId);
      player.x = Math.max(-ROOM_HALF, Math.min(ROOM_HALF, x));
      player.z = Math.max(-ROOM_HALF, Math.min(ROOM_HALF, z));
    });

    this.onMessage("refreshAvatar", clientMessages.refreshAvatar, (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.kind !== "user") return;
      void Promise.all([
        fetchAvatar(player.id),
        fetchCosmetics(player.id),
        fetchColor(player.id),
      ]).then(([avatar, shop, color]) => {
        // Le joueur a pu partir entre-temps.
        if (this.state.players.get(client.sessionId) !== player) return;
        player.avatar = avatar;
        player.cosmetics = shop.cosmetics;
        player.color = color;
      });
    });

    this.onMessage("sit", clientMessages.sit, (client, { sit }) => {
      const player = this.state.players.get(client.sessionId);
      if (player) player.sit = sit;
    });

    this.onMessage(
      "setPublic",
      clientMessages.setPublic,
      (client, { isPublic }) => {
        if (!this.requireHost(client)) return;
        if (this.state.isPublic === isPublic) return;
        this.state.isPublic = isPublic;
        this.announce("notice", { type: "accessChanged", isPublic });
        void this.syncMetadata();
      },
    );

    // Propositions : tout joueur propose, tous votent, l'hôte tranche. Le vote n'applique rien.
    this.onMessage(
      "propose",
      clientMessages.propose,
      (client, { key, value }) => {
        const player = this.state.players.get(client.sessionId);
        if (!player) return;
        if (!this.isValidChange(key, value))
          return this.refuse(client, "INVALID", "Proposition invalide.");
        if (this.state.proposals.size >= MAX_OPEN_PROPOSALS)
          return this.refuse(
            client,
            "RATE_LIMITED",
            "Trop de propositions en attente.",
          );
        if (!this.proposalAllowed(player.id))
          return this.refuse(
            client,
            "RATE_LIMITED",
            "Attendez avant de proposer à nouveau.",
          );
        const id = String(this.nextProposalId++);
        this.state.proposals.set(
          id,
          new Proposal({
            id,
            authorName: player.name,
            key,
            value: JSON.stringify(value),
            votesFor: 0,
            votesAgainst: 0,
          }),
        );
        this.votes.set(id, new Map());
        this.announce("notice", {
          type: "proposalCreated",
          name: player.name,
          key,
        });
      },
    );

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

    this.onMessage(
      "resolveProposal",
      clientMessages.resolveProposal,
      (client, { id, accept }) => {
        if (!this.requireHost(client)) return;
        const proposal = this.state.proposals.get(id);
        if (!proposal) return;
        this.state.proposals.delete(id);
        this.votes.delete(id);
        // La proposition a pu devenir invalide depuis (ex. capacité sous le nombre de joueurs présents).
        const applied =
          accept && this.applyChange(proposal.key, JSON.parse(proposal.value));
        if (accept && !applied)
          this.refuse(
            client,
            "INVALID",
            "Cette proposition n'est plus applicable.",
          );
        this.announce("notice", {
          type: "proposalResolved",
          key: proposal.key,
          accepted: applied,
        });
      },
    );

    // Lancement : l'hôte démarre un compte à rebours, annulé si les conditions ne tiennent plus.
    this.onMessage("start", clientMessages.start, (client) => {
      if (!this.requireHost(client) || this.state.phase !== "waiting") return;
      const blocker = launchBlocker(this.game, [
        ...this.state.players.values(),
      ]);
      if (blocker) return this.refuse(client, "INVALID", blocker);
      this.state.phase = "countdown";
      this.state.countdown = LAUNCH_COUNTDOWN_SECONDS;
      void this.syncMetadata();
      this.launchTimer = this.clock.setInterval(() => {
        if (launchBlocker(this.game, [...this.state.players.values()]))
          return this.cancelLaunch();
        if (--this.state.countdown === 0) this.beginGame();
      }, tuning.tickMs);
    });

    this.onMessage("cancelStart", clientMessages.cancelStart, (client) => {
      if (this.requireHost(client) && this.state.phase === "countdown")
        this.cancelLaunch();
    });

    this.onMessage("backToLobby", clientMessages.backToLobby, (client) => {
      if (!this.requireHost(client) || this.state.phase !== "results") return;
      for (const player of this.state.players.values()) player.ready = false;
      this.state.phase = "waiting";
      void this.syncMetadata();
    });

    this.onMessage(
      "bjAction",
      clientMessages.bjAction,
      (client, { action }) => {
        if (!this.blackjack?.action(client.sessionId, action))
          this.refuse(client, "INVALID", "Ce n'est pas votre tour.");
      },
    );
    this.onMessage("bjNext", clientMessages.bjNext, (client) => {
      if (this.requireHost(client)) this.blackjack?.next();
    });
    this.onMessage("bjEnd", clientMessages.bjEnd, (client) => {
      if (this.requireHost(client)) this.blackjack?.end();
    });

    this.onMessage(
      "report",
      clientMessages.report,
      (client, { sessionId, reason }) => {
        const reporter = this.state.players.get(client.sessionId);
        const target = this.state.players.get(sessionId);
        if (!reporter || !target || reporter === target) return;
        if (!this.reportAllowed(reporter.id))
          return this.refuse(
            client,
            "RATE_LIMITED",
            "Trop de signalements, réessayez plus tard.",
          );
        // shortcut: journalisé seulement ; à stocker en base avec outil de modération (phase 6).
        console.warn(
          JSON.stringify({
            event: "report",
            room: this.roomId,
            reporter: reporter.id,
            target: target.id,
            targetName: target.name,
            reason,
            at: Date.now(),
          }),
        );
      },
    );
  }

  async onAuth(
    _client: Client,
    _options: unknown,
    context: AuthContext,
  ): Promise<JoinAuth> {
    const identity = await verifyToken(context.token);
    if (!identity) throw new ServerError(401, JoinError.Unauthorized);
    if (this.kicked.has(identity.id))
      throw new ServerError(403, JoinError.Kicked);
    // Pas de spectateurs : on n'entre plus une fois le lancement engagé.
    if (this.state.phase !== "waiting")
      throw new ServerError(403, JoinError.InProgress);
    // Seuls les comptes ont un avatar et des objets de boutique ; les invités reçoivent l'apparence par défaut côté client.
    if (identity.kind !== "user")
      return {
        ...identity,
        avatar: "",
        cosmetics: "{}",
        color: "",
        ownedEmotes: [],
      };
    const [avatar, shop, color] = await Promise.all([
      fetchAvatar(identity.id),
      fetchCosmetics(identity.id),
      fetchColor(identity.id),
    ]);
    return {
      ...identity,
      avatar,
      cosmetics: shop.cosmetics,
      color,
      ownedEmotes: shop.ownedEmotes,
    };
  }

  onJoin(client: Client, _options: unknown, identity: JoinAuth) {
    this.ownedEmotes.set(client.sessionId, new Set(identity.ownedEmotes));
    // Une identité = un seul siège. Un siège déconnecté est remplacé, un siège actif bloque le doublon.
    for (const [sessionId, existing] of this.state.players) {
      if (existing.id !== identity.id) continue;
      if (existing.connected)
        throw new ServerError(409, JoinError.AlreadyInRoom);
      this.state.players.delete(sessionId);
      this.seats.get(sessionId)?.reject(new Error("replaced"));
    }
    this.state.players.set(
      client.sessionId,
      new Player({
        id: identity.id,
        name: identity.name,
        kind: identity.kind,
        ready: false,
        connected: true,
        avatar: identity.avatar,
        cosmetics: identity.cosmetics,
        color: identity.color,
        x: ROOM_SPAWN.x + (Math.random() - 0.5) * 2 * ROOM_SPAWN.spread,
        z: ROOM_SPAWN.z + (Math.random() - 0.5) * ROOM_SPAWN.spread,
        dx: 0,
        dz: 0,
        run: false,
        jump: false,
        sit: false,
      }),
    );
    this.ensureHost();
    this.announce("notice", { type: "playerJoined", name: identity.name });
    if (identity.kind === "user")
      presence.setRoom(identity.id, "lobby", this.state.gameId);
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
    this.ownedEmotes.delete(client.sessionId);
    const leaving = this.state.players.get(client.sessionId);
    if (leaving?.kind === "user") presence.clearRoom(leaving.id);
    this.state.players.delete(client.sessionId);
    this.blackjack?.removePlayer(client.sessionId);
    if (leaving)
      this.announce("notice", { type: "playerLeft", name: leaving.name });
    this.ensureHost();
  }

  onDispose() {
    this.blackjack?.dispose();
  }

  private cancelLaunch() {
    this.launchTimer?.clear();
    this.launchTimer = null;
    this.state.phase = "waiting";
    this.state.countdown = 0;
    void this.syncMetadata();
    this.announce("notice", { type: "launchCancelled" });
  }

  /**
   * Fin du compte à rebours. Tous les joueurs connectés participent (ils ont vu le compte à rebours
   * et pouvaient quitter) ; les joueurs déconnectés à cet instant sont retirés du salon.
   */
  private beginGame() {
    this.launchTimer?.clear();
    this.launchTimer = null;
    const participants = new Map<string, string>();
    for (const [sessionId, player] of [...this.state.players]) {
      if (player.connected) {
        participants.set(sessionId, player.name);
        continue;
      }
      this.state.players.delete(sessionId);
      this.seats.get(sessionId)?.reject(new Error("game started"));
    }
    this.state.proposals.clear();
    this.votes.clear();
    this.state.phase = "playing";
    this.setPresence("playing");
    void this.syncMetadata();
    const matchId = randomUUID(); // clé d'idempotence de l'enregistrement des résultats
    // Seul jeu disponible pour l'instant ; les suivants brancheront ici leur propre contrôleur.
    this.blackjack = new BlackjackGame(this.state.blackjack, this.clock, {
      decisionSeconds: Number(
        parseSettings(this.state.settings).decisionSeconds,
      ),
      onFinished: () => {
        this.blackjack = null;
        this.state.phase = "results";
        this.setPresence("lobby");
        void this.syncMetadata();
        void this.saveBlackjackResults(matchId);
      },
    });
    this.blackjack.start(participants);
  }

  private simulate(seconds: number) {
    for (const player of this.state.players.values()) {
      if (player.dx === 0 && player.dz === 0) continue;
      const position = { x: player.x, z: player.z };
      const others = [...this.state.players.values()]
        .filter((p) => p !== player)
        .map((p) => ({ x: p.x, z: p.z }));
      stepLobbyPosition(
        position,
        { x: player.dx, z: player.dz },
        seconds,
        player.run,
        others,
      );
      player.x = position.x;
      player.z = position.z;
    }
    pushApart([...this.state.players.values()], seconds);
  }

  private setPresence(status: "lobby" | "playing") {
    for (const player of this.state.players.values()) {
      if (player.kind === "user" && player.connected)
        presence.setRoom(player.id, status, this.state.gameId);
    }
  }

  /** Classement calculé ici, côté serveur : le client n'envoie jamais de score. Envoie ensuite à chacun ses récompenses. */
  private async saveBlackjackResults(matchId: string) {
    const table = [...this.state.blackjack.players];
    const participants = table.flatMap(([sessionId, result]) => {
      const player = this.state.players.get(sessionId);
      if (player?.kind !== "user") return [];
      const rank =
        1 + table.filter(([, other]) => other.score > result.score).length;
      return [
        {
          user_id: player.id,
          rank,
          score: result.score,
          wins: result.wins,
          pushes: result.pushes,
          losses: result.losses,
        },
      ];
    });
    const rewards = await recordMatch(
      matchId,
      this.state.gameId,
      this.state.blackjack.round,
      participants,
    );
    for (const reward of rewards) {
      const sessionId = [...this.state.players].find(
        ([, player]) => player.id === reward.userId,
      )?.[0];
      const client = sessionId ? this.clients.getById(sessionId) : undefined;
      client?.send("rewards", {
        xpGained: reward.xpGained,
        xp: reward.xp,
        achievements: reward.achievements,
        tokens: reward.tokensGained,
        balance: reward.balance,
        missions: reward.missions,
      } satisfies ServerMessages["rewards"]);
    }
  }

  private isValidChange(key: string, value: unknown): boolean {
    if (this.state.phase !== "waiting") return false; // règles verrouillées dès le lancement
    return isValidSetting(this.game, key, value);
  }

  /** Applique un changement de règle validé et l'annonce. Renvoie false s'il est invalide. */
  private applyChange(key: string, value: unknown): boolean {
    if (!this.isValidChange(key, value)) return false;
    this.state.settings = JSON.stringify({
      ...parseSettings(this.state.settings),
      [key]: value,
    });
    this.announce("notice", { type: "settingChanged", key });
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
      if (changed)
        this.announce("notice", { type: "hostChanged", name: player.name });
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

  private refuse(
    client: Client,
    code: ServerMessages["error"]["code"],
    message: string,
  ) {
    client.send("error", { code, message } satisfies ServerMessages["error"]);
  }

  private announce<K extends keyof ServerMessages>(
    type: K,
    payload: ServerMessages[K],
  ) {
    this.broadcast(type, payload);
  }
}
