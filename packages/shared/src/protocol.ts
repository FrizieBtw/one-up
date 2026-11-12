import { z } from "zod";
import { CHAT_MAX_LENGTH } from "./config";
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

export const clientMessages = {
  ready: z.object({ ready: z.boolean() }),
  chat: z.object({ text: z.string().trim().min(1).max(CHAT_MAX_LENGTH) }),
  setSetting: z.object({ key: z.string().max(40), value: z.union([z.number(), z.boolean(), z.string().max(40)]) }),
  setCapacity: z.object({ capacity: z.number().int() }),
} as const;

export type ClientMessageType = keyof typeof clientMessages;
export type ClientMessage<T extends ClientMessageType> = z.infer<(typeof clientMessages)[T]>;

// ---------- Messages serveur → client ----------

export interface ServerMessages {
  chat: { fromId: string; name: string; text: string; at: number };
  notice:
    | { type: "settingChanged"; key: string }
    | { type: "capacityChanged"; capacity: number }
    | { type: "hostChanged"; name: string };
  error: { code: "RATE_LIMITED" | "INVALID" | "FORBIDDEN"; message: string };
}

// ---------- État synchronisé du lobby (forme JSON vue par le client) ----------

export type LobbyPhase = "waiting";

export interface LobbyPlayerSnapshot {
  id: string;
  name: string;
  kind: Identity["kind"];
  ready: boolean;
  connected: boolean;
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
