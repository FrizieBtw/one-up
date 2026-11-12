export type PresenceStatus = "online" | "lobby" | "playing" | "offline";
export type PresenceVisibility = "everyone" | "friends" | "nobody";

export interface PresenceEntry {
  userId: string;
  status: PresenceStatus;
  gameId?: string;
}

/** Ce que `viewer` voit de la présence de `target`, selon le réglage de `target`. Masquer renvoie « hors ligne ». */
export function visiblePresence(entry: PresenceEntry, visibility: PresenceVisibility, viewerIsFriend: boolean): PresenceEntry {
  const allowed = visibility === "everyone" || (visibility === "friends" && viewerIsFriend);
  return allowed ? entry : { userId: entry.userId, status: "offline" };
}

export const PRESENCE_PING_SECONDS = 30;
export const PRESENCE_TTL_SECONDS = 75;
