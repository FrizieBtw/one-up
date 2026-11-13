import { z } from "zod";
import { PREMIUM_OUTFITS } from "./avatar";

// Cosmétiques de la boutique. Tous purement visuels : aucun n'influence une règle de jeu.
// Les objets vivent en base (`shop_items`, avec une charge utile) ; ce module traduit leur charge utile
// en apparence, et sert à la fois au rendu et à la validation côté serveur de jeu.

export const COSMETIC_ACCESSORIES = ["glasses", "cap"] as const;

export const cosmeticsSchema = z.object({
  /** Tenue premium (haut et bas du personnage KayKit correspondant ; remplace la tenue choisie dans l'éditeur). */
  outfit: z.enum(PREMIUM_OUTFITS).optional(),
  accessory: z.enum(COSMETIC_ACCESSORIES).optional(),
});
export type AvatarCosmetics = z.infer<typeof cosmeticsSchema>;

/** Ligne d'inventaire avec la catégorie et la charge utile de son objet. */
export interface InventoryEntry {
  category: string;
  payload: unknown;
}

const field = (payload: unknown, key: string): unknown =>
  payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>)[key] : undefined;

/** Cosmétiques valides à partir d'un JSON ou d'un objet ; toute valeur inconnue est ignorée, jamais rejetée en bloc. */
export function parseCosmetics(value: unknown): AvatarCosmetics {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  const result: AvatarCosmetics = {};
  for (const key of ["outfit", "accessory"] as const) {
    const parsed = cosmeticsSchema.shape[key].safeParse(field(value, key));
    if (parsed.success && parsed.data !== undefined) (result as Record<string, unknown>)[key] = parsed.data;
  }
  return result;
}

/** Apparence issue des objets équipés (un par catégorie au plus, garanti par la base). */
export function cosmeticsFromEquipped(equipped: readonly InventoryEntry[]): AvatarCosmetics {
  const raw: Record<string, unknown> = {};
  for (const { category, payload } of equipped) {
    if (category === "outfit") raw.outfit = field(payload, "outfit");
    if (category === "accessory") raw.accessory = field(payload, "accessory");
  }
  return parseCosmetics(raw);
}

/** Identifiants des emotes débloquées par les objets possédés. */
export function ownedEmoteIds(owned: readonly InventoryEntry[]): string[] {
  return owned.flatMap(({ category, payload }) => {
    const emote = category === "emote" ? field(payload, "emote") : undefined;
    return typeof emote === "string" ? [emote] : [];
  });
}
