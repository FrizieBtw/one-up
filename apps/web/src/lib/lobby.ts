"use client";

import { Client, type Room } from "@colyseus/sdk";
import { JoinError, LOBBY_ROOM_NAME, type CreateLobbyOptions, type PublicRoomInfo } from "@stepup/shared";
import { GAME_SERVER_URL } from "./env";
import { getAuthToken } from "./session";

const client = new Client(GAME_SERVER_URL);

// Une seule connexion de lobby par onglet. Elle vit hors de React : un remontage de composant
// (mode strict, navigation) ne doit ni dupliquer le joueur ni fermer le salon.
let current: { code: string; room: Promise<Room> } | null = null;

const tokenKey = (code: string) => `stepup-reconnect-${code}`;

function track(room: Room): Room {
  const save = () => sessionStorage.setItem(tokenKey(room.roomId), room.reconnectionToken);
  save();
  room.onReconnect(save);
  room.onLeave(() => {
    if (current?.code === room.roomId) current = null;
  });
  return room;
}

async function authed(): Promise<void> {
  const token = await getAuthToken();
  if (!token) throw new Error(JoinError.Unauthorized);
  client.auth.token = token;
}

export async function createLobby(options: CreateLobbyOptions): Promise<string> {
  await leaveLobby();
  await authed();
  const room = track(await client.create(LOBBY_ROOM_NAME, options));
  current = { code: room.roomId, room: Promise.resolve(room) };
  return room.roomId;
}

/** Rejoint le salon (ou reprend la connexion existante / le siège réservé après un rechargement). */
export function connectLobby(code: string): Promise<Room> {
  if (current?.code === code) return current.room;
  const previous = leaveLobby();
  const room = (async () => {
    await previous;
    await authed();
    const reconnectionToken = sessionStorage.getItem(tokenKey(code));
    if (reconnectionToken) {
      try {
        return track(await client.reconnect(reconnectionToken));
      } catch {
        sessionStorage.removeItem(tokenKey(code)); // siège expiré : jointure normale
      }
    }
    return track(await client.joinById(code));
  })();
  current = { code, room };
  room.catch(() => {
    if (current?.room === room) current = null;
  });
  return room;
}

export async function leaveLobby(): Promise<void> {
  const leaving = current;
  current = null;
  if (!leaving) return;
  sessionStorage.removeItem(tokenKey(leaving.code));
  await leaving.room.then((room) => room.leave()).catch(() => {});
}

export async function fetchPublicRooms(gameId: string): Promise<PublicRoomInfo[]> {
  const res = await fetch(`${GAME_SERVER_URL}/rooms?game=${encodeURIComponent(gameId)}`);
  if (!res.ok) throw new Error("Liste des salons indisponible.");
  return res.json();
}

/** Traduit une erreur de jointure du serveur en message lisible. */
export function describeJoinError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes(JoinError.Unauthorized)) return "Session expirée : reconnectez-vous depuis l'accueil.";
  if (message.includes(JoinError.AlreadyInRoom)) return "Vous êtes déjà dans ce salon (autre onglet ?).";
  if (message.includes(JoinError.InProgress)) return "La partie a déjà commencé.";
  if (message.includes("not found")) return "Salon introuvable. Vérifiez le code.";
  if (message.includes("locked")) return "Salon complet.";
  return "Connexion au salon impossible. Le serveur de jeu est-il démarré ?";
}
