// Recoloration des palettes KayKit. Fonctions pures : aucune dépendance à three.js ni au DOM, donc testables dans Node.
//
// Une palette KayKit est une grille de 8 × 4 cases de dégradés verticaux. Recolorer une pièce = reconstruire une palette
// où certaines cases ont une autre couleur, en gardant la nuance de la case d'origine (plus clair en haut, plus sombre en bas).
// Les UV des pièces ne changent pas : la même géométrie sert quelle que soit la couleur choisie.

import { PALETTE_COLS, PALETTE_ROWS } from "./splitHead";

export type RGB = [number, number, number];
export interface CellGradient {
  top: RGB;
  mid: RGB;
  bottom: RGB;
}

/** Convention de palette KayKit. */
export const SKIN_CELL = 0;
export const HAIR_CELL = 1;
export const EYE_CELL = 2;

/** Palette reconstruite : 32 × 32 pixels par case, assez pour des dégradés lisses sans coûter de mémoire. */
export const CELL_PIXELS = 32;
export const PALETTE_WIDTH = PALETTE_COLS * CELL_PIXELS;
export const PALETTE_HEIGHT = PALETTE_ROWS * CELL_PIXELS;

export const hexToRgb = (hex: string): RGB => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const rgbToHex = (rgb: RGB): string => "#" + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");

/** Teinte (0 à 360), saturation et luminosité (0 à 1). */
export function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const [x, y, z] = [r / 255, g / 255, b / 255];
  const max = Math.max(x, y, z);
  const min = Math.min(x, y, z);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === x ? (y - z) / d + (y < z ? 6 : 0) : max === y ? (z - x) / d + 2 : (x - y) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb([h, s, l]: [number, number, number]): RGB {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Nouveau dégradé de la couleur `hex`, avec la nuance de la case d'origine : l'écart de luminosité et de saturation entre
 * le haut, le milieu et le bas est conservé. Le milieu du résultat est exactement la couleur demandée.
 */
export function recolorGradient(original: CellGradient, hex: string): CellGradient {
  const target = rgbToHsl(hexToRgb(hex));
  const [, sTop, lTop] = rgbToHsl(original.top);
  const [, sMid, lMid] = rgbToHsl(original.mid);
  const [, sBottom, lBottom] = rgbToHsl(original.bottom);
  const make = (s: number, l: number): RGB => hslToRgb([target[0], clamp01(target[1] + (s - sMid)), clamp01(target[2] + (l - lMid))]);
  return { top: make(sTop, lTop), mid: hexToRgb(hex), bottom: make(sBottom, lBottom) };
}

const lerp = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Couleur d'un dégradé à la hauteur `t` (0 = haut de la case, 1 = bas), en passant par le milieu. */
export const gradientAt = (g: CellGradient, t: number): RGB => (t < 0.5 ? lerp(g.top, g.mid, t * 2) : lerp(g.mid, g.bottom, (t - 0.5) * 2));

/**
 * Pixels RGBA de la palette reconstruite (`PALETTE_WIDTH` × `PALETTE_HEIGHT`, première ligne = haut, comme les UV glTF).
 * `replacements` : case → couleur hexadécimale ; les autres cases gardent leur dégradé d'origine.
 */
export function renderPalette(gradients: readonly CellGradient[], replacements: Readonly<Record<number, string>> = {}): Uint8ClampedArray {
  const out = new Uint8ClampedArray(PALETTE_WIDTH * PALETTE_HEIGHT * 4);
  for (let cell = 0; cell < PALETTE_COLS * PALETTE_ROWS; cell++) {
    const original = gradients[cell];
    if (!original) continue;
    const hex = replacements[cell];
    const gradient = hex ? recolorGradient(original, hex) : original;
    const x0 = (cell % PALETTE_COLS) * CELL_PIXELS;
    const y0 = Math.floor(cell / PALETTE_COLS) * CELL_PIXELS;
    for (let y = 0; y < CELL_PIXELS; y++) {
      const [r, g, b] = gradientAt(gradient, (y + 0.5) / CELL_PIXELS);
      for (let x = 0; x < CELL_PIXELS; x++) {
        const o = ((y0 + y) * PALETTE_WIDTH + x0 + x) * 4;
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = b;
        out[o + 3] = 255;
      }
    }
  }
  return out;
}

/** Lit les dégradés d'origine d'une image de palette via une fonction qui renvoie la couleur d'un point (x, y) de l'image. */
export function readGradients(width: number, height: number, pixelAt: (x: number, y: number) => RGB): CellGradient[] {
  const cellW = width / PALETTE_COLS;
  const cellH = height / PALETTE_ROWS;
  return Array.from({ length: PALETTE_COLS * PALETTE_ROWS }, (_, cell) => {
    const x = Math.floor(((cell % PALETTE_COLS) + 0.5) * cellW);
    const y0 = Math.floor(cell / PALETTE_COLS) * cellH;
    const at = (t: number) => pixelAt(x, Math.floor(y0 + t * cellH));
    return { top: at(0.08), mid: at(0.5), bottom: at(0.92) };
  });
}

/** Cases de palette utilisées par une pièce, de la plus étendue à la moins étendue (nombre de triangles). */
export function cellHistogram(uvs: ArrayLike<number>, indices: ArrayLike<number>, cellOf: (u: number, v: number) => number): [number, number][] {
  const count = new Map<number, number>();
  for (let t = 0; t < indices.length / 3; t++) {
    const [a, b, c] = [indices[3 * t]!, indices[3 * t + 1]!, indices[3 * t + 2]!];
    const cell = cellOf((uvs[2 * a]! + uvs[2 * b]! + uvs[2 * c]!) / 3, (uvs[2 * a + 1]! + uvs[2 * b + 1]! + uvs[2 * c + 1]!) / 3);
    count.set(cell, (count.get(cell) ?? 0) + 1);
  }
  return [...count].sort((x, y) => y[1] - x[1]);
}
