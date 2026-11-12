import { z } from "zod";
import { CHAT_MAX_LENGTH, EMOTE_IDS, type EmoteId } from "./config";
import { GAME_IDS, type GameId, type SettingValue } from "./games";

// ---------- Identité ----------

export const playerNameSchema = z
  .string()
  .trim()
  .min(3)
  .max(16)
  .regex(/^[\p{L}\p{N}_\- ]+$/u, "Lettres, chiffres, espace, - et _ uniquement");

export interface Identity {
  id: string;
  name: string;
  kind: "guest" | "user";
}

// ---------- Création / accès salon ----------

export const createLobbyOptionsSchema = z.object({
  gameId: z.enum(GAME_IDS),
  isPublic: z.boolean(),
});
export type CreateLobbyOptions = z.infer<typeof createLobbyOptionsSchema>;

/** Raisons de refus renvoyées par le serveur (message d'erreur de jointure). */
export const JoinError = {
  Unauthorized: "UNAUTHORIZED",
  AlreadyInRoom: "ALREADY_IN_ROOM",
  InProgress: "IN_PROGRESS",
} as const;

// ---------- Messages client → serveur (toujours validés côté serveur) ----------

const empty = z.object({});
const settingChange = z.object({ key: z.string().max(40), value: z.union([z.number(), z.boolean(), z.string().max(40)]) });

export const clientMessages = {
  ready: z.object({ ready: z.boolean() }),
  chat: z.object({ text: z.string().trim().min(1).max(CHAT_MAX_LENGTH) }),
  setSetting: settingChange,
  setCapacity: z.object({ capacity: z.number().int() }),
  /** Intention de déplacement (direction), jamais une position : le serveur simule. */
  move: z.object({ x: z.number(), z: z.number() }),
  emote: z.object({ id: z.enum(EMOTE_IDS) }),
  /** Proposition de changement de règle ; `key` vaut CAPACITY_KEY pour la capacité. */
  propose: settingChange,
  vote: z.object({ id: z.string().max(20), approve: z.boolean() }),
  resolveProposal: z.object({ id: z.string().max(20), accept: z.boolean() }),
  report: z.object({ sessionId: z.string().max(40), reason: z.string().trim().max(200).optional() }),
  /** Hôte : lance le compte à rebours, ou l'annule. */
  start: empty,
  cancelStart: empty,
  /** Hôte, écran de résultats : retour au lobby. */
  backToLobby: empty,
  // Blackjack
  bjAction: z.object({ action: z.enum(["hit", "stand"]) }),
  /** Hôte, entre deux manches : manche suivante immédiate, ou fin de session. */
  bjNext: empty,
  bjEnd: empty,
} as const;

export type ClientMessageType = keyof typeof clientMessages;
export type ClientMessage<T extends ClientMessageType> = z.infer<(typeof clientMessages)[T]>;

// ---------- Messages serveur → client ----------

export interface ServerMessages {
  chat: { fromId: string; name: string; text: string; at: number };
  notice:
    | { type: "settingChanged"; key: string }
    | { type: "capacityChanged"; capacity: number }
    | { type: "hostChanged"; name: string }
    | { type: "proposalCreated"; name: string; key: string }
    | { type: "proposalResolved"; key: string; accepted: boolean }
    | { type: "launchCancelled" };
  emote: { sessionId: string; id: EmoteId };
  error: { code: "RATE_LIMITED" | "INVALID" | "FORBIDDEN"; message: string };
}

// ---------- État synchronisé du lobby (forme JSON vue par le client) ----------

/** waiting : lobby · countdown : compte à rebours de lancement · playing : partie · results : écran de résultats */
export type LobbyPhase = "waiting" | "countdown" | "playing" | "results";

export interface LobbyPlayerSnapshot {
  id: string;
  name: string;
  kind: Identity["kind"];
  ready: boolean;
  connected: boolean;
  /** Position dans la salle (autorité serveur) et direction de déplacement courante. */
  x: number;
  z: number;
  dx: number;
  dz: number;
}

export interface ProposalSnapshot {
  id: string;
  authorName: string;
  key: string;
  /** JSON de SettingValue */
  value: string;
  votesFor: number;
  votesAgainst: number;
}

export interface LobbySnapshot {
  code: string;
  gameId: GameId;
  isPublic: boolean;
  hostSessionId: string;
  capacity: number;
  phase: LobbyPhase;
  /** JSON de Record<string, SettingValue> */
  settings: string;
  players: Record<string, LobbyPlayerSnapshot>;
  proposals: Record<string, ProposalSnapshot>;
  /** Secondes restantes avant le lancement (phase countdown). */
  countdown: number;
  blackjack: BlackjackSnapshot;
}

// ---------- Blackjack Battle ----------

export interface CardSnapshot {
  rank: string;
  suit: string;
}

export interface BlackjackPlayerSnapshot {
  name: string;
  cards: CardSnapshot[];
  /** playing : doit encore jouer · stood · bust · blackjack (naturel) */
  status: "playing" | "stood" | "bust" | "blackjack";
  /** Résultat de la manche, vide tant qu'elle n'est pas résolue. */
  result: "" | "win" | "push" | "loss";
  score: number;
  wins: number;
  pushes: number;
  losses: number;
}

export interface BlackjackSnapshot {
  round: number;
  /** playing : tours des joueurs · dealer : le croupier joue · roundEnd : entre deux manches · finished */
  stage: "playing" | "dealer" | "roundEnd" | "finished";
  /** Session dont c'est le tour, ou chaîne vide. */
  turn: string;
  /** Secondes restantes : décision du joueur actif (playing) ou avant la manche suivante (roundEnd). */
  seconds: number;
  /** Cartes visibles du croupier ; la seconde reste cachée (côté serveur) tant que `dealerHidden`. */
  dealer: CardSnapshot[];
  dealerHidden: boolean;
  /** Par session, dans l'ordre de jeu. */
  players: Record<string, BlackjackPlayerSnapshot>;
}

export function parseSettings(json: string): Record<string, SettingValue> {
  return JSON.parse(json) as Record<string, SettingValue>;
}

/** Entrée de la liste des salons publics (GET /rooms?game=...). */
export interface PublicRoomInfo {
  code: string;
  gameId: GameId;
  hostName: string;
  players: number;
  capacity: number;
  phase: LobbyPhase;
}
