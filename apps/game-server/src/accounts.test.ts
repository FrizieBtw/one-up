import { ColyseusTestServer } from "@colyseus/testing";
import { createDeck, type Card as RuleCard } from "@stepup/blackjack";
import { AVATAR_OPTIONS, LOBBY_ROOM_NAME, type LobbySnapshot } from "@stepup/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Comptes simulés : le jeton « user:<id>:<pseudo> » donne une identité de compte, sans Supabase.
// La base est simulée aussi : on vérifie ce que le serveur LUI ENVOIE (résultats calculés ici, jamais par le client)
// et ce qu'il fait des réponses (avatar, récompenses, présence filtrée).
const recorded: { sessionId: string; gameId: string; rounds: number; participants: unknown[] }[] = [];
const AVATAR = JSON.stringify({ skin: AVATAR_OPTIONS.skin[2], hair: AVATAR_OPTIONS.hair[3], outfit: AVATAR_OPTIONS.outfit[1], hairStyle: 2, eyeStyle: 1 });

vi.mock("./auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("./auth")>();
  return {
    ...original,
    // Jetons de compte simulés ; tout le reste (invités, jetons invalides) passe par la vraie vérification.
    verifyToken: async (token?: string) => {
      const [kind, id, name] = (token ?? "").split(":");
      return kind === "user" ? { id: id!, name: name!, kind: "user" as const } : original.verifyToken(token);
    },
  };
});

vi.mock("./persistence", () => ({
  fetchAvatar: async (userId: string) => (userId === "alice" ? AVATAR : ""),
  recordMatch: async (sessionId: string, gameId: string, rounds: number, participants: { user_id: string }[]) => {
    recorded.push({ sessionId, gameId, rounds, participants });
    return participants.map((p) => ({ userId: p.user_id, xpGained: 65, xp: 165, achievements: ["first_session"] }));
  },
  fetchFriendsWithPresenceSetting: async () => [
    { id: "bob", visibility: "everyone" },
    { id: "carol", visibility: "nobody" },
    { id: "dave", visibility: "friends" },
    { id: "erin", visibility: "friends" },
  ],
}));

const { server } = await import("./app");
const { tuning } = await import("./games/blackjack");
const { presence } = await import("./presence");

describe("account features", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    // boot() impose le port 2568 quand on lui passe un serveur défini : on écoute nous-mêmes sur un port distinct
    // de server.test.ts (les fichiers de test s'exécutent en parallèle).
    await server.listen(2570);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(() => colyseus.shutdown());

  const http = (path: string, init?: RequestInit) => fetch(`http://localhost:${colyseus.sdk["settings"].port}${path}`, init);
  const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));
  const until = async (condition: () => boolean, label: string) => {
    for (let i = 0; i < 150; i++) {
      if (condition()) return;
      await settle(20);
    }
    throw new Error(`condition non atteinte : ${label}`);
  };

  async function join(token: string, action: (sdk: ColyseusTestServer["sdk"]) => Promise<any>) {
    colyseus.sdk.auth.token = token;
    const room = await action(colyseus.sdk);
    const messages: Record<string, any[]> = {};
    for (const type of ["rewards", "error"]) {
      messages[type] = [];
      room.onMessage(type, (m: any) => messages[type]!.push(m));
    }
    return { room, messages, state: (): LobbySnapshot => room.state.toJSON() };
  }

  it("loads saved avatars (validated), sends rewards to the right account, and tracks presence through a session", async () => {
    const card = (rank: string) => ({ rank, suit: "spades" }) as RuleCard;
    const saved = { ...tuning };
    // Alice : blackjack naturel. Bob : 16. Croupier : 9 + 8 = 17.
    Object.assign(tuning, { tickMs: 30, dealerStepMs: 10, deck: () => [card("A"), card("K"), card("10"), card("6"), card("9"), card("8")] });
    try {
      const alice = await join("user:alice:Alice", (sdk) => sdk.create(LOBBY_ROOM_NAME, { gameId: "blackjack", isPublic: false }));
      const bob = await join("user:bob:Bob", (sdk) => sdk.joinById(alice.room.roomId));
      await settle();

      const players = alice.state().players;
      expect(players[alice.room.sessionId]!.avatar).toBe(AVATAR); // avatar enregistré, revalidé côté serveur
      expect(players[bob.room.sessionId]!.avatar).toBe(""); // pas d'avatar : le client utilisera celui par défaut
      expect(presence.get("alice").status).toBe("lobby");
      expect(presence.get("bob")).toMatchObject({ status: "lobby", gameId: "blackjack" });

      alice.room.send("ready", { ready: true });
      bob.room.send("ready", { ready: true });
      await settle();
      alice.room.send("start", {});
      await until(() => alice.state().phase === "playing", "partie lancée");
      expect(presence.get("bob").status).toBe("playing");

      bob.room.send("bjAction", { action: "stand" }); // pas son tour : Alice a un naturel, Bob joue en premier
      await until(() => alice.state().blackjack.stage === "roundEnd", "fin de manche");
      alice.room.send("bjEnd", {});
      await until(() => alice.state().phase === "results", "résultats");
      await until(() => alice.messages.rewards!.length === 1 && bob.messages.rewards!.length === 1, "récompenses reçues");

      // Le serveur a calculé le classement lui-même et l'a transmis à la base, une fois.
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({ gameId: "blackjack", rounds: 1 });
      expect(recorded[0]!.participants).toEqual([
        { user_id: "alice", rank: 1, score: 3, wins: 1, pushes: 0, losses: 0 },
        { user_id: "bob", rank: 2, score: 0, wins: 0, pushes: 0, losses: 1 },
      ]);
      expect(alice.messages.rewards![0]).toEqual({ xpGained: 65, xp: 165, achievements: ["first_session"] });
      expect(presence.get("alice").status).toBe("lobby"); // retour au statut « lobby » en fin de session

      alice.room.send("backToLobby", {});
      await settle();
      expect(recorded).toHaveLength(1); // aucun second enregistrement
      await bob.room.leave();
      expect(presence.get("bob").status).toBe("online"); // plus dans un salon, mais vu récemment
      await alice.room.leave();
    } finally {
      Object.assign(tuning, saved);
    }
  });

  it("only gives guests no avatar and no presence", async () => {
    const { issueGuestToken } = await import("./auth");
    const guest = await join(issueGuestToken("Gus").token, (sdk) => sdk.create(LOBBY_ROOM_NAME, { gameId: "kart", isPublic: false }));
    await settle();
    expect(guest.state().players[guest.room.sessionId]!.avatar).toBe("");
    expect(presence.get(guest.state().players[guest.room.sessionId]!.id).status).toBe("offline");
    await guest.room.leave();
  });

  it("serves friends' presence filtered by their privacy settings", async () => {
    presence.ping("bob");
    presence.ping("carol");
    presence.setRoom("dave", "playing", "blackjack");
    const call = (path: string, init: RequestInit = {}) => http(path, { ...init, headers: { Authorization: "Bearer user:alice:Alice" } });

    expect((await call("/presence/ping", { method: "POST" })).status).toBe(200);
    const entries = (await (await call("/presence")).json()) as { userId: string; status: string; gameId?: string }[];
    const byUser = Object.fromEntries(entries.map((e) => [e.userId, e]));
    expect(byUser.bob!.status).toBe("online");
    expect(byUser.carol).toEqual({ userId: "carol", status: "offline" }); // masqué par son réglage : « hors ligne », rien d'autre
    expect(byUser.dave).toEqual({ userId: "dave", status: "playing", gameId: "blackjack" }); // visible des amis
    expect(byUser.erin).toEqual({ userId: "erin", status: "offline" }); // jamais vu
    expect(presence.get("alice").status).toBe("online"); // le ping a été pris en compte
  });
});
