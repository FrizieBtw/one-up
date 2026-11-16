"use client";

import type { Room } from "@colyseus/sdk";
import { keepAcrossReloads } from "./hmr";
import { create } from "zustand";
import {
  GAMES,
  getGame,
  type GameId,
  type LobbySnapshot,
  type ServerMessages,
} from "@stepup/shared";
import { useDisplay } from "./display";
import { useEconomy } from "./economy";
import {
  connectLobby,
  createLobby,
  describeJoinError,
  leaveLobby,
} from "./lobby";
import { useNav } from "./nav";

// La chambre du joueur est un salon du serveur de jeu : le sien (créé dès l'arrivée dans la chambre : elle a toujours un code) ou celui d'un autre qu'il a rejoint par son code. Tant qu'aucun salon n'existe, la chambre est solo.
// Quand la partie démarre, l'écran de jeu prend le relais ; quand elle se termine, on revient ici.

/** Ligne du fil : message de chat (avec `name` et `fromId`) ou annonce système. */
export interface FeedLine {
  key: number;
  fromId?: string;
  /** Couleur choisie par l'expéditeur d'un message. */
  color?: string;
  name?: string;
  text: string;
  /** Pseudo cité dans une annonce système (affiché en gras). */
  who?: string;
}

interface Chamber {
  code: string | null;
  room: Room | null;
  /** Création ou jointure en cours (le serveur répond). */
  creating: boolean;
  error: string | null;
  /** Jeu du salon (connu tout de suite, avant que l'état du salon n'arrive). */
  gameId: string | null;
  snapshot: LobbySnapshot | null;
  /** Compteur de jointures réussies (déclenche l'animation d'arrivée du joueur local). */
  joinSeq: number;
  online: boolean;
  feed: FeedLine[];
  notice: string | null;
  rewards: ServerMessages["rewards"] | null;
}

const EMPTY = {
  code: null,
  room: null,
  snapshot: null,
  online: true,
  feed: [],
  notice: null,
  rewards: null,
  gameId: null,
} satisfies Partial<Chamber>;

export const useChamber = keepAcrossReloads("stepup:chamber", () =>
  create<Chamber>(() => ({
    ...EMPTY,
    creating: false,
    error: null,
    joinSeq: 0,
  })),
);

let feedKey = 0;
/** Ajoute une ligne au fil (messages du serveur ou message local quand la chambre est solo). */
export function pushFeed(line: Omit<FeedLine, "key">) {
  useChamber.setState((s) => ({
    feed: [...s.feed.slice(-99), { ...line, key: feedKey++ }],
  }));
}

const settingLabel = (gameId: string | undefined, key: string) =>
  getGame(gameId ?? "")?.settings.find((s) => s.key === key)?.label ?? key;

// Les positions changent 20 fois par seconde et sont lues directement par la scène 3D :
// elles ne doivent pas provoquer de rendu React de l'interface.
const withoutMotion = (key: string, value: unknown) =>
  ["x", "z", "dx", "dz", "run"].includes(key) ? undefined : value;

/** Branche le salon : état, fil de chat, annonces, récompenses et passage chambre ↔ partie. */
function attach(room: Room, code: string) {
  // `banner: false` : la ligne n'apparaît que dans le chat, sans bandeau.
  const announce = (text: string, banner = true, who?: string) => {
    pushFeed({ text, who });
    if (!banner) return;
    useChamber.setState({ notice: text });
    setTimeout(
      () =>
        useChamber.getState().notice === text &&
        useChamber.setState({ notice: null }),
      4000,
    );
  };
  const on = <K extends keyof ServerMessages>(
    type: K,
    handler: (message: ServerMessages[K]) => void,
  ) => room.onMessage(type, handler);
  const label = (key: string) => settingLabel(room.state?.gameId, key);

  on("chat", (m) =>
    pushFeed({ fromId: m.fromId, name: m.name, color: m.color, text: m.text }),
  );
  on("error", (m) => pushFeed({ text: m.message }));
  on("rewards", (reward) => {
    useChamber.setState({ rewards: reward });
    void useEconomy.getState().refresh(); // le solde a changé
  });
  on("notice", (m) => {
    switch (m.type) {
      case "hostChanged":
        return announce(`${m.name} est maintenant l'hôte.`, true, m.name);
      case "playerKicked":
        return announce(`${m.name} a été exclu de la chambre.`, false, m.name);
      case "playerJoined":
        return announce(`${m.name} a rejoint la chambre.`, false, m.name);
      case "playerLeft":
        return announce(`${m.name} a quitté la chambre.`, false, m.name);
      case "gameChanged":
        return announce(
          `Jeu sélectionné : ${getGame(m.gameId)?.title ?? m.gameId}.`,
          false,
        );
      case "accessChanged":
        return announce(
          m.access === "public"
            ? "La chambre est maintenant publique."
            : m.access === "friends"
              ? "La chambre est maintenant réservée aux amis."
              : "La chambre est maintenant fermée.",
          false,
        );
      case "settingChanged":
        return announce(`Règle modifiée : ${label(m.key)}.`);
      case "proposalCreated":
        return announce(`${m.name} propose de changer : ${label(m.key)}.`);
      case "launchCancelled":
        return announce("Lancement annulé.");
      case "proposalResolved":
        return announce(
          `Proposition ${m.accepted ? "validée" : "rejetée"} : ${label(m.key)}.`,
        );
    }
  });

  let lastKey = "";
  const onState = (s: { toJSON(): unknown }) => {
    const snapshot = s.toJSON() as LobbySnapshot;
    const key = JSON.stringify(snapshot, withoutMotion);
    if (key === lastKey) return;
    lastKey = key;
    useChamber.setState({ snapshot, gameId: snapshot.gameId });
  };
  room.onStateChange(onState);
  room.onDrop(() => useChamber.setState({ online: false }));
  room.onReconnect(() => useChamber.setState({ online: true }));
  room.onLeave(() => {
    if (useChamber.getState().code === code) {
      forgetChamber();
      useChamber.setState({ ...EMPTY });
    }
  });
  rememberChamber(code);
  if (room.state?.players) onState(room.state);
}

// Code de la chambre en cours, gardé pour la durée de l'onglet : après un rechargement (F5) on reprend la même chambre
// (le serveur garde le siège 60 s) au lieu d'en laisser une orpheline où les autres te voient fantôme.
const CHAMBER_KEY = "stepup-chamber";
const rememberChamber = (code: string) => {
  try {
    sessionStorage.setItem(CHAMBER_KEY, code);
  } catch {}
};
const forgetChamber = () => {
  try {
    sessionStorage.removeItem(CHAMBER_KEY);
  } catch {}
};

/** Reprend la chambre d'avant un rechargement de page, si le siège est encore réservé. Sans effet sinon. */
export async function resumeChamber(): Promise<void> {
  if (useChamber.getState().code || busy) return;
  let code: string | null = null;
  try {
    code = sessionStorage.getItem(CHAMBER_KEY);
  } catch {}
  if (!code) return;
  try {
    const room = await connectLobby(code);
    if (useChamber.getState().code) return; // une chambre a été ouverte entre-temps
    useChamber.setState({ code, room, gameId: room.state?.gameId ?? null });
    attach(room, code);
    useChamber.setState((s) => ({ joinSeq: s.joinSeq + 1 })); // on se replace là où le serveur nous a gardé
  } catch {
    forgetChamber(); // siège expiré ou chambre fermée
  }
}

let busy: Promise<void> | null = null;

/** Crée la chambre (un salon privé ou ouvert selon le réglage) si aucun salon n'existe ; sans effet pendant une création. */
export function ensureChamber(): Promise<void> {
  if (busy) return busy;
  if (useChamber.getState().code) return Promise.resolve();
  busy = (async () => {
    useChamber.setState({ creating: true, error: null });
    try {
      const { gameId, roomAccess } = useDisplay.getState();
      const game =
        GAMES.find((g) => g.id === gameId) ??
        GAMES.find((g) => g.status === "available") ??
        GAMES[0]!;
      const code = await createLobby({
        gameId: game.id as GameId,
        access: roomAccess,
      });
      const room = await connectLobby(code);
      useChamber.setState({ code, room, gameId: game.id, error: null });
      attach(room, code);
    } catch (e) {
      useChamber.setState({ error: describeJoinError(e) });
    } finally {
      busy = null;
      useChamber.setState({ creating: false });
    }
  })();
  return busy;
}

/** Lance la partie du salon de la chambre (créé ici s'il n'existe pas) : jeu et réglages envoyés dans l'ordre, puis le compte à rebours. Renvoie un message d'erreur ou null. */
export async function startChamberGame(
  gameId: string,
  settings: Record<string, number | string> = {},
): Promise<string | null> {
  await ensureChamber();
  const { room, gameId: roomGame, error } = useChamber.getState();
  if (!room) return error ?? "Serveur de jeu injoignable.";
  // Changer de jeu remet les réglages par défaut : on l'envoie avant les réglages.
  if (roomGame !== gameId) {
    room.send("setGame", { gameId });
    useChamber.setState({ gameId });
  }
  for (const [key, value] of Object.entries(settings))
    room.send("setSetting", { key, value });
  room.send("start", {});
  return null;
}

/** Rejoint la chambre de quelqu'un par son code. Renvoie un message d'erreur, ou null si c'est réussi. */
export async function joinChamber(code: string): Promise<string | null> {
  useChamber.setState({ creating: true, error: null });
  try {
    await leaveChamber();
    const room = await connectLobby(code);
    useChamber.setState({ code, room, gameId: room.state?.gameId ?? null });
    attach(room, code);
    useChamber.setState((s) => ({ joinSeq: s.joinSeq + 1 }));
    return null;
  } catch (e) {
    const message = describeJoinError(e);
    useChamber.setState({ error: message });
    return message;
  } finally {
    useChamber.setState({ creating: false });
  }
}

/** Quitte le salon (la chambre redevient solo). */
export async function leaveChamber(): Promise<void> {
  if (!useChamber.getState().code) return;
  forgetChamber();
  await leaveLobby();
  useChamber.setState({ ...EMPTY });
}

type RoomMessage =
  | "setGame"
  | "setAccess"
  | "setSetting"
  | "kick"
  | "start"
  | "cancelStart"
  | "backToLobby"
  | "stopGame"
  | "chat"
  | "closeRoom"
  | "sitAt"
  | "standUp"
  | "refreshAvatar";

/** Envoie un message au salon de la chambre, s'il existe. */
export function chamberSend(
  type: RoomMessage,
  payload: Record<string, unknown> = {},
): void {
  useChamber.getState().room?.send(type, payload);
}

// Accès réglé dans les Paramètres ou le panneau de la chambre : transmis au salon dès qu'ils changent.
useDisplay.subscribe((state, previous) => {
  if (state.roomAccess !== previous.roomAccess)
    chamberSend("setAccess", { access: state.roomAccess });
});
