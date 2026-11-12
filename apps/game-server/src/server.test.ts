import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOBBY_RADIUS, LOBBY_ROOM_NAME, LOBBY_SPAWN_RADIUS, LOBBY_SPEED, normalizeRoomCode, type LobbySnapshot, type PublicRoomInfo } from "@stepup/shared";
import { createDeck, type Card as RuleCard } from "@stepup/blackjack";
import { server } from "./app";
import { tuning } from "./games/blackjack";
import { issueGuestToken, verifyGuestToken, verifyToken } from "./auth";
import { createRateLimiter } from "./rateLimit";

describe("rate limiter", () => {
  it("blocks past the limit and recovers after the window", () => {
    let now = 0;
    const allowed = createRateLimiter(2, 1000, () => now);
    expect([allowed("a"), allowed("a"), allowed("a")]).toEqual([true, true, false]);
    expect(allowed("b")).toBe(true);
    now = 1001;
    expect(allowed("a")).toBe(true);
  });
});

describe("guest tokens", () => {
  it("round-trips an identity", () => {
    const { token, identity } = issueGuestToken("Alice");
    expect(identity.kind).toBe("guest");
    expect(verifyGuestToken(token)).toEqual(identity);
  });
  it("rejects tampered, expired and malformed tokens", async () => {
    const { token } = issueGuestToken("Alice", 0);
    expect(verifyGuestToken(token, 1)).not.toBeNull();
    expect(verifyGuestToken(token, Date.now())).toBeNull(); // expiré
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ id: "x", name: "Admin", exp: 9e15 })).toString("base64url");
    expect(verifyGuestToken(`${forged}.${sig}`)).toBeNull();
    expect(verifyGuestToken(`${payload}.`)).toBeNull();
    expect(await verifyToken(undefined)).toBeNull();
    expect(await verifyToken("a.b.c")).toBeNull(); // JWT sans Supabase configuré
  });
});

describe("lobby room", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    colyseus = await boot(server);
  });
  afterAll(() => colyseus.shutdown());

  const http = (path: string, init?: RequestInit) => fetch(`http://localhost:${colyseus.sdk["settings"].port}${path}`, init);

  async function connect(name: string, join: (sdk: ColyseusTestServer["sdk"]) => Promise<any>) {
    const { token, identity } = issueGuestToken(name);
    colyseus.sdk.auth.token = token;
    const room = await join(colyseus.sdk);
    const errors: any[] = [];
    const notices: any[] = [];
    const chats: any[] = [];
    room.onMessage("error", (m: any) => errors.push(m));
    room.onMessage("notice", (m: any) => notices.push(m));
    room.onMessage("chat", (m: any) => chats.push(m));
    const snapshot = (): LobbySnapshot => room.state.toJSON();
    return { room, identity, token, errors, notices, chats, snapshot };
  }
  const create = (name: string, options: object) => connect(name, (sdk) => sdk.create(LOBBY_ROOM_NAME, options));
  const joinByCode = (name: string, code: string) => connect(name, (sdk) => sdk.joinById(code));
  const settle = () => new Promise((r) => setTimeout(r, 150));

  it("rejects unauthenticated clients and invalid creation options", async () => {
    colyseus.sdk.auth.token = "garbage.token";
    await expect(colyseus.sdk.create(LOBBY_ROOM_NAME, { gameId: "kart", isPublic: true })).rejects.toThrow();
    await expect(create("Alice", { gameId: "nope", isPublic: true })).rejects.toThrow();
  });

  it("runs a full two-player lobby: join by code, ready, chat, settings, host transfer", async () => {
    const alice = await create("Alice", { gameId: "kart", isPublic: true });
    const code = alice.room.roomId;
    expect(normalizeRoomCode(code)).toBe(code);

    const bob = await joinByCode("Bob", code);
    await settle();

    let state = bob.snapshot();
    expect(state.code).toBe(code);
    expect(state.hostSessionId).toBe(alice.room.sessionId);
    expect(Object.values(state.players).map((p) => p.name)).toEqual(["Alice", "Bob"]);
    expect(JSON.parse(state.settings).laps).toBe(3);

    // Liste publique
    const list = (await (await http("/rooms?game=kart")).json()) as PublicRoomInfo[];
    expect(list).toContainEqual({ code, gameId: "kart", hostName: "Alice", players: 2, capacity: 8, phase: "waiting" });
    expect(await (await http("/rooms?game=blackjack")).json()).toEqual([]);
    expect((await http("/rooms?game=hack")).status).toBe(400);

    // Prêt + chat
    bob.room.send("ready", { ready: true });
    bob.room.send("chat", { text: "salut" });
    await settle();
    expect(alice.snapshot().players[bob.room.sessionId]!.ready).toBe(true);
    expect(alice.chats).toMatchObject([{ name: "Bob", text: "salut" }]);

    // Réglages : refusés pour un non-hôte, validés pour l'hôte, « prêt » conservé
    bob.room.send("setSetting", { key: "laps", value: 5 });
    alice.room.send("setSetting", { key: "laps", value: 99 });
    alice.room.send("setSetting", { key: "laps", value: 7 });
    alice.room.send("setCapacity", { capacity: 1 }); // sous le nombre de joueurs présents
    alice.room.send("setCapacity", { capacity: 4 });
    await settle();
    expect(bob.errors.map((e) => e.code)).toEqual(["FORBIDDEN"]);
    expect(alice.errors.map((e) => e.code)).toEqual(["INVALID", "INVALID"]);
    state = bob.snapshot();
    expect(JSON.parse(state.settings).laps).toBe(7);
    expect(state.capacity).toBe(4);
    expect(state.players[bob.room.sessionId]!.ready).toBe(true);
    expect(alice.notices).toEqual(bob.notices); // aucune annonce d'hôte à la création
    expect(bob.notices).toEqual([
      { type: "settingChanged", key: "laps" },
      { type: "capacityChanged", capacity: 4 },
    ]);

    // Doublon de la même identité refusé
    colyseus.sdk.auth.token = bob.token;
    await expect(colyseus.sdk.joinById(code)).rejects.toThrow();

    // Anti-spam du chat
    for (let i = 0; i < 8; i++) bob.room.send("chat", { text: `spam ${i}` });
    await settle();
    expect(bob.errors.at(-1).code).toBe("RATE_LIMITED");
    expect(alice.chats.length).toBe(5);

    // Départ volontaire de l'hôte : transfert à Bob
    await alice.room.leave();
    await settle();
    state = bob.snapshot();
    expect(state.hostSessionId).toBe(bob.room.sessionId);
    expect(Object.keys(state.players)).toEqual([bob.room.sessionId]);
    expect(bob.notices.at(-1)).toEqual({ type: "hostChanged", name: "Bob" });
    await bob.room.leave();
  });

  it("keeps a dropped host's seat and role, and restores on reconnect", async () => {
    const alice = await create("Alice", { gameId: "blackjack", isPublic: false });
    const code = alice.room.roomId;
    const bob = await joinByCode("Bob", code);
    await settle();

    expect(await (await http("/rooms?game=blackjack")).json()).toEqual([]); // privé : non listé

    const reconnectionToken = alice.room.reconnectionToken;
    alice.room.reconnection.enabled = false; // on teste la reconnexion manuelle (rechargement de page)
    void alice.room.leave(false); // coupure non consentie
    await settle();
    let state = bob.snapshot();
    expect(state.players[alice.room.sessionId]).toMatchObject({ name: "Alice", connected: false });
    expect(state.hostSessionId).toBe(alice.room.sessionId); // délai de grâce : pas de transfert immédiat

    colyseus.sdk.auth.token = alice.token;
    const back = await colyseus.sdk.reconnect(reconnectionToken);
    await settle();
    state = bob.snapshot();
    expect(back.sessionId).toBe(alice.room.sessionId);
    expect(state.players[alice.room.sessionId]!.connected).toBe(true);
    expect(Object.keys(state.players).length).toBe(2);
    expect(state.hostSessionId).toBe(alice.room.sessionId);
    await back.leave();
    await bob.room.leave();
  });

  it("simulates movement on the server: speed cap, room bounds, no client positions", async () => {
    const alice = await create("Alice", { gameId: "kart", isPublic: false });
    await settle();
    const me = () => alice.snapshot().players[alice.room.sessionId]!;
    const start = me();
    expect(Math.hypot(start.x, start.z)).toBeCloseTo(LOBBY_SPAWN_RADIUS, 1);

    // Direction démesurée : normalisée, donc au plus LOBBY_SPEED unités par seconde.
    alice.room.send("move", { x: 1000, z: 0 });
    await new Promise((r) => setTimeout(r, 500));
    const moved = me();
    expect(moved.dx).toBeCloseTo(1);
    const travelled = moved.x - start.x;
    expect(travelled).toBeGreaterThan(0.8);
    expect(travelled).toBeLessThan(LOBBY_SPEED * 0.75);

    // Reste dans la salle, puis s'arrête.
    await new Promise((r) => setTimeout(r, 2500));
    expect(Math.hypot(me().x, me().z)).toBeLessThanOrEqual(LOBBY_RADIUS + 0.01);
    alice.room.send("move", { x: 0, z: 0 });
    await settle();
    const stopped = me();
    await settle();
    expect(me().x).toBe(stopped.x);
    await alice.room.leave();
  });

  it("broadcasts valid emotes, filters chat, and runs proposals through votes and host decision", async () => {
    const alice = await create("Alice", { gameId: "kart", isPublic: false });
    const bob = await joinByCode("Bob", alice.room.roomId);
    const emotes: any[] = [];
    alice.room.onMessage("emote", (m: any) => emotes.push(m));
    await settle();

    bob.room.send("emote", { id: "dance" });
    bob.room.send("chat", { text: "quelle Merde ce jeu" });
    await settle();
    expect(emotes).toEqual([{ sessionId: bob.room.sessionId, id: "dance" }]);
    expect(alice.chats.at(-1).text).toBe("quelle ***** ce jeu");

    // Un message hors schéma trahit un client non conforme : il est déconnecté.
    const mallory = await joinByCode("Mallory", alice.room.roomId);
    mallory.room.reconnection.enabled = false;
    const kicked = new Promise((resolve) => mallory.room.onLeave(resolve));
    mallory.room.send("emote", { id: "hack" });
    await kicked;
    expect(emotes.length).toBe(1);

    // Bob propose : invalide refusée, valide créée, seconde bloquée par l'anti-spam.
    bob.room.send("propose", { key: "laps", value: 99 });
    bob.room.send("propose", { key: "laps", value: 9 });
    bob.room.send("propose", { key: "bots", value: 2 });
    await settle();
    expect(bob.errors.map((e) => e.code)).toEqual(["INVALID", "RATE_LIMITED"]);
    let proposals = Object.values(alice.snapshot().proposals);
    expect(proposals).toMatchObject([{ authorName: "Bob", key: "laps", value: "9", votesFor: 0, votesAgainst: 0 }]);
    const id = proposals[0]!.id;

    // Votes : un par joueur, modifiable ; ne change aucune règle.
    alice.room.send("vote", { id, approve: false });
    bob.room.send("vote", { id, approve: true });
    alice.room.send("vote", { id, approve: true });
    await settle();
    expect(alice.snapshot().proposals[id]).toMatchObject({ votesFor: 2, votesAgainst: 0 });
    expect(JSON.parse(alice.snapshot().settings).laps).toBe(3);

    // Seul l'hôte tranche.
    bob.room.send("resolveProposal", { id, accept: true });
    await settle();
    expect(bob.errors.at(-1).code).toBe("FORBIDDEN");
    expect(alice.snapshot().proposals[id]).toBeDefined();
    alice.room.send("resolveProposal", { id, accept: true });
    await settle();
    expect(alice.snapshot().proposals).toEqual({});
    expect(JSON.parse(bob.snapshot().settings).laps).toBe(9);
    expect(bob.notices.slice(-3)).toEqual([
      { type: "proposalCreated", name: "Bob", key: "laps" },
      { type: "settingChanged", key: "laps" },
      { type: "proposalResolved", key: "laps", accepted: true },
    ]);

    // Proposition de capacité rejetée par l'hôte : rien ne change.
    alice.room.send("propose", { key: "capacity", value: 4 });
    await settle();
    const [capacityProposal] = Object.values(alice.snapshot().proposals);
    alice.room.send("resolveProposal", { id: capacityProposal!.id, accept: false });
    await settle();
    expect(alice.snapshot().capacity).toBe(8);
    expect(bob.notices.at(-1)).toEqual({ type: "proposalResolved", key: "capacity", accepted: false });

    // Signalement : accepté sans effet visible, auto-signalement ignoré.
    bob.room.send("report", { sessionId: alice.room.sessionId, reason: "test" });
    bob.room.send("report", { sessionId: bob.room.sessionId });
    await settle();
    expect(bob.errors.at(-1).code).toBe("FORBIDDEN"); // aucune nouvelle erreur
    await alice.room.leave();
    await bob.room.leave();
  });

  it("launches with a ready majority, plays blackjack rounds to the end, and returns to the lobby", async () => {
    const card = (rank: string, suit = "spades") => ({ rank, suit }) as RuleCard;
    // Ordre de distribution : deux cartes par joueur dans l'ordre de la table, carte visible puis cachée du croupier, puis les tirages.
    const decks = [
      [card("10"), card("6"), card("A"), card("K"), card("9"), card("8"), card("5")], // Alice 16 puis 21, Bob naturel, croupier 17
      [card("K"), card("5"), card("9"), card("7"), card("10"), card("9"), card("K")], // Alice dépasse, Bob 16 laissé au chrono, croupier 19
    ];
    const saved = { ...tuning };
    Object.assign(tuning, { tickMs: 30, dealerStepMs: 10, deck: () => decks.shift() ?? createDeck() });
    const until = async (condition: () => boolean, label: string) => {
      for (let i = 0; i < 150; i++) {
        if (condition()) return;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`condition non atteinte : ${label}`);
    };

    try {
      const alice = await create("Alice", { gameId: "blackjack", isPublic: true });
      const code = alice.room.roomId;
      const bob = await joinByCode("Bob", code);
      await settle();
      const state = () => bob.snapshot();
      const bj = () => state().blackjack;

      // Conditions de lancement : hôte seul, majorité stricte de prêts.
      bob.room.send("start", {});
      alice.room.send("start", {});
      alice.room.send("ready", { ready: true });
      await settle();
      alice.room.send("start", {}); // 1 prêt sur 2 : pas la majorité
      await settle();
      expect(bob.errors.map((e) => e.code)).toEqual(["FORBIDDEN"]);
      expect(alice.errors.map((e) => e.message)).toEqual(Array(2).fill("Plus de la moitié des joueurs doivent être prêts."));
      expect(state().phase).toBe("waiting");

      // Annulation par l'hôte, puis annulation automatique quand la majorité disparaît.
      bob.room.send("ready", { ready: true });
      await settle();
      alice.room.send("start", {});
      await until(() => state().phase === "countdown", "compte à rebours");
      expect(state().countdown).toBeGreaterThan(0);
      alice.room.send("cancelStart", {});
      await until(() => state().phase === "waiting", "annulation hôte");
      alice.room.send("start", {});
      await until(() => state().phase === "countdown", "second compte à rebours");
      bob.room.send("ready", { ready: false });
      alice.room.send("ready", { ready: false });
      await until(() => state().phase === "waiting", "annulation automatique");
      expect(bob.notices.filter((n) => n.type === "launchCancelled")).toHaveLength(2);

      // Lancement réel.
      bob.room.send("ready", { ready: true });
      alice.room.send("ready", { ready: true });
      await settle();
      alice.room.send("start", {});
      await until(() => state().phase === "playing", "partie lancée");

      // Pas de spectateur ni d'entrée en cours de partie ; règles verrouillées.
      colyseus.sdk.auth.token = issueGuestToken("Carol").token;
      await expect(colyseus.sdk.joinById(code)).rejects.toThrow("IN_PROGRESS");
      expect(((await (await http("/rooms?game=blackjack")).json()) as PublicRoomInfo[])[0]!.phase).toBe("playing");
      alice.room.send("setSetting", { key: "decisionSeconds", value: 60 });

      // Manche 1 : Bob a un naturel et ne joue pas ; la carte cachée du croupier n'est pas dans l'état.
      expect(bj()).toMatchObject({ round: 1, stage: "playing", turn: alice.room.sessionId, dealerHidden: true });
      expect(bj().dealer).toEqual([{ rank: "9", suit: "spades" }]);
      expect(bj().players[bob.room.sessionId]!.status).toBe("blackjack");
      bob.room.send("bjAction", { action: "hit" }); // pas son tour
      alice.room.send("bjAction", { action: "hit" }); // 16 + 5 = 21 : reste automatiquement
      await until(() => bj().stage === "roundEnd", "fin de manche 1");
      expect(bob.errors.at(-1).message).toBe("Ce n'est pas votre tour.");
      expect(alice.errors.at(-1).code).toBe("INVALID"); // réglage refusé pendant la partie
      expect(bj().dealer.map((c) => c.rank)).toEqual(["9", "8"]); // 17 : le croupier reste
      expect(bj().players[alice.room.sessionId]).toMatchObject({ status: "stood", result: "win", score: 3, wins: 1 });
      expect(bj().players[bob.room.sessionId]).toMatchObject({ result: "win", score: 3, wins: 1 });

      // Manche 2 : seul l'hôte enchaîne. Alice dépasse ; Bob ne joue pas, le chrono le fait rester.
      bob.room.send("bjNext", {});
      await settle();
      expect(bj().round).toBe(1);
      alice.room.send("bjNext", {});
      await until(() => bj().round === 2 && bj().turn === alice.room.sessionId, "manche 2");
      alice.room.send("bjAction", { action: "hit" });
      await until(() => bj().turn === bob.room.sessionId, "tour de Bob");
      expect(bj().players[alice.room.sessionId]!.status).toBe("bust");
      await until(() => bj().stage === "roundEnd", "fin de manche 2 par chrono");
      expect(bj().players[bob.room.sessionId]).toMatchObject({ status: "stood", result: "loss", score: 3, losses: 1 });
      expect(bj().players[alice.room.sessionId]).toMatchObject({ result: "loss", score: 3, wins: 1, losses: 1 });
      expect(bj().dealer.map((c) => c.rank)).toEqual(["10", "9"]);

      // Sans décision de l'hôte, la manche suivante démarre seule.
      await until(() => bj().round === 3, "manche 3 automatique");

      // L'hôte quitte pendant son tour : le tour et le rôle passent à Bob, la table continue.
      expect(bj().turn).toBe(alice.room.sessionId);
      await alice.room.leave();
      await until(() => bj().turn === bob.room.sessionId, "tour transmis");
      expect(Object.keys(bj().players)).toEqual([bob.room.sessionId]);
      expect(state().hostSessionId).toBe(bob.room.sessionId);
      bob.room.send("bjEnd", {}); // refusé en cours de manche
      bob.room.send("bjAction", { action: "stand" });
      await until(() => bj().stage === "roundEnd", "fin de manche 3");
      expect(state().phase).toBe("playing");

      // Fin de session par l'hôte, puis retour au lobby : statuts « prêt » remis à zéro.
      bob.room.send("bjEnd", {});
      await until(() => state().phase === "results", "résultats");
      expect(bj().stage).toBe("finished");
      expect(bj().players[bob.room.sessionId]!.wins + bj().players[bob.room.sessionId]!.pushes + bj().players[bob.room.sessionId]!.losses).toBe(3);
      bob.room.send("backToLobby", {});
      await until(() => state().phase === "waiting", "retour au lobby");
      expect(state().players[bob.room.sessionId]!.ready).toBe(false);
      await bob.room.leave();
    } finally {
      Object.assign(tuning, saved);
    }
  });

  it("issues guest tokens over HTTP and validates names", async () => {
    const post = (name: unknown) =>
      http("/auth/guest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    const ok = await post("Zoé");
    expect(ok.status).toBe(200);
    const { token, identity } = await ok.json();
    expect(verifyGuestToken(token)).toEqual(identity);
    expect((await post("x")).status).toBe(400);
  });
});
