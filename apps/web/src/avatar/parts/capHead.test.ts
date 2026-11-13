import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { boundaryLoops, capCrown } from "./capHead";
import { USABLE_HEADS } from "./catalogue";
import { loadHead } from "./readGlb.node";
import { splitHead } from "./splitHead";

const dir = fileURLToPath(new URL("../../../public/models/kaykit/characters/", import.meta.url));
const skinSet = (id: string) => {
  const entry = USABLE_HEADS.find((h) => h.id === id)!;
  const { mesh, palette } = loadHead(dir + entry.file);
  const split = splitHead(mesh, palette, entry.overrides);
  const triangles = split.components.filter((c) => ["skin", "ear", "nose"].includes(c.role)).flatMap((c) => c.triangles);
  return { mesh, triangles };
};

describe("comblement du dessus du crâne", () => {
  it("ferme un anneau synthétique en calotte tournée vers l'extérieur", () => {
    // Anneau de 16 points à y = 1,6, rayon 0,5, fait de 16 triangles-bandes pour avoir un bord.
    const positions: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      positions.push(Math.cos(a) * 0.5, 1.6, Math.sin(a) * 0.5, Math.cos(a) * 0.5, 1.2, Math.sin(a) * 0.5);
    }
    for (let i = 0; i < 16; i++) {
      const [a, b, c, d] = [2 * i, 2 * i + 1, (2 * i + 2) % 32, (2 * i + 3) % 32];
      indices.push(a, b, c, c, b, d);
    }
    const cap = capCrown({ positions, indices, triangles: Array.from({ length: 32 }, (_, t) => t) });
    expect(cap).not.toBeNull();
    expect(cap!.loopSize).toBe(16);
    expect(cap!.apexY).toBeCloseTo(1.7);
    // Les normales de la calotte regardent vers le haut et l'extérieur.
    const last = cap!.positions.length / 3 - 1;
    expect(cap!.normals[3 * last + 1]).toBeGreaterThan(0.9);
  });

  it("ne fait rien quand il n'y a pas de boucle de ce genre", () => {
    expect(capCrown({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2], triangles: [0] })).toBeNull();
  });

  it.each(USABLE_HEADS.map((h) => h.id))("%s : la calotte ferme la boucle du dessus sans en ouvrir d'autre", (id) => {
    const { mesh, triangles } = skinSet(id);
    const cap = capCrown({ positions: mesh.positions, indices: mesh.indices, triangles });
    const before = boundaryLoops({ positions: mesh.positions, indices: mesh.indices, triangles }).length;
    if (!cap) {
      // Têtes dont le crâne est déjà fermé en haut (peau jusqu'au sommet).
      expect(["Lorekeeper", "Barbarian"]).toContain(id);
      return;
    }
    const n = mesh.positions.length / 3;
    const positions = [...Array.from(mesh.positions), ...cap.positions];
    const indices = [...Array.from(mesh.indices), ...cap.indices.map((i) => i + n)];
    const capTriangles = Array.from({ length: cap.indices.length / 3 }, (_, t) => mesh.indices.length / 3 + t);
    const after = boundaryLoops({ positions, indices, triangles: [...triangles, ...capTriangles] }).length;
    expect(after, `${id} : boucles avant ${before}, après ${after}`).toBe(before - 1);
  });
});
