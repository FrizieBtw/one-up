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
];
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
