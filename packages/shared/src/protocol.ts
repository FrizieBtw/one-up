import { z } from "zod";
import { CHAT_MAX_LENGTH, EMOTE_IDS, type EmoteId } from "./config";
import { GAME_IDS, type GameId, type SettingValue } from "./games";

// ---------- Identité ----------

export const playerNameSchema = z
  .string()
  .trim()
  .min(3)
  .max(16)
  .regex(
    /^[\p{L}\p{N}_\- ]+$/u,
    "Lettres, chiffres, espace, - et _ uniquement",
  );

export interface Identity {
  id: string;
  name: string;
  kind: "guest" | "user";
}

// ---------- Création / accès salon ----------

/**
 * Accès à une chambre : fermée (on n'y entre qu'avec le code, elle n'est listée nulle part), publique (listée dans les chambres
 * ouvertes) ou amis seulement (seuls les amis de l'hôte y entrent, avec le code).
 */
export const ROOM_ACCESS = ["closed", "public", "friends"] as const;
export type RoomAccess = (typeof ROOM_ACCESS)[number];

export const createLobbyOptionsSchema = z.object({
  gameId: z.enum(GAME_IDS),
  access: z.enum(ROOM_ACCESS),
});
export type CreateLobbyOptions = z.infer<typeof createLobbyOptionsSchema>;

/** Raisons de refus renvoyées par le serveur (message d'erreur de jointure). */
export const JoinError = {
  Unauthorized: "UNAUTHORIZED",
  AlreadyInRoom: "ALREADY_IN_ROOM",
  InProgress: "IN_PROGRESS",
  Kicked: "KICKED",
  /** Chambre réservée aux amis de l'hôte. */
  FriendsOnly: "FRIENDS_ONLY",
} as const;

// ---------- Messages client → serveur (toujours validés côté serveur) ----------

const empty = z.object({});
const settingChange = z.object({
  key: z.string().max(40),
  value: z.union([z.number(), z.boolean(), z.string().max(40)]),
});

export const clientMessages = {
  ready: z.object({ ready: z.boolean() }),
  chat: z.object({ text: z.string().trim().min(1).max(CHAT_MAX_LENGTH) }),
  setSetting: settingChange,
  /** Hôte, salon en attente : change de jeu (les réglages reviennent aux valeurs par défaut du nouveau jeu). */
  setGame: z.object({ gameId: z.string().max(40) }),
  /** Hôte : ouvre le salon à la recherche publique, ou le rend privé. */
  setAccess: z.object({ access: z.enum(ROOM_ACCESS) }),
  /** Position de départ : la position locale du joueur quand il crée son salon (acceptée une seule fois, juste après l'arrivée). */
  spawnAt: z.object({ x: z.number(), z: z.number() }),
  /** Le joueur s'assoit au sol (immobile longtemps) ou se relève : les autres voient l'animation. */
  sit: z.object({ sit: z.boolean() }),
  /** Le joueur vient d'enregistrer son avatar ou ses objets équipés : le serveur les relit en base et les montre aux autres. */
  refreshAvatar: z.object({}),
  /** Blackjack : s'asseoir à une place libre de la table (avant la première manche ou entre deux manches). */
  sitAt: z.object({ seat: z.number().int().min(0).max(7) }),
  /** Blackjack : se lever de sa place (entre deux manches ; jamais le dernier joueur assis). */
  standUp: z.object({}),
  /** Hôte : ferme la chambre : tout le monde en sort et son code n'existe plus. */
  closeRoom: z.object({}),
  /** Hôte : exclut un joueur du salon (il ne peut plus y revenir tant que le salon existe). */
  kick: z.object({ sessionId: z.string().max(40) }),
  /** Intention de déplacement (direction), jamais une position : le serveur simule. */
  move: z.object({
    x: z.number(),
    z: z.number(),
    run: z.boolean().optional(),
    jump: z.boolean().optional(),
  }),
  emote: z.object({ id: z.enum(EMOTE_IDS) }),
  /** Proposition de changement de règle . */
  propose: settingChange,
  vote: z.object({ id: z.string().max(20), approve: z.boolean() }),
  resolveProposal: z.object({ id: z.string().max(20), accept: z.boolean() }),
  report: z.object({
    sessionId: z.string().max(40),
    reason: z.string().trim().max(200).optional(),
  }),
  /** Hôte : lance le compte à rebours, ou l'annule. */
  start: empty,
  cancelStart: empty,
  /** Hôte, écran de résultats : retour au lobby. */
  backToLobby: empty,
  /** Hôte : arrête la partie en cours et ramène tout le monde dans la chambre. */
  stopGame: empty,
  // Blackjack
  bjAction: z.object({ action: z.enum(["hit", "stand", "split", "double"]) }),
  /** Mise (en jetons du portefeuille) pour la manche, pendant l'étape de mise. */
  /** `chips` : les jetons posés, un par valeur (leur somme est la mise) ; sans eux, la mise est découpée automatiquement. */
  bjBet: z.object({
    amount: z.number().int().min(1).max(100000),
    chips: z.array(z.number().int().min(1).max(100000)).max(80).optional(),
  }),
  /** Hôte, entre deux manches : manche suivante immédiate, ou fin de session. */
  bjNext: empty,
  bjEnd: empty,
} as const;

export type ClientMessageType = keyof typeof clientMessages;
export type ClientMessage<T extends ClientMessageType> = z.infer<
  (typeof clientMessages)[T]
>;

// ---------- Messages serveur → client ----------

export interface ServerMessages {
  chat: {
    fromId: string;
    name: string;
    /** Couleur choisie par l'expéditeur, ou chaîne vide. */ color: string;
    text: string;
    at: number;
  };
  notice:
    | { type: "settingChanged"; key: string }
    | { type: "hostChanged"; name: string }
    | { type: "playerKicked"; name: string }
    | { type: "playerJoined"; name: string }
    | { type: "playerLeft"; name: string }
    | { type: "gameChanged"; gameId: string }
    | { type: "accessChanged"; access: RoomAccess }
    | { type: "proposalCreated"; name: string; key: string }
    | { type: "proposalResolved"; key: string; accepted: boolean }
    | { type: "launchCancelled" };
  emote: { sessionId: string; id: EmoteId };
  /** Envoyé au joueur exclu juste avant sa déconnexion. */
  kicked: { by: string };
  /** La chambre vient d'être fermée par son hôte. */
  closed: Record<string, never>;
  /** Récompenses de fin de session, envoyées une fois les résultats enregistrés (comptes uniquement). */
  rewards: {
    xpGained: number;
    xp: number;
    achievements: string[];
    tokens: number;
    balance: number;
    missions: string[];
  };
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
  /** JSON d'AvatarConfig validée, ou chaîne vide (invité, ou avatar jamais personnalisé). */
  avatar: string;
  /** JSON d'AvatarCosmetics : objets de boutique équipés (tenue premium, accessoire, effet), ou « {} ». */
  cosmetics: string;
  /** Position dans la salle (autorité serveur) et direction de déplacement courante. */
  x: number;
  z: number;
  dx: number;
  dz: number;
  /** Maj maintenue : le joueur court. */
  run: boolean;
  /** Le joueur est en plein saut (animation). */
  jump: boolean;
  /** Hauteur des pieds au-dessus du sol (saut, ou dessus d'un meuble bas). */
  y: number;
  /** Le joueur est assis au sol (attente prolongée). */
  sit: boolean;
  /** Place à la table de blackjack (0 à 7), ou -1 : debout dans la chambre. */
  seat: number;
  /** Couleur choisie (PLAYER_COLORS), ou chaîne vide : couleur automatique. */
  color: string;
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
  access: RoomAccess;
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

// ---------- Blackjack ----------

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
  /** Seconde main, après une séparation (vide sinon) : ses cartes, son statut et son résultat. */
  cards2: CardSnapshot[];
  status2: "" | "playing" | "stood" | "bust";
  result2: "" | "win" | "push" | "loss";
  /** Main jouée en ce moment (0 ou 1). */
  hand: number;
  /** Le joueur peut séparer sa paire maintenant. */
  canSplit: boolean;
  /** Le joueur peut doubler maintenant (mise doublée, une seule carte, puis il reste). */
  canDouble: boolean;
  /** Mise de la manche (et de la seconde main), jetons rendus en fin de manche, solde du portefeuille (-1 : sans portefeuille, jeu sans mise). */
  bet: number;
  bet2: number;
  /** Jetons posés sur la table pour chaque main : valeurs séparées par des virgules (« 10,25,25 »). */
  chips: string;
  chips2: string;
  payout: number;
  /** Gain net de la dernière manche (jetons rendus moins mises) et si l'on avait misé : reste affiché pendant la mise suivante. */
  net: number;
  staked: boolean;
  balance: number;
  score: number;
  wins: number;
  pushes: number;
  losses: number;
}

export interface BlackjackSnapshot {
  round: number;
  /** Numéro de distribution : change à chaque distribution de cartes (pas à l'ouverture des mises). */
  dealNo: number;
  /** playing : tours des joueurs · dealer : le croupier joue · roundEnd : entre deux manches · finished */
  stage: "betting" | "playing" | "dealer" | "roundEnd" | "finished";
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
