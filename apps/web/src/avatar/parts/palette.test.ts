import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CELL_PIXELS,
  EYE_CELL,
  HAIR_CELL,
  PALETTE_HEIGHT,
  PALETTE_WIDTH,
  SKIN_CELL,
  cellHistogram,
  gradientAt,
  hexToRgb,
  readGradients,
  recolorGradient,
  renderPalette,
  rgbToHex,
  rgbToHsl,
  type CellGradient,
} from "./palette";
import { loadMesh } from "./readGlb.node";
import { cellOfUv } from "./splitHead";

const grad = (top: [number, number, number], mid: [number, number, number], bottom: [number, number, number]): CellGradient => ({ top, mid, bottom });
const px = (data: Uint8ClampedArray, cell: number, t: number) => {
  const x = (cell % 8) * CELL_PIXELS + CELL_PIXELS / 2;
  const y = Math.floor(cell / 8) * CELL_PIXELS + Math.floor(t * (CELL_PIXELS - 1));
  const o = (y * PALETTE_WIDTH + x) * 4;
  return [data[o]!, data[o + 1]!, data[o + 2]!] as [number, number, number];
};

describe("color math", () => {
  it("round-trips hex and handles short forms", () => {
    expect(rgbToHex(hexToRgb("#ff8a1f"))).toBe("#ff8a1f");
    expect(hexToRgb("#fff")).toEqual([255, 255, 255]);
    expect(rgbToHsl([255, 0, 0])[0]).toBe(0);
    expect(rgbToHsl([128, 128, 128])[1]).toBe(0);
  });
});

describe("recolorGradient", () => {
  const skin = grad([250, 205, 170], [246, 192, 156], [240, 160, 120]);

  it("makes the middle exactly the requested color", () => {
    expect(rgbToHex(recolorGradient(skin, "#6e4128").mid)).toBe("#6e4128");
  });

  it("keeps the shading of the original cell (lighter on top, darker at the bottom)", () => {
    const g = recolorGradient(skin, "#6e4128");
    const lum = (c: [number, number, number]) => rgbToHsl(c)[2];
    expect(lum(g.top)).toBeGreaterThan(lum(g.mid));
    expect(lum(g.bottom)).toBeLessThan(lum(g.mid));
  });

  it("keeps the hue of the requested color, whatever the original cell", () => {
    const blue = recolorGradient(skin, "#3fa7ff");
    expect(Math.abs(rgbToHsl(blue.top)[0] - rgbToHsl(hexToRgb("#3fa7ff"))[0])).toBeLessThan(2);
  });

  it("stays inside the valid color range for extreme colors", () => {
    for (const hex of ["#000000", "#ffffff", "#ff00ff"]) {
      const g = recolorGradient(skin, hex);
      for (const c of [g.top, g.mid, g.bottom]) c.forEach((v) => expect(v >= 0 && v <= 255).toBe(true));
    }
  });
});

describe("renderPalette", () => {
  const gradients = Array.from({ length: 32 }, (_, i) => grad([i, 10, 10], [i, 50, 50], [i, 90, 90]));

  it("produces a full 256x128 RGBA image", () => {
    const out = renderPalette(gradients);
    expect(out.length).toBe(PALETTE_WIDTH * PALETTE_HEIGHT * 4);
    expect(out[3]).toBe(255);
  });

  it("keeps untouched cells and recolors only the requested ones", () => {
    const out = renderPalette(gradients, { [HAIR_CELL]: "#2a1b4d" });
    const near = (c: number[], e: number[]) => c.every((v, i) => Math.abs(v - e[i]!) <= 2);
    expect(near(px(out, 5, 0.5), [5, 50, 50])).toBe(true);
    expect(near(px(out, SKIN_CELL, 0.5), [0, 50, 50])).toBe(true);
    const hair = px(out, HAIR_CELL, 0.5);
    expect(Math.abs(hair[0] - 0x2a)).toBeLessThanOrEqual(3);
    expect(Math.abs(hair[2] - 0x4d)).toBeLessThanOrEqual(3);
  });

  it("interpolates gradients from top to bottom", () => {
    const out = renderPalette(gradients);
    expect(px(out, 3, 0)[1]).toBeLessThan(px(out, 3, 1)[1]);
    expect(gradientAt(gradients[3]!, 0).every((v, i) => v === gradients[3]!.top[i])).toBe(true);
  });
});

describe("with a real KayKit palette", () => {
  const file = fileURLToPath(new URL("../../../public/models/kaykit/characters/Rogue.glb", import.meta.url));
  const { palette } = loadMesh(file, (n) => n.endsWith("Head"));

  it("reads the same colors the sampler sees, and recoloring the skin leaves the eyes untouched", () => {
    const gradients = readGradients(8, 4, (x, y) => palette(Math.min(31, Math.floor(y) * 8 + Math.floor(x))).rgb);
    expect(gradients).toHaveLength(32);
    const out = renderPalette(gradients, { [SKIN_CELL]: "#6e4128" });
    expect(rgbToHex(px(out, SKIN_CELL, 0.5))).toBe("#6e4128");
    const eyes = px(out, EYE_CELL, 0.5);
    expect(eyes.every((v) => v < 60)).toBe(true); // noir des yeux inchangé
  });

  it("lists the cells of a body part by area", () => {
    const body = loadMesh(file, (n) => n.endsWith("Body"));
    const hist = cellHistogram(body.mesh.uvs, body.mesh.indices, cellOfUv);
    expect(hist.length).toBeGreaterThan(1);
    expect(hist[0]![1]).toBeGreaterThanOrEqual(hist[hist.length - 1]![1]);
  });
});
