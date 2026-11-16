/** Jetons de mise : un modèle KayKit et une couleur par valeur, de la plus petite à la plus grosse : rouge, bleu, vert, jaune. */
export const CHIP_STYLE: Record<number, { file: string; color: string }> = {
  5: { file: "chip_A_red", color: "#d94a4a" },
  25: { file: "chip_A_blue", color: "#3b8fd9" },
  100: { file: "chip_A_green", color: "#3fae5a" },
  500: { file: "chip_A_yellow", color: "#f0b429" },
};

/** Jetons posés (« 10,25,25 » pour une ou deux mains) : { valeur → nombre }, des plus gros aux plus petits. */
export function parseChips(...lists: string[]): [number, number][] {
  const counts = new Map<number, number>();
  for (const list of lists)
    for (const part of list.split(",")) {
      const value = Number(part);
      if (value > 0) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  return [...counts].sort((a, b) => b[0] - a[0]);
}

/** Découpe une mise en jetons, des plus gros aux plus petits : { valeur → nombre }. */
export function chipsOf(
  bet: number,
  values: readonly number[],
): [number, number][] {
  const out: [number, number][] = [];
  let rest = bet;
  for (const value of [...values].sort((a, b) => b - a)) {
    const count = Math.floor(rest / value);
    if (count > 0) out.push([value, count]);
    rest -= count * value;
  }
  return out;
}

/** Mise découpée en jetons, au format « 100,50,10 » (comme les jetons envoyés par le serveur). */
export function chipsList(bet: number, values: readonly number[]): string {
  return chipsOf(bet, values)
    .flatMap(([value, count]) => Array<number>(count).fill(value))
    .join(",");
}
