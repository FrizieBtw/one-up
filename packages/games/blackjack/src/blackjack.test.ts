import { describe, expect, it } from "vitest";
import { createDeck, dealerShouldHit, handValue, isNatural, resolveHand, shuffle, type Rank } from "./index";

const hand = (...ranks: Rank[]) => ranks.map((rank) => ({ rank }));

describe("blackjack rules", () => {
  it("builds a 52-card deck and shuffles without losing cards", () => {
    const deck = createDeck();
    expect(new Set(deck.map((c) => c.rank + c.suit)).size).toBe(52);
    const mixed = shuffle(deck);
    expect(mixed).toHaveLength(52);
    expect(new Set(mixed.map((c) => c.rank + c.suit)).size).toBe(52);
    expect(deck[0]).toEqual({ rank: "A", suit: "spades" }); // l'original n'est pas modifié
  });

  it("values hands, counting aces as 11 or 1", () => {
    expect(handValue(hand("K", "7"))).toEqual({ total: 17, soft: false });
    expect(handValue(hand("A", "6"))).toEqual({ total: 17, soft: true });
    expect(handValue(hand("A", "6", "9"))).toEqual({ total: 16, soft: false });
    expect(handValue(hand("A", "A", "9"))).toEqual({ total: 21, soft: true });
    expect(handValue(hand("A", "A", "A", "K"))).toEqual({ total: 13, soft: false });
    expect(handValue(hand("K", "Q", "5")).total).toBe(25);
  });

  it("detects naturals only on two cards", () => {
    expect(isNatural(hand("A", "K"))).toBe(true);
    expect(isNatural(hand("7", "7", "7"))).toBe(false);
  });

  it("dealer draws to 17 and stands on soft 17", () => {
    expect(dealerShouldHit(hand("10", "6"))).toBe(true);
    expect(dealerShouldHit(hand("A", "6"))).toBe(false);
    expect(dealerShouldHit(hand("10", "7"))).toBe(false);
  });

  it("resolves hands", () => {
    expect(resolveHand(hand("K", "9"), hand("K", "8"))).toBe("win");
    expect(resolveHand(hand("K", "8"), hand("K", "8"))).toBe("push");
    expect(resolveHand(hand("K", "7"), hand("K", "8"))).toBe("loss");
    expect(resolveHand(hand("K", "5"), hand("K", "6", "9"))).toBe("win"); // croupier dépasse
    expect(resolveHand(hand("K", "6", "9"), hand("K", "6", "9"))).toBe("loss"); // les deux dépassent : le joueur perd
    expect(resolveHand(hand("A", "K"), hand("7", "7", "7"))).toBe("win"); // naturel contre 21 en trois cartes
    expect(resolveHand(hand("7", "7", "7"), hand("A", "K"))).toBe("loss");
    expect(resolveHand(hand("A", "K"), hand("A", "Q"))).toBe("push");
  });
});
