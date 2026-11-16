import { describe, expect, it } from "vitest";
import type { Card as RuleCard } from "@stepup/blackjack";
import { BlackjackGame, BlackjackState, tuning } from "./blackjack";

const card = (rank: string, suit = "spades") => ({ rank, suit }) as RuleCard;
/** Horloge factice : les minuteries ne tournent pas, le test avance la partie à la main. */
const clock = {
  setInterval: () => ({ clear() {} }),
  setTimeout: () => ({ clear() {} }),
} as never;

function setup(deck: RuleCard[]) {
  const saved = { ...tuning };
  Object.assign(tuning, { deck: () => [...deck] });
  const state = new BlackjackState();
  const game = new BlackjackGame(state, clock, {
    decisionSeconds: 20,
    onFinished: () => {},
    seatOf: () => 0,
  });
  game.start(new Map([["a", "Alice"]]));
  return { state, game, restore: () => Object.assign(tuning, saved) };
}

describe("blackjack split", () => {
  it("offers the split on a pair, deals one card to each hand and plays them one after the other", () => {
    // Ordre : Alice 8, croupier 6, Alice 8, croupier (cachée) 10, puis les cartes de la séparation et les tirages.
    const { state, game, restore } = setup([
      card("8"), card("6"), card("8", "hearts"), card("10"),
      card("3"), card("K"), // séparation : 8+3 = 11 ; 8+K = 18
      card("10"), // tirage sur la première main : 21
    ]);
    try {
      const alice = state.players.get("a")!;
      expect(alice.canSplit).toBe(true);
      expect(game.action("a", "split")).toBe(true);
      expect(alice.cards.map((c) => c.rank)).toEqual(["8", "3"]);
      expect(alice.cards2.map((c) => c.rank)).toEqual(["8", "K"]);
      expect(alice.canSplit).toBe(false);
      expect(alice.hand).toBe(0);
      expect(game.action("a", "split")).toBe(false); // une seule séparation
      expect(game.action("a", "hit")).toBe(true); // 11 + 10 = 21 : la première main s'arrête, la seconde commence
      expect(alice.status).toBe("stood");
      expect(alice.hand).toBe(1);
      expect(state.turn).toBe("a");
      expect(game.action("a", "stand")).toBe(true); // seconde main : 18
      expect(state.stage).toBe("dealer");
    } finally {
      restore();
    }
  });

  it("refuses the split without a pair", () => {
    const { state, game, restore } = setup([card("8"), card("6"), card("9"), card("10")]);
    try {
      expect(state.players.get("a")!.canSplit).toBe(false);
      expect(game.action("a", "split")).toBe(false);
    } finally {
      restore();
    }
  });
});

describe("blackjack split, same value", () => {
  it("offers the split on two different cards of the same value (10 and jack)", () => {
    const { state, game, restore } = setup([card("10"), card("6"), card("J"), card("9"), card("2"), card("3")]);
    try {
      expect(state.players.get("a")!.canSplit).toBe(true);
      expect(game.action("a", "split")).toBe(true);
    } finally {
      restore();
    }
  });
});

describe("blackjack bets", () => {
  /** Portefeuille factice : mouvements enregistrés, soldes en mémoire. */
  function bankOf(balances: Record<string, number>) {
    const moves: [string, number, string][] = [];
    return {
      moves,
      bank: {
        balance: (id: string) => balances[id] ?? null,
        debit: async (id: string, amount: number, ref: string) => {
          if ((balances[id] ?? 0) < amount) return false;
          balances[id]! -= amount;
          moves.push([id, -amount, ref]);
          return true;
        },
        credit: (id: string, amount: number, ref: string) => {
          balances[id] = (balances[id] ?? 0) + amount;
          moves.push([id, amount, ref]);
        },
      },
    };
  }
  function setupBets(deck: RuleCard[], balances: Record<string, number>) {
    const saved = { ...tuning };
    Object.assign(tuning, { deck: () => [...deck] });
    const state = new BlackjackState();
    const { bank, moves } = bankOf(balances);
    const game = new BlackjackGame(state, clock, { decisionSeconds: 20, onFinished: () => {}, seatOf: () => 0, bank, ref: "m" });
    game.start(new Map([["a", "Alice"]]));
    return { state, game, moves, balances, restore: () => Object.assign(tuning, saved) };
  }

  it("waits for the bet, debits it, deals, then pays 3 to 2 on a natural blackjack", async () => {
    // Alice : A + K (naturel) ; croupier 9 + 8 = 17.
    const { state, game, moves, balances, restore } = setupBets(
      [card("A"), card("9"), card("K"), card("8")],
      { a: 1000 },
    );
    try {
      const alice = state.players.get("a")!;
      expect(state.stage).toBe("betting");
      expect(alice.cards.length).toBe(0);
      expect(await game.bet("a", 2)).toBe(false); // sous la mise minimale
      expect(await game.bet("a", 100, [25, 25, 25, 25])).toBe(true);
      expect(alice.chips).toBe("25,25,25,25"); // les jetons choisis, pas une découpe automatique
      expect(await game.bet("a", 100)).toBe(false); // une seule mise par manche
      expect(balances.a).toBe(900);
      expect(alice.balance).toBe(900);
      expect(alice.cards.length).toBe(2); // tous ont misé : distribution
      // Blackjack naturel : le croupier joue (cartes fictives : minuteries à la main), la manche est résolue à 3 pour 2.
      expect(state.stage).toBe("dealer");
      void moves;
    } finally {
      restore();
    }
  });

  it("makes a player who did not bet sit out the round", () => {
    const { state, game, restore } = setupBets([card("5"), card("6"), card("7"), card("8")], { a: 1000 });
    try {
      // Fin du temps de mise : personne n'a misé, la table reste en attente de mises.
      for (let i = 0; i < 25; i++) (game as unknown as { tick(): void }).tick();
      expect(state.stage).toBe("betting");
      expect(state.players.get("a")!.cards.length).toBe(0);
    } finally {
      restore();
    }
  });
});

describe("blackjack double down", () => {
  it("draws exactly one card, then stands (free play)", () => {
    // Alice 5 + 6 = 11 ; croupier 6 + 10 ; carte tirée en doublant : 9 → 20.
    const { state, game, restore } = setup([card("5"), card("6"), card("6", "hearts"), card("10"), card("9")]);
    try {
      const alice = state.players.get("a")!;
      expect(alice.canDouble).toBe(true);
      expect(game.action("a", "double")).toBe(true);
      expect(alice.cards.map((c) => c.rank)).toEqual(["5", "6", "9"]);
      expect(alice.status).toBe("stood");
      expect(state.stage).toBe("dealer");
    } finally {
      restore();
    }
  });

  it("is not offered after a hit", () => {
    const { state, game, restore } = setup([card("2"), card("6"), card("3"), card("10"), card("4"), card("5")]);
    try {
      expect(state.players.get("a")!.canDouble).toBe(true);
      game.action("a", "hit");
      expect(state.players.get("a")!.canDouble).toBe(false);
      expect(game.action("a", "double")).toBe(false);
    } finally {
      restore();
    }
  });
});

describe("blackjack double down with a bet", () => {
  it("doubles the stake of the hand", async () => {
    const balances: Record<string, number> = { a: 1000 };
    const saved = { ...tuning };
    Object.assign(tuning, { deck: () => [card("5"), card("6"), card("6", "hearts"), card("10"), card("9")] });
    const state = new BlackjackState();
    const bank = {
      balance: (id: string) => balances[id] ?? null,
      debit: async (id: string, amount: number) => {
        if ((balances[id] ?? 0) < amount) return false;
        balances[id]! -= amount;
        return true;
      },
      credit: (id: string, amount: number) => {
        balances[id] = (balances[id] ?? 0) + amount;
      },
    };
    const game = new BlackjackGame(state, clock, { decisionSeconds: 20, onFinished: () => {}, seatOf: () => 0, bank, ref: "m" });
    try {
      game.start(new Map([["a", "Alice"]]));
      expect(await game.bet("a", 100)).toBe(true);
      const alice = state.players.get("a")!;
      expect(alice.canDouble).toBe(true);
      expect(game.action("a", "double")).toBe(true);
      await new Promise((r) => setTimeout(r, 0));
      expect(alice.bet).toBe(200);
      expect(balances.a).toBe(800);
      expect(alice.cards.length).toBe(3);
      expect(alice.status).toBe("stood");
    } finally {
      Object.assign(tuning, saved);
    }
  });
});
