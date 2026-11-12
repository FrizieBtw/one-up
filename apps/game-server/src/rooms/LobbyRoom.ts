import { type AuthContext, type Client, type Deferred, Room, ServerError, matchMaker } from "colyseus";
import { schema, t, type SchemaType } from "@colyseus/schema";
import {
  CHAT_RATE,
  HOST_GRACE_SECONDS,
  JoinError,
  RECONNECT_WINDOW_SECONDS,
  clientMessages,
  createLobbyOptionsSchema,
  defaultSettings,
  generateRoomCode,
  getGame,
  isValidCapacity,
  isValidSetting,
  parseSettings,
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
  },
  "Player",
);
export type Player = SchemaType<typeof Player>;

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
  private game!: GameDefinition;
  private seats = new Map<string, Deferred>();
  private chatAllowed = createRateLimiter(CHAT_RATE.max, CHAT_RATE.windowMs);

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

    this.onMessage("ready", clientMessages.ready, (client, { ready }) => {
      const player = this.state.players.get(client.sessionId);
      if (player) player.ready = ready;
    });

    this.onMessage("chat", clientMessages.chat, (client, { text }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (!this.chatAllowed(client.sessionId)) {
        return this.sendTo(client, "error", { code: "RATE_LIMITED", message: "Trop de messages, patientez un instant." });
      }
      this.announce("chat", { fromId: player.id, name: player.name, text, at: Date.now() });
    });

    // Les statuts « prêt » sont volontairement conservés lors d'un changement de règle (cahier des charges 5.4).
    this.onMessage("setSetting", clientMessages.setSetting, (client, { key, value }) => {
      if (!this.requireHost(client)) return;
      if (!isValidSetting(this.game, key, value)) {
        return this.sendTo(client, "error", { code: "INVALID", message: "Réglage invalide." });
      }
      this.state.settings = JSON.stringify({ ...parseSettings(this.state.settings), [key]: value });
      this.announce("notice", { type: "settingChanged", key });
    });

    this.onMessage("setCapacity", clientMessages.setCapacity, (client, { capacity }) => {
      if (!this.requireHost(client)) return;
      if (!isValidCapacity(this.game, capacity, this.state.players.size)) {
        return this.sendTo(client, "error", { code: "INVALID", message: "Capacité invalide." });
      }
      this.maxClients = capacity;
      this.state.capacity = capacity;
      this.announce("notice", { type: "capacityChanged", capacity });
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
    this.state.players.set(
      client.sessionId,
      new Player({ id: identity.id, name: identity.name, kind: identity.kind, ready: false, connected: true }),
    );
    this.ensureHost();
  }

  onDrop(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.connected = false;
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
    this.sendTo(client, "error", { code: "FORBIDDEN", message: "Réservé à l'hôte." });
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

  private sendTo<K extends keyof ServerMessages>(client: Client, type: K, payload: ServerMessages[K]) {
    client.send(type, payload);
  }

  private announce<K extends keyof ServerMessages>(type: K, payload: ServerMessages[K]) {
    this.broadcast(type, payload);
  }
}
