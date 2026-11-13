import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ACCESSORY_SLOTS, AVATAR_ACCESSORIES, AVATAR_FACES, AVATAR_OUTFITS, PREMIUM_OUTFITS, SHOP_ACCESSORY_PIECES } from "@stepup/shared";
import { USABLE_HEADS } from "./catalogue";
import { ACCESSORIES, OUTFITS } from "./partsCatalogue";
import { listMeshes } from "./readGlb.node";

const dir = fileURLToPath(new URL("../../../public/models/kaykit/characters/", import.meta.url));

describe("catalogue des pièces", () => {
  it("n'a pas d'identifiant en double", () => {
    expect(new Set(OUTFITS.map((o) => o.id)).size).toBe(OUTFITS.length);
    expect(new Set(ACCESSORIES.map((a) => a.id)).size).toBe(ACCESSORIES.length);
  });

  it.each(OUTFITS)("tenue $id : fichier présent, haut et bas complets", (o) => {
    expect(existsSync(dir + o.file)).toBe(true);
    const names = listMeshes(dir + o.file).map((m) => m.name);
    for (const part of ["Body", "ArmLeft", "ArmRight", "LegLeft", "LegRight"]) expect(names.some((n) => n.endsWith(part))).toBe(true);
  });

  it.each(ACCESSORIES)("accessoire $id : maillage présent, type et os cohérents", (a) => {
    const mesh = listMeshes(dir + a.file).find((m) => m.name === a.mesh);
    expect(mesh).toBeDefined();
    expect(mesh!.skinned).toBe(!a.bone);
    if (a.bone) expect(mesh!.bone).toBe(a.bone);
  });
});

describe("accord avec les listes partagées (validation serveur)", () => {
  const ids = (list: readonly { id: string }[]) => list.map((x) => x.id);
  it("tenues : gratuites et de boutique existent dans le catalogue", () => {
    for (const id of [...AVATAR_OUTFITS, ...PREMIUM_OUTFITS]) expect(ids(OUTFITS)).toContain(id);
  });
  it("accessoires : mêmes identifiants et mêmes emplacements, y compris les pièces de boutique", () => {
    for (const a of AVATAR_ACCESSORIES) expect(ACCESSORIES.find((x) => x.id === a.id)?.slot).toBe(a.slot);
    for (const piece of Object.values(SHOP_ACCESSORY_PIECES)) expect(ACCESSORIES.find((x) => x.id === piece.id)?.slot).toBe(piece.slot);
    expect(ACCESSORIES.length).toBe(AVATAR_ACCESSORIES.length + Object.keys(SHOP_ACCESSORY_PIECES).length);
    for (const a of ACCESSORIES) expect(ACCESSORY_SLOTS).toContain(a.slot);
  });
  it("visages : exactement les têtes utilisables du catalogue", () => {
    expect([...AVATAR_FACES].sort()).toEqual(ids(USABLE_HEADS).sort());
  });
  it("visages : chaque tête a un maillage Head et sa texture", () => {
    for (const id of AVATAR_FACES) {
      const names = listMeshes(dir + `${id}.glb`).map((m) => m.name);
      expect(names.some((n) => /Head(_\d+)?$/.test(n)), `${id} sans tête`).toBe(true);
    }
  });
});
