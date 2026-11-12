import { describe, expect, it } from "vitest";
import {
  GAMES,
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
