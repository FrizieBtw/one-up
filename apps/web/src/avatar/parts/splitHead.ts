// Découpe d'un maillage de tête KayKit en pièces : peau, oreilles, nez, yeux, sourcils, cheveux, barbe.
//
// Pourquoi : dans les modèles KayKit, cheveux, barbe et yeux sont fondus dans le maillage `Head` (et sa texture).
// On les retrouve parce que chaque pièce est une coque de géométrie distincte et colorée par une case de palette.
// Fonction pure : aucune dépendance à three.js, donc testable dans Node sur les vrais fichiers.
//
// Palette : grille de 8 colonnes × 4 lignes de dégradés verticaux ; l'axe vertical des UV glTF a son origine en haut.

export type PartRole = "skin" | "ear" | "nose" | "eye" | "brow" | "hair" | "beard" | "other";

export const PALETTE_COLS = 8;
export const PALETTE_ROWS = 4;

export interface HeadMeshData {
  positions: ArrayLike<number>; // x y z par sommet
  uvs: ArrayLike<number>; // u v par sommet
  indices: ArrayLike<number>; // trois indices par triangle
}

/** Couleur au centre d'une case de palette : `cell = ligne * 8 + colonne`. */
export type PaletteSampler = (cell: number) => { rgb: [number, number, number]; luminance: number };

/**
 * Corrections propres à une tête quand le classement automatique se trompe. Les cases de palette priment sur les repères
 * géométriques (une case = une couleur = un rôle). `ignoreCells` : cases à écarter (accessoires peints, maquillage…).
 */
export interface HeadOverrides {
  skinCells?: number[];
  eyeCells?: number[];
  browCells?: number[];
  hairCells?: number[];
  beardCells?: number[];
  ignoreCells?: number[];
}

export interface HeadComponent {
  /** Indices de triangles (dans `indices`, par groupes de trois). */
  triangles: number[];
  cell: number;
  role: PartRole;
  center: [number, number, number];
  size: [number, number, number];
}

export interface SplitResult {
  components: HeadComponent[];
  /** Case de palette de la peau, repérée sur les oreilles. */
  skinCell: number;
  /** Hauteur moyenne des yeux (NaN si aucun œil trouvé). */
  eyeY: number;
}

const key = (x: number, y: number, z: number) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;

export function cellOfUv(u: number, v: number): number {
  const col = Math.min(PALETTE_COLS - 1, Math.max(0, Math.floor(u * PALETTE_COLS)));
  const row = Math.min(PALETTE_ROWS - 1, Math.max(0, Math.floor(v * PALETTE_ROWS)));
  return row * PALETTE_COLS + col;
}

interface Tri {
  w: number[]; // sommets soudés
  cell: number;
  c: [number, number, number];
}

export function splitHead(mesh: HeadMeshData, palette: PaletteSampler, overrides: HeadOverrides = {}): SplitResult {
  const { positions: P, uvs: U, indices: I } = mesh;
  const welded = new Map<string, number>();
  const weld = (v: number) => {
    const k = key(P[3 * v]!, P[3 * v + 1]!, P[3 * v + 2]!);
    if (!welded.has(k)) welded.set(k, welded.size);
    return welded.get(k)!;
  };

  const tris: Tri[] = [];
  for (let t = 0; t < I.length / 3; t++) {
    const [a, b, c] = [I[3 * t]!, I[3 * t + 1]!, I[3 * t + 2]!];
    const u = (U[2 * a]! + U[2 * b]! + U[2 * c]!) / 3;
    const v = (U[2 * a + 1]! + U[2 * b + 1]! + U[2 * c + 1]!) / 3;
    tris.push({
      w: [weld(a), weld(b), weld(c)],
      cell: cellOfUv(u, v),
      c: [0, 1, 2].map((axis) => (P[3 * a + axis]! + P[3 * b + axis]! + P[3 * c + axis]!) / 3) as [number, number, number],
    });
  }

  // Composantes : triangles qui partagent un sommet soudé ET la même case de palette.
  // (Les coques posées contre le crâne partagent des sommets avec lui : sans la case, tout fusionnerait.)
  const parent = tris.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const seen = new Map<string, number>();
  tris.forEach((t, i) => {
    for (const w of t.w) {
      const k = `${w}:${t.cell}`;
      const other = seen.get(k);
      if (other === undefined) seen.set(k, i);
      else {
        const a = find(other);
        const b = find(i);
        if (a !== b) parent[a] = b;
      }
    }
  });
  const groups = new Map<number, number[]>();
  tris.forEach((_, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  });

  const comps: HeadComponent[] = [...groups.values()].map((ids) => {
    const ts = ids.map((i) => tris[i]!);
    const axis = (k: 0 | 1 | 2) => ts.map((t) => t.c[k]);
    const mean = (k: 0 | 1 | 2) => axis(k).reduce((s, x) => s + x, 0) / ts.length;
    const span = (k: 0 | 1 | 2) => Math.max(...axis(k)) - Math.min(...axis(k));
    return { triangles: ids, cell: ts[0]!.cell, role: "other" as PartRole, center: [mean(0), mean(1), mean(2)], size: [span(0), span(1), span(2)] };
  });

  const luminance = (cell: number) => palette(cell).luminance;
  const maxX = Math.max(...comps.map((c) => Math.abs(c.center[0])));
  const isEarLike = (c: HeadComponent) => Math.abs(c.center[0]) > maxX * 0.9 && c.triangles.length < 200;

  // Convention des palettes KayKit : case 0 = peau, case 2 = noir des yeux, case 1 = couleur des cheveux. On s'y fie quand ces cases
  // sont utilisées, sinon repli sur des repères géométriques (la peau est la case des oreilles ; les yeux sont de petites coques sombres).
  const used = new Set(comps.map((c) => c.cell));
  const ears = comps.filter(isEarLike);
  const skinCell =
    overrides.skinCells?.[0] ?? (used.has(0) ? 0 : ears.length ? ears[0]!.cell : [...comps].sort((a, b) => b.triangles.length - a.triangles.length)[0]!.cell);
  const skinCells = new Set([skinCell, ...(overrides.skinCells ?? [])]);

  const eyeCellSet = new Set(overrides.eyeCells ?? (used.has(2) ? [2] : []));
  const isDark = (c: HeadComponent) =>
    !skinCells.has(c.cell) && luminance(c.cell) < 0.22 && c.triangles.length < 140 && c.center[2] > 0 && Math.abs(c.center[0]) > 0.05;
  const isEye = (c: HeadComponent) => (eyeCellSet.size ? eyeCellSet.has(c.cell) : isDark(c));
  const eyeComps = comps.filter(isEye);
  const eyeY = eyeComps.length ? eyeComps.reduce((s, c) => s + c.center[1], 0) / eyeComps.length : Number.NaN;
  const frontZ = Math.max(...comps.map((c) => c.center[2]));
  // Oreilles : petites coques de peau sur les côtés de la tête. Nez : petite coque de peau devant, sur l'axe, à hauteur des yeux
  // (les autres petites coques de peau, comme les taches de rousseur ou la nuque, restent de la peau).
  const isEar = (c: HeadComponent) => (isEarLike(c) || Math.abs(c.center[0]) > 0.3) && c.center[1] > 1.35 && c.center[1] < 1.75 && c.triangles.length < 200;
  const isNose = (c: HeadComponent) =>
    c.triangles.length < 130 && Math.abs(c.center[0]) < 0.12 && c.center[2] > 0.38 && (Number.isNaN(eyeY) ? c.center[1] > 1.4 && c.center[1] < 1.7 : Math.abs(c.center[1] - eyeY) < 0.2);

  for (const c of comps) {
    const cell = c.cell;
    const n = c.triangles.length;
    if (overrides.ignoreCells?.includes(cell)) c.role = "other";
    else if (skinCells.has(cell)) c.role = isEar(c) ? "ear" : isNose(c) ? "nose" : "skin";
    else if (isEye(c)) c.role = "eye";
    else if (overrides.browCells?.includes(cell)) c.role = "brow";
    else if (overrides.beardCells?.includes(cell)) c.role = "beard";
    else if (overrides.hairCells?.includes(cell)) c.role = "hair";
    // Sans correction : repères géométriques, proportionnels à la hauteur des yeux.
    else if (c.center[1] < eyeY - 0.03 && c.center[2] > frontZ * 0.25 && Math.abs(c.center[0]) < 0.28 && n < 900) c.role = "beard";
    else if (c.center[1] >= eyeY - 0.03 && c.center[1] < eyeY + 0.2 && c.center[2] > frontZ * 0.7 && n < 130 && c.size[0] < 0.4) c.role = "brow";
    else if (luminance(cell) < 0.9 && n >= 20) c.role = "hair";
  }

  return { components: comps, skinCell, eyeY };
}

/** Nombre de coques par rôle : sert aux tests et à la planche de contrôle. */
export function countRoles(result: SplitResult): Record<PartRole, number> {
  const out: Record<PartRole, number> = { skin: 0, ear: 0, nose: 0, eye: 0, brow: 0, hair: 0, beard: 0, other: 0 };
  for (const c of result.components) out[c.role]++;
  return out;
}
