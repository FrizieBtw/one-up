// Nom provisoire : tout le produit lit ces constantes, ne jamais écrire le nom en dur ailleurs.
export const APP_NAME = "StepUp";
export const CURRENCY_NAME = "jetons";

export const RECONNECT_WINDOW_SECONDS = 60;
/** Durée de déconnexion tolérée avant de transférer le rôle d'hôte. */
export const HOST_GRACE_SECONDS = 10;
export const LAUNCH_COUNTDOWN_SECONDS = 5;

export const CHAT_MAX_LENGTH = 200;
export const CHAT_RATE = { max: 5, windowMs: 10_000 };

/** Blackjack : délai avant la manche suivante si l'hôte ne décide rien (évite les sessions bloquées). */
export const BLACKJACK_NEXT_ROUND_SECONDS = 15;
/** Mises à la table : temps pour miser avant la distribution, mise minimale et maximale, valeurs des jetons proposés. */
export const BLACKJACK_BET_SECONDS = 20;
export const BLACKJACK_MIN_BET = 5;
export const BLACKJACK_MAX_BET = 500;
export const BLACKJACK_CHIPS = [5, 25, 100, 500] as const;

export const LOBBY_ROOM_NAME = "lobby";

// ---------- Chambre partagée (salle 3D carrée) ----------
/** La chambre est un carré de -ROOM_HALF à ROOM_HALF (unités monde) ; les joueurs y marchent ou y courent (unités/s). */
export const ROOM_HALF = 2.75;
export const AVATAR_RADIUS = 0.25;
export const LOBBY_SPEED = 1.5;
export const RUN_SPEED = 3;
export const LOBBY_TICK_MS = 50;
/** Meubles au sol ou contre un mur : emprises (x0, x1, z0, z1) que les personnages contournent, identiques pour le serveur et le client. */
export const ROOM_BLOCKS: readonly (readonly [
  number,
  number,
  number,
  number,
])[] = [
  [0.88, 2.32, -3, -2.25], // bureau, écran et console
  [-1.55, -0.45, -3, -2.75], // miroir
  [1.05, 1.45, -3, -2.7], // écran (sur le bureau)
  [1.8, 2.2, -2.7, -2.3], // console (sur le bureau)
  [1.55, 1.75, -2.45, -2.25], // manette (sur le bureau)
];
/** Hauteur (au-dessus du sol) du dessus de chaque meuble de ROOM_BLOCKS : on saute dessus s'il est plus bas que le saut. Le miroir est trop haut ; écran, console et manette sont posés sur le bureau. */
export const ROOM_BLOCK_HEIGHTS: readonly number[] = [0.48, 9, 0.95, 0.7, 0.62];
/**
 * Table de blackjack posée dans la chambre pendant une partie : croupier dans le coin du fond, 8 places en arc tournées vers le bas de l'écran.
 * Positions identiques pour le serveur (qui y place les joueurs) et le client (qui y dessine la table).
 */
export const BLACKJACK_TABLE = {
  x: -0.6,
  z: -0.6,
  seatRadius: 1.95,
  seats: 8,
  arcDegrees: 150,
  facingDegrees: 45,
};
/** Position d'une place (0 = à gauche de l'écran) et direction (rotation Y) pour regarder le croupier. */
export function blackjackSeat(index: number): {
  x: number;
  z: number;
  facing: number;
} {
  const { x, z, seatRadius, seats, arcDegrees, facingDegrees } =
    BLACKJACK_TABLE;
  // La table est tournée en diagonale : ses places font face au bas de l'écran (la caméra est en (+x, +z)).
  const angle =
    ((facingDegrees - arcDegrees / 2 + (arcDegrees * index) / (seats - 1)) *
      Math.PI) /
    180;
  const sx = x + Math.sin(angle) * seatRadius;
  const sz = z + Math.cos(angle) * seatRadius;
  // Face au centre de la table.
  return { x: sx, z: sz, facing: Math.atan2(x - sx, z - sz) };
}

/** Point d'apparition (au centre de la chambre, côté caméra) et dispersion. */
export const ROOM_SPAWN = { x: 0, z: 1.8, spread: 0.8 };

/** `item` : objet de boutique qui débloque l'emote (sans `item`, elle est gratuite). */
export const EMOTES = [
  { id: "wave", label: "Salut" },
  { id: "cheer", label: "Bravo" },
  { id: "laugh", label: "Rire" },
  { id: "spin", label: "Toupie", item: "emote_spin" },
  { id: "bow", label: "Révérence", item: "emote_bow" },
] as const;
export type EmoteId = (typeof EMOTES)[number]["id"];
/** Emotes gratuites, utilisables par tous (invités compris). */
export const FREE_EMOTE_IDS: readonly string[] = EMOTES.filter(
  (e) => !("item" in e),
).map((e) => e.id);
export const EMOTE_IDS = EMOTES.map((e) => e.id) as [EmoteId, ...EmoteId[]];
export const EMOTE_DURATION_MS = 2500;
export const EMOTE_RATE = { max: 2, windowMs: 3000 };

// ---------- Propositions de règles ----------
export const MAX_OPEN_PROPOSALS = 5;
/** Une proposition par joueur sur cette fenêtre. */
export const PROPOSAL_RATE = { max: 1, windowMs: 10_000 };
/** Clé de proposition réservée à la capacité du salon (les autres clés sont des réglages du jeu). */
/** Une chambre accueille toujours 8 joueurs au plus ; un jeu qui en accepte moins ne peut juste pas être lancé. */
export const ROOM_CAPACITY = 8;

export const REPORT_RATE = { max: 3, windowMs: 60_000 };
