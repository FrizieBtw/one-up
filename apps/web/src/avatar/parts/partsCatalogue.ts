/**
 * Catalogue des pièces de corps et d'accessoires KayKit (étape 2 du chantier d'éditeur de personnage).
 * Toutes les pièces partagent le même squelette de 23 os : elles s'emboîtent d'un personnage à l'autre.
 * - Haut : `Body` + `ArmLeft` + `ArmRight` du même personnage (les bras suivent le vêtement, ils ne s'échangent pas seuls).
 * - Bas : `LegLeft` + `LegRight` du même personnage.
 * - Accessoire : un maillage à part du fichier ; `skinned` = habillé sur le squelette, sinon accroché à l'os `bone`.
 * Écartés : armes et objets (Cigar, HolyWater, WindupKey, Quiver), créatures et tenues qui masquent le corps entier.
 * Relecture visuelle : /dev/avatar-parts/assembly (développement seulement).
 */
export type AccessorySlot = "hat" | "glasses" | "mask" | "headband" | "cape" | "backpack";

export interface OutfitEntry {
  id: string;
  label: string;
  file: string;
}

export interface AccessoryEntry {
  id: string;
  label: string;
  file: string;
  /** Nom exact du maillage dans le fichier. */
  mesh: string;
  slot: AccessorySlot;
  /** Accroché à un os plutôt qu'habillé sur le squelette. */
  bone?: string;
}

const outfit = (id: string, label: string): OutfitEntry => ({ id, label, file: `${id}.glb` });

/** Personnages dont le haut et le bas servent de tenues. */
export const OUTFITS: OutfitEntry[] = [
  outfit("Rogue", "Voleur"),
  outfit("Knight", "Chevalier"),
  outfit("Mage", "Mage"),
  outfit("Ranger", "Rôdeur"),
  outfit("Paladin", "Paladin"),
  outfit("Barbarian", "Barbare"),
  outfit("Cleric", "Clerc"),
  outfit("Lorekeeper", "Érudit"),
  outfit("Engineer", "Ingénieur"),
  outfit("Hiker", "Randonneur"),
  outfit("Driver", "Pilote"),
  outfit("SpaceRanger", "Astronaute"),
  outfit("Farmer_A", "Fermier"),
  outfit("Helper_A", "Assistant"),
  outfit("Protagonist_A", "Héros"),
  outfit("Protagonist_B", "Héroïne"),
  outfit("MagicalGirl", "Magicienne"),
  outfit("Witch", "Sorcière"),
  outfit("ToySoldier", "Soldat de plomb"),
  outfit("Clown", "Clown"),
  outfit("ActionFigure", "Figurine"),
  outfit("Caveman", "Homme des cavernes"),
];

const acc = (id: string, file: string, slot: AccessorySlot, label: string, extra: { bone?: string } = {}): AccessoryEntry => ({
  id,
  label,
  file: `${file}.glb`,
  mesh: id,
  slot,
  ...extra,
});

export const ACCESSORIES: AccessoryEntry[] = [
  acc("Knight_Helmet", "Knight", "hat", "Heaume"),
  acc("Mage_Hat", "Mage", "hat", "Chapeau de mage"),
  acc("Witch_Hat", "Witch", "hat", "Chapeau pointu"),
  acc("Farmer_A_Hat", "Farmer_A", "hat", "Chapeau de paille"),
  acc("Helper_A_Hat", "Helper_A", "hat", "Casquette"),
  acc("Hiker_Hat", "Hiker", "hat", "Chapeau de randonnée"),
  acc("Barbarian_BearHat", "Barbarian", "hat", "Coiffe d'ours"),
  acc("ToySoldier_Hat", "ToySoldier", "hat", "Shako"),
  acc("Clown_Hat", "Clown", "hat", "Chapeau de clown", { bone: "head" }),
  acc("Driver_Sunglasses", "Driver", "glasses", "Lunettes de soleil", { bone: "head" }),
  acc("Lorekeeper_Glasses", "Lorekeeper", "glasses", "Lunettes rondes"),
  acc("Protagonist_A_Glasses", "Protagonist_A", "glasses", "Lunettes carrées"),
  acc("Witch_Glasses", "Witch", "glasses", "Lunettes de sorcière"),
  acc("Engineer_Goggles", "Engineer", "glasses", "Lunettes de protection"),
  acc("Ninja_Mask", "Ninja", "mask", "Masque de ninja"),
  acc("ActionFigure_Headband", "ActionFigure", "headband", "Bandeau", { bone: "head" }),
  acc("Ninja_Headband", "Ninja", "headband", "Bandeau de ninja"),
  acc("Knight_Cape", "Knight", "cape", "Cape courte"),
  acc("Mage_Cape", "Mage", "cape", "Cape de mage"),
  acc("Paladin_Cape", "Paladin", "cape", "Cape de paladin", { bone: "chest" }),
  acc("Rogue_Cape", "Rogue", "cape", "Cape du voleur"),
  acc("Hiker_Backpack", "Hiker", "backpack", "Sac de randonnée"),
  acc("Protagonist_A_Backpack", "Protagonist_A", "backpack", "Sac à dos"),
  acc("Engineer_Backpack", "Engineer", "backpack", "Sac d'ingénieur"),
];

export const SLOT_LABEL: Record<AccessorySlot, string> = {
  hat: "Chapeau",
  glasses: "Lunettes",
  mask: "Masque",
  headband: "Bandeau",
  cape: "Cape",
  backpack: "Sac",
};
