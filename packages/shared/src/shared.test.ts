import { describe, expect, it } from "vitest";
import {
  GAMES,
  LOBBY_RADIUS,
  clampDirection,
  filterChat,
  stepLobbyPosition,
  clientMessages,
  defaultSettings,
  generateRoomCode,
  getGame,
  isValidCapacity,
  isValidSetting,
  normalizeRoomCode,
  playerNameSchema,
} from "./index";

describe("room codes", () => {
  it("generates codes that normalize to themselves", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode();
      expect(normalizeRoomCode(code)).toBe(code);
    }
  });
  it("normalizes case and whitespace, rejects bad input", () => {
    expect(normalizeRoomCode(" abcdef ")).toBe("ABCDEF");
    expect(normalizeRoomCode("ABC")).toBeNull();
    expect(normalizeRoomCode("ABCDE0")).toBeNull(); // 0 exclu de l'alphabet
    expect(normalizeRoomCode("ABCDEFG")).toBeNull();
  });
});

describe("game settings", () => {
  it("every default is valid for its own schema", () => {
    for (const game of GAMES) {
      for (const [key, value] of Object.entries(defaultSettings(game))) {
        expect(isValidSetting(game, key, value), `${game.id}.${key}`).toBe(true);
      }
    }
  });
  it("rejects out-of-schema values", () => {
    const bj = getGame("blackjack")!;
    expect(isValidSetting(bj, "decisionSeconds", 30)).toBe(true);
    expect(isValidSetting(bj, "decisionSeconds", 15)).toBe(false);
    expect(isValidSetting(bj, "unknown", 1)).toBe(false);
    const kart = getGame("kart")!;
    expect(isValidSetting(kart, "laps", 11)).toBe(false);
    expect(isValidSetting(kart, "laps", 2.5)).toBe(false);
    expect(isValidSetting(kart, "collisions", "true")).toBe(false);
  });
  it("bounds capacity by game limits and current players", () => {
    const party = getGame("party")!;
    expect(isValidCapacity(party, 8)).toBe(true);
    expect(isValidCapacity(party, 9)).toBe(false);
    expect(isValidCapacity(party, 1)).toBe(false);
    expect(isValidCapacity(party, 3, 4)).toBe(false);
  });
});

describe("validation schemas", () => {
  it("validates player names", () => {
    expect(playerNameSchema.safeParse("  Zoé_42 ").data).toBe("Zoé_42");
    expect(playerNameSchema.safeParse("ab").success).toBe(false);
    expect(playerNameSchema.safeParse("<script>").success).toBe(false);
  });
  it("validates chat messages", () => {
    expect(clientMessages.chat.safeParse({ text: "   " }).success).toBe(false);
    expect(clientMessages.chat.safeParse({ text: "x".repeat(201) }).success).toBe(false);
    expect(clientMessages.chat.safeParse({ text: " salut " }).data).toEqual({ text: "salut" });
  });
});

describe("lobby movement", () => {
  it("normalizes directions and rejects non-finite input", () => {
    expect(clampDirection(0.3, -0.4)).toEqual({ x: 0.3, z: -0.4 });
    const big = clampDirection(30, 40);
    expect(Math.hypot(big.x, big.z)).toBeCloseTo(1);
    expect(clampDirection(Number.NaN, 1)).toEqual({ x: 0, z: 0 });
    expect(clampDirection(Infinity, 0)).toEqual({ x: 0, z: 0 });
  });
  it("keeps positions inside the room", () => {
    const position = { x: 0, z: 0 };
    for (let i = 0; i < 200; i++) stepLobbyPosition(position, { x: 1, z: 0 }, 0.05);
    expect(position.x).toBeCloseTo(LOBBY_RADIUS);
  });
});

describe("chat filter", () => {
  it("masks banned words regardless of case and accents, leaves the rest", () => {
    expect(filterChat("Enculé !")).toBe("****** !");
    expect(filterChat("FUCK this")).toBe("**** this");
    expect(filterChat("bonjour à tous")).toBe("bonjour à tous");
    expect(filterChat("un pdf")).toBe("un pdf"); // pas de faux positif sur une sous-chaîne
  });
});

describe("progression, avatar and presence", () => {
  it("computes levels from XP", async () => {
    const { levelFromXp, levelProgress, xpForLevel } = await import("./progression");
    expect([0, 99, 100, 299, 300, 599, 600].map(levelFromXp)).toEqual([1, 1, 2, 2, 3, 3, 4]);
    for (let level = 1; level < 60; level++) {
      expect(levelFromXp(xpForLevel(level))).toBe(level);
      expect(levelFromXp(xpForLevel(level + 1) - 1)).toBe(level);
    }
    expect(levelProgress(150)).toEqual({ level: 2, into: 50, needed: 200 });
  });
  it("accepts only avatars made of allowed options", async () => {
    const { parseAvatarConfig, AVATAR_OPTIONS } = await import("./avatar");
    const ok = { skin: AVATAR_OPTIONS.skin[0], hair: AVATAR_OPTIONS.hair[1], outfit: AVATAR_OPTIONS.outfit[2], hairStyle: 2, eyeStyle: 1 };
    expect(parseAvatarConfig(ok)).toEqual(ok);
    expect(parseAvatarConfig(JSON.stringify(ok))).toEqual(ok);
    expect(parseAvatarConfig({ ...ok, skin: "#000000" })).toBeNull();
    expect(parseAvatarConfig({ ...ok, hairStyle: 9 })).toBeNull();
    expect(parseAvatarConfig("{pas du json")).toBeNull();
    expect(parseAvatarConfig(null)).toBeNull();
  });
  it("hides presence according to the target's setting", async () => {
    const { visiblePresence } = await import("./presence");
    const entry = { userId: "u", status: "playing", gameId: "blackjack" } as const;
    expect(visiblePresence(entry, "everyone", false)).toEqual(entry);
    expect(visiblePresence(entry, "friends", true)).toEqual(entry);
    expect(visiblePresence(entry, "friends", false)).toEqual({ userId: "u", status: "offline" });
    expect(visiblePresence(entry, "nobody", true)).toEqual({ userId: "u", status: "offline" });
  });
});
