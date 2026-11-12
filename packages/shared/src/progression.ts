// Niveaux : le niveau n s'atteint à 50·n·(n−1) XP cumulés (niveau 2 à 100, 3 à 300, 4 à 600…).
// Les gains d'XP sont calculés par la fonction SQL record_match (autorité serveur) :
// 20 de participation + 10 par manche gagnée + 5 par égalité + 25 si premier d'une session à 2 joueurs ou plus.

export const xpForLevel = (level: number) => 50 * level * (level - 1);

export function levelFromXp(xp: number): number {
  let level = Math.floor((1 + Math.sqrt(1 + 0.08 * Math.max(0, xp))) / 2);
  while (xpForLevel(level + 1) <= xp) level++; // garde-fou contre l'arrondi flottant
  while (level > 1 && xpForLevel(level) > xp) level--;
  return level;
}

export function levelProgress(xp: number): { level: number; into: number; needed: number } {
  const level = levelFromXp(xp);
  return { level, into: xp - xpForLevel(level), needed: xpForLevel(level + 1) - xpForLevel(level) };
}
