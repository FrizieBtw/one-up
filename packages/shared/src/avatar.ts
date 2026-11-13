import { z } from "zod";

// Avatar de joueur, assemblé à partir de pièces de personnages KayKit (CC0). Source unique : l'éditeur, le rendu et la validation
// serveur en dérivent. Les listes d'identifiants désignent des pièces de `apps/web/src/avatar/parts` (un test web vérifie l'accord).
//
// Format v3 : peau et cheveux sont des couleurs ; le reste désigne le personnage KayKit dont on prend la pièce.
// Le visage est choisi en un seul bloc (tête d'origine entière : visage, coiffure, barbe). Les formats précédents sont convertis à la lecture :
// v1 (couleurs de tenue, styles de cheveux numérotés, avatar procédural) et v2 (visage recomposé de pièces séparées).

export const AVATAR_OPTIONS = {
  skin: ["#ffd9b8", "#f2b98f", "#c98a5e", "#8a5a3c", "#5a3720", "#8fc46a"],
  hair: ["#2a1b4d", "#6b3a1e", "#f2c14e", "#ff5c6c", "#14c4bd", "#f4f0ff", "#c8501e", "#2f6df2"],
} as const;

/** Visages : têtes d'origine entières des personnages KayKit utilisables. */
export const AVATAR_FACES = [
  "Rogue", "Knight", "Lorekeeper", "Ninja", "Helper_B", "Protagonist_B", "MagicalGirl", "Driver", "Cleric", "Ranger", "Engineer", "Barbarian",
  "Mage", "Paladin", "SpaceRanger", "Hiker", "Caveman", "Protagonist_A", "Farmer_A", "Farmer_B", "ToySoldier", "Witch",
] as const;

/** Tenues gratuites (haut + bas du même personnage). */
export const AVATAR_OUTFITS = [
  "Rogue", "Knight", "Mage", "Ranger", "Barbarian", "Cleric", "Lorekeeper", "Engineer", "Hiker", "Driver", "Farmer_A", "Helper_A",
  "Protagonist_A", "Protagonist_B", "MagicalGirl", "Witch", "Clown", "ActionFigure", "Caveman",
] as const;
/** Tenues de la boutique : jamais proposées par l'éditeur gratuit, appliquées par les cosmétiques. */
export const PREMIUM_OUTFITS = ["Paladin", "SpaceRanger", "ToySoldier"] as const;

export const ACCESSORY_SLOTS = ["hat", "glasses", "mask", "headband", "cape", "backpack"] as const;
export type AccessorySlot = (typeof ACCESSORY_SLOTS)[number];
/** Accessoires gratuits et leur emplacement : un seul par emplacement. (Casquette et lunettes rondes sont des objets de boutique.) */
export const AVATAR_ACCESSORIES = [
  { id: "Knight_Helmet", slot: "hat" },
  { id: "Mage_Hat", slot: "hat" },
  { id: "Witch_Hat", slot: "hat" },
  { id: "Farmer_A_Hat", slot: "hat" },
  { id: "Hiker_Hat", slot: "hat" },
  { id: "Barbarian_BearHat", slot: "hat" },
  { id: "ToySoldier_Hat", slot: "hat" },
  { id: "Clown_Hat", slot: "hat" },
  { id: "Driver_Sunglasses", slot: "glasses" },
  { id: "Protagonist_A_Glasses", slot: "glasses" },
  { id: "Witch_Glasses", slot: "glasses" },
  { id: "Engineer_Goggles", slot: "glasses" },
  { id: "Ninja_Mask", slot: "mask" },
  { id: "ActionFigure_Headband", slot: "headband" },
  { id: "Ninja_Headband", slot: "headband" },
  { id: "Knight_Cape", slot: "cape" },
  { id: "Mage_Cape", slot: "cape" },
  { id: "Paladin_Cape", slot: "cape" },
  { id: "Rogue_Cape", slot: "cape" },
  { id: "Hiker_Backpack", slot: "backpack" },
  { id: "Protagonist_A_Backpack", slot: "backpack" },
  { id: "Engineer_Backpack", slot: "backpack" },
] as const satisfies readonly { id: string; slot: AccessorySlot }[];
/** Pièces réservées aux objets de boutique « casquette » et « lunettes ». */
export const SHOP_ACCESSORY_PIECES = { cap: { id: "Helper_A_Hat", slot: "hat" }, glasses: { id: "Lorekeeper_Glasses", slot: "glasses" } } as const;

const ACCESSORY_IDS = AVATAR_ACCESSORIES.map((a) => a.id) as [string, ...string[]];
const slotOf = (id: string): AccessorySlot | undefined => AVATAR_ACCESSORIES.find((a) => a.id === id)?.slot;


export const avatarConfigSchema = z.object({
  v: z.literal(3),
  skin: z.enum(AVATAR_OPTIONS.skin),
  hairColor: z.enum(AVATAR_OPTIONS.hair),
  face: z.enum(AVATAR_FACES),
  outfit: z.enum(AVATAR_OUTFITS),
  legs: z.enum(AVATAR_OUTFITS),
  /** Accessoires choisis : un par emplacement au plus. Pas encore proposés par l'éditeur. */
  acc: z
    .array(z.enum(ACCESSORY_IDS))
    .max(ACCESSORY_SLOTS.length)
    .refine((ids) => new Set(ids.map(slotOf)).size === ids.length, "un seul accessoire par emplacement"),
});
export type AvatarConfig = z.infer<typeof avatarConfigSchema>;

/** Avatar par défaut, stable pour une graine (identité d'un invité ou d'un compte sans avatar personnalisé). */
export function avatarFromSeed(seed: string): AvatarConfig {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  const pick = <T>(list: readonly T[]): T => {
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
    return list[(hash >>> 0) % list.length]!;
  };
  return {
    v: 3,
    skin: pick(AVATAR_OPTIONS.skin),
    hairColor: pick(AVATAR_OPTIONS.hair),
    face: pick(AVATAR_FACES),
    outfit: pick(AVATAR_OUTFITS),
    legs: pick(AVATAR_OUTFITS),
    acc: [],
  };
}

/** v2 : visage recomposé (crâne, coiffure, barbe, yeux…). On garde le visage de base ; coiffure et barbe choisies séparément ne sont plus proposées. */
const v2Schema = z
  .object({
    v: z.literal(2),
    skin: z.enum(AVATAR_OPTIONS.skin),
    hairColor: z.enum(AVATAR_OPTIONS.hair),
    skull: z.enum(AVATAR_FACES),
    outfit: z.enum(AVATAR_OUTFITS),
    legs: z.enum(AVATAR_OUTFITS),
    acc: z.array(z.enum(ACCESSORY_IDS)).max(ACCESSORY_SLOTS.length),
  })
  .passthrough();

function migrateV2(value: unknown): AvatarConfig | null {
  const parsed = v2Schema.safeParse(value);
  if (!parsed.success) return null;
  const { skin, hairColor, skull, outfit, legs, acc } = parsed.data;
  const result = avatarConfigSchema.safeParse({ v: 3, skin, hairColor, face: skull, outfit, legs, acc });
  return result.success ? result.data : null;
}

/** v1 : couleurs et styles numérotés. Chaque ancien choix a un équivalent. */
const V1_OUTFIT_COLORS = ["#6c3bf5", "#14c4bd", "#ff8a1f", "#ff5c6c", "#ffd23f", "#3fa7ff"] as const;
const V1_OUTFITS = ["Rogue", "Mage", "Ranger", "Farmer_A", "Hiker", "Protagonist_A"] as const;
const V1_FACES = ["Knight", "Rogue", "MagicalGirl"] as const;
const v1Schema = z.object({
  skin: z.enum(AVATAR_OPTIONS.skin),
  hair: z.enum(AVATAR_OPTIONS.hair),
  outfit: z.enum(V1_OUTFIT_COLORS),
  hairStyle: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  eyeStyle: z.union([z.literal(0), z.literal(1)]),
});

function migrateV1(value: unknown): AvatarConfig | null {
  const parsed = v1Schema.safeParse(value);
  if (!parsed.success) return null;
  const old = parsed.data;
  const outfit = V1_OUTFITS[V1_OUTFIT_COLORS.indexOf(old.outfit)]!;
  return { v: 3, skin: old.skin, hairColor: old.hair, face: V1_FACES[old.hairStyle], outfit, legs: outfit, acc: [] };
}

/** Configuration valide (v3, convertie si besoin depuis v2 ou v1), ou null (JSON absent, corrompu ou hors des options autorisées). */
export function parseAvatarConfig(value: unknown): AvatarConfig | null {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const parsed = avatarConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : (migrateV2(value) ?? migrateV1(value));
}
