import type { HeadOverrides, PartRole } from "./splitHead";

/**
 * Catalogue des têtes KayKit utilisables comme source de pièces (visage, cheveux, barbe, sourcils, yeux).
 * - `file` : fichier sous `public/models/kaykit/characters/`.
 * - `skull` : une fois les cheveux retirés, la tête reste un crâne complet (rond, sans trou) : elle peut servir de base chauve.
 * - `roles` : pièces que la tête fournit à l'éditeur (par défaut toutes, sauf « other »). Ex. : un capuchon n'est pas une coiffure.
 * - `overrides` : corrections de palette quand le classement automatique se trompe.
 * - `exclude` : raison pour laquelle la tête n'alimente pas l'éditeur.
 * Relecture visuelle : page /dev/avatar-parts (développement seulement).
 */
export interface HeadEntry {
  id: string;
  label: string;
  file: string;
  skull: boolean;
  roles?: PartRole[];
  overrides?: HeadOverrides;
  exclude?: string;
}

const head = (id: string, label: string, extra: Partial<HeadEntry> = {}): HeadEntry => ({ id, label, file: `${id}.glb`, skull: false, ...extra });
const skull = { skull: true } as const;
/** Une tête dont seuls les traits du visage servent (peau, nez, yeux, sourcils), pas la coiffure. */
const FACE_ONLY: PartRole[] = ["skin", "ear", "nose", "eye", "brow"];

export const HEADS: HeadEntry[] = [
  // Têtes complètes : crâne chauve utilisable, plus coiffure, barbe et traits.
  head("Rogue", "Longs cheveux châtains", skull),
  head("Knight", "Cheveux courts", skull),
  head("Lorekeeper", "Chauve, longue barbe", skull),
  head("Ninja", "Chignon", skull),
  head("Helper_B", "Cheveux courts souriant", skull),
  head("Protagonist_B", "Bandeau", skull),
  head("MagicalGirl", "Couettes", skull),
  head("Driver", "Coupe en brosse", skull),
  head("Cleric", "Visage seul (le capuchon n'est pas une coiffure)", { ...skull, roles: FACE_ONLY }),

  // Têtes sources : fournissent coiffure, barbe, sourcils et yeux, mais ont un crâne ouvert sous les cheveux.
  head("Ranger", "Cheveux mi-longs, bouc"),
  head("Engineer", "Barbe rousse fournie"),
  head("Barbarian", "Barbe épaisse"),
  head("Mage", "Longs cheveux sombres"),
  head("Paladin", "Cheveux courts, barbe"),
  head("SpaceRanger", "Cheveux courts"),
  head("Hiker", "Cheveux courts, barbe"),
  head("Caveman", "Cheveux en pétard, barbe"),
  head("Protagonist_A", "Casquette et cheveux"),
  head("Farmer_A", "Barbe et cheveux"),
  head("Farmer_B", "Cheveux longs"),
  head("ToySoldier", "Cheveux sombres"),
  head("Witch", "Longs cheveux blonds"),

  // Écartées : le résultat ne convient pas à l'éditeur.
  head("Druid", "Capuche à bois", { exclude: "capuche et bois qui recouvrent toute la tête" }),
  head("Rogue_Hooded", "Capuche", { exclude: "capuche qui recouvre la tête et les oreilles" }),
  head("Survivalist", "Cache-œil", { exclude: "cache-œil peint dans la palette, pris pour un sourcil" }),
  head("Monster", "Costume de monstre", { exclude: "tête de créature, sans yeux ni sourcils humains" }),
  head("PlantWarrior", "Guerrier végétal", { exclude: "tête de créature, sans sourcils" }),
  head("Superhero", "Masque", { exclude: "masque qui recouvre le haut du visage" }),
  head("Clown", "Clown", { exclude: "visage maquillé : teint et sourcils peints dans la palette" }),
];

/** Têtes qui alimentent l'éditeur. */
export const USABLE_HEADS = HEADS.filter((h) => !h.exclude);
/** Bases chauves possibles. */
export const SKULL_BASES = USABLE_HEADS.filter((h) => h.skull);
