import { PRESENCE_TTL_SECONDS, type PresenceEntry } from "@stepup/shared";

/**
 * Présence en mémoire, par compte. Un compte est « en ligne » tant que son navigateur envoie des signaux
 * (POST /presence/ping), « dans un lobby » ou « en partie » tant qu'il occupe un salon (état tenu par LobbyRoom).
 * shortcut: mémoire d'un seul processus et aucune purge des anciens comptes ; à passer sur Redis au multi-processus.
 */
export function createPresenceStore(now: () => number = Date.now) {
  const lastSeen = new Map<string, number>();
  const rooms = new Map<string, { status: "lobby" | "playing"; gameId: string }>();

  return {
    ping(userId: string) {
      lastSeen.set(userId, now());
    },
    setRoom(userId: string, status: "lobby" | "playing", gameId: string) {
      rooms.set(userId, { status, gameId });
      lastSeen.set(userId, now());
    },
    clearRoom(userId: string) {
      rooms.delete(userId);
    },
    get(userId: string): PresenceEntry {
      const room = rooms.get(userId);
      if (room) return { userId, status: room.status, gameId: room.gameId };
      const seen = lastSeen.get(userId);
      return { userId, status: seen !== undefined && now() - seen < PRESENCE_TTL_SECONDS * 1000 ? "online" : "offline" };
    },
  };
}

export const presence = createPresenceStore();
