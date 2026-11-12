// Nom provisoire : tout le produit lit ces constantes, ne jamais écrire le nom en dur ailleurs.
export const APP_NAME = "StepUp";
export const CURRENCY_NAME = "jetons";

export const RECONNECT_WINDOW_SECONDS = 60;
/** Durée de déconnexion tolérée avant de transférer le rôle d'hôte. */
export const HOST_GRACE_SECONDS = 10;
export const LAUNCH_COUNTDOWN_SECONDS = 5;

export const CHAT_MAX_LENGTH = 200;
export const CHAT_RATE = { max: 5, windowMs: 10_000 };

export const LOBBY_ROOM_NAME = "lobby";

// ---------- Salle de lobby 3D ----------
/** Rayon praticable de la salle (unités monde) et vitesse de marche (unités/s). */
export const LOBBY_RADIUS = 4;
export const LOBBY_SPEED = 4;
export const LOBBY_TICK_MS = 50;
/** Distance au centre à laquelle les joueurs apparaissent. */
export const LOBBY_SPAWN_RADIUS = 2;

export const EMOTES = [
  { id: "wave", label: "Salut" },
  { id: "dance", label: "Danse" },
  { id: "cheer", label: "Bravo" },
  { id: "laugh", label: "Rire" },
] as const;
export type EmoteId = (typeof EMOTES)[number]["id"];
export const EMOTE_IDS = EMOTES.map((e) => e.id) as [EmoteId, ...EmoteId[]];
export const EMOTE_DURATION_MS = 2500;
export const EMOTE_RATE = { max: 2, windowMs: 3000 };

// ---------- Propositions de règles ----------
export const MAX_OPEN_PROPOSALS = 5;
/** Une proposition par joueur sur cette fenêtre. */
export const PROPOSAL_RATE = { max: 1, windowMs: 10_000 };
/** Clé de proposition réservée à la capacité du salon (les autres clés sont des réglages du jeu). */
export const CAPACITY_KEY = "capacity";

export const REPORT_RATE = { max: 3, windowMs: 60_000 };
