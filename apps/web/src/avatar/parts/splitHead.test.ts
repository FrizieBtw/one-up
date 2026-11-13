import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HEADS, SKULL_BASES, USABLE_HEADS } from "./catalogue";
import { loadHead } from "./readGlb.node";
import { PALETTE_COLS, cellOfUv, countRoles, splitHead, type PaletteSampler } from "./splitHead";

const DIR = fileURLToPath(new URL("../../../public/models/kaykit/characters/", import.meta.url));

describe("palette", () => {
  it("indexes cells row by row, with the glTF origin at the top-left", () => {
    expect(cellOfUv(0.01, 0.01)).toBe(0);
    expect(cellOfUv(0.99, 0.01)).toBe(PALETTE_COLS - 1);
    expect(cellOfUv(0.01, 0.26)).toBe(PALETTE_COLS); // deuxième ligne
    expect(cellOfUv(0.99, 0.99)).toBe(31);
    expect(cellOfUv(-1, 2)).toBe(24); // hors bornes : ramené dans la grille
  });
});

describe("splitHead on a synthetic mesh", () => {
  // Deux quadrilatères séparés : un de peau (case 0), un sombre (case 2) à l'avant.
  const quad = (x: number, y: number, z: number, u: number) => ({
    p: [x, y, z, x + 0.1, y, z, x + 0.1, y + 0.1, z, x, y + 0.1, z],
    uv: [u, 0.1, u, 0.1, u, 0.1, u, 0.1],
  });
  const palette: PaletteSampler = (cell) => (cell === 2 ? { rgb: [19, 25, 27], luminance: 0.09 } : { rgb: [246, 192, 156], luminance: 0.8 });

  it("assigns every triangle to exactly one component", () => {
    const a = quad(0, 0, 0, 0.05);
    const b = quad(0.3, 0, 0.5, 0.3);
    const mesh = { positions: [...a.p, ...b.p], uvs: [...a.uv, ...b.uv], indices: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7] };
    const result = splitHead(mesh, palette);
    expect(result.components.flatMap((c) => c.triangles).sort()).toEqual([0, 1, 2, 3]);
    expect(result.components).toHaveLength(2);
  });

  it("keeps touching shells apart when they use different palette cells", () => {
    // Même sommets partagés, deux cases différentes : doivent rester deux composantes.
    const mesh = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], uvs: [0.05, 0.1, 0.05, 0.1, 0.05, 0.1, 0.3, 0.1], indices: [0, 1, 2, 1, 3, 2] };
    const result = splitHead(mesh, palette);
    expect(result.components).toHaveLength(2);
  });
});

describe("catalogue of KayKit heads (real files)", () => {
  it("documents why each excluded head is excluded", () => {
    for (const h of HEADS.filter((x) => x.exclude)) expect(h.exclude!.length, h.id).toBeGreaterThan(10);
    expect(new Set(HEADS.map((h) => h.id)).size).toBe(HEADS.length);
  });

  it("offers enough bald skull bases and source heads for an editor", () => {
    expect(SKULL_BASES.length).toBeGreaterThanOrEqual(8);
    expect(USABLE_HEADS.length).toBeGreaterThanOrEqual(20);
  });

  describe.each(USABLE_HEADS.map((h) => [h.id, h] as const))("%s", (_id, entry) => {
    const { mesh, palette } = loadHead(DIR + entry.file);
    const result = splitHead(mesh, palette, entry.overrides);
    const counts = countRoles(result);

    it("follows the KayKit palette convention (cell 0 skin, cell 2 dark eyes)", () => {
      // Les peaux foncées existent (Paladin : 0,40) ; ce qui compte, c'est que la case 0 reste bien plus claire que le noir des yeux.
      expect(palette(0).luminance, "peau").toBeGreaterThan(0.3);
      expect(palette(2).luminance, "yeux sombres").toBeLessThan(0.2);
      expect(result.skinCell).toBe(0);
    });

    it("accounts for every triangle", () => {
      expect(result.components.reduce((s, c) => s + c.triangles.length, 0)).toBe(mesh.indices.length / 3);
    });

    it("finds two eyes, two eyebrows and skin", () => {
      expect(counts.eye, "yeux").toBe(2);
      expect(counts.brow, "sourcils").toBe(2);
      expect(counts.skin + counts.nose, "peau").toBeGreaterThan(0);
      expect(counts.other, "pièces non classées").toBe(0);
    });

    if (entry.skull) {
      // Le nez est parfois fondu dans la coque de peau (Driver, Helper_B) : on exige seulement une coque de peau.
      it("has a skin shell, so it can be a bald base", () => {
        expect(counts.skin, "peau").toBeGreaterThanOrEqual(1);
      });
    }
  });
});
