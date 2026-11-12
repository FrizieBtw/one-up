// Règles de Blackjack Battle : fonctions pures, partagées par le serveur (autorité) et le client (affichage).
//
// Règles retenues :
// - Un paquet de 52 cartes, remélangé à chaque manche.
// - Actions du joueur : tirer ou rester. Pas de doublement, de séparation ni d'assurance.
// - Un as vaut 11 tant que la main ne dépasse pas 21, sinon 1.
// - Blackjack naturel = 21 avec les deux premières cartes. Il bat un 21 obtenu en trois cartes ou plus.
// - Le croupier tire jusqu'à 17 et reste sur tout 17, y compris un 17 « souple » (as compté 11).
// - Un joueur qui dépasse 21 perd, quel que soit le jeu du croupier.
// - Score de classement : victoire 3, égalité 1, défaite 0. Aucune mise, aucun jeton engagé.

export const SUITS = ["spades", "hearts", "diamonds", "clubs"] as const;
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];

export interface Card {
  rank: Rank;
  suit: Suit;
}

export type HandResult = "win" | "push" | "loss";
export const POINTS: Record<HandResult, number> = { win: 3, push: 1, loss: 0 };

export function createDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
}

/** Mélange de Fisher-Yates ; renvoie un nouveau paquet. */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

export function handValue(cards: readonly Pick<Card, "rank">[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const { rank } of cards) {
    if (rank === "A") {
      aces++;
      total += 11;
    } else total += rank === "J" || rank === "Q" || rank === "K" ? 10 : Number(rank);
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

export const isBust = (cards: readonly Pick<Card, "rank">[]) => handValue(cards).total > 21;
export const isNatural = (cards: readonly Pick<Card, "rank">[]) => cards.length === 2 && handValue(cards).total === 21;
export const dealerShouldHit = (cards: readonly Pick<Card, "rank">[]) => handValue(cards).total < 17;

/** Résultat d'une main de joueur face à la main finale du croupier. */
export function resolveHand(player: readonly Pick<Card, "rank">[], dealer: readonly Pick<Card, "rank">[]): HandResult {
  const p = handValue(player).total;
  const d = handValue(dealer).total;
  if (p > 21) return "loss";
  if (isNatural(player) !== isNatural(dealer)) return isNatural(player) ? "win" : "loss";
  if (d > 21 || p > d) return "win";
  return p === d ? "push" : "loss";
}
