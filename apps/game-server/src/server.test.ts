import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOBBY_ROOM_NAME, normalizeRoomCode, type LobbySnapshot, type PublicRoomInfo } from "@stepup/shared";
import { server } from "./app";
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
