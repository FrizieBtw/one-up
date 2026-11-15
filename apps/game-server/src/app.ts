import { defineRoom, defineServer, matchMaker } from "colyseus";
import express from "express";
import {
  GAME_IDS,
  LOBBY_ROOM_NAME,
  playerNameSchema,
  type GameId,
  type PublicRoomInfo,
} from "@stepup/shared";
import { PRESENCE_TTL_SECONDS, visiblePresence } from "@stepup/shared";
import { issueGuestToken, verifyToken } from "./auth";
import { deleteAccount, fetchFriendsWithPresenceSetting } from "./persistence";
import { presence } from "./presence";
import { env } from "./env";
import { createRateLimiter } from "./rateLimit";
import { LobbyRoom, type LobbyMetadata } from "./rooms/LobbyRoom";

/** Délai (secondes) après la dernière authentification pendant lequel une action sensible est acceptée. */
const RECENT_AUTH_SECONDS = 300;

/** Heure de la dernière authentification d'un jeton Supabase déjà vérifié (revendication `amr`), en secondes ; 0 si absente. */
function lastAuthAt(token: string | undefined): number {
  try {
    const payload = JSON.parse(
      Buffer.from(token?.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as { amr?: { timestamp?: number }[] };
    return Math.max(0, ...(payload.amr ?? []).map((a) => a.timestamp ?? 0));
  } catch {
    return 0;
  }
}

const guestAllowed = createRateLimiter(10, 60_000);

export const server = defineServer({
  rooms: {
    [LOBBY_ROOM_NAME]: defineRoom(LobbyRoom),
  },
  express: (app) => {
    app.use(
      ["/health", "/auth", "/rooms", "/presence", "/account"],
      (req, res, next) => {
        res.setHeader("Access-Control-Allow-Origin", env.webOrigin);
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, Authorization",
        );
        res.setHeader(
          "Access-Control-Allow-Methods",
          "GET, POST, DELETE, OPTIONS",
        );
        if (req.method === "OPTIONS") return void res.sendStatus(204);
        next();
      },
    );

    app.get("/health", (_req, res) => void res.json({ ok: true }));

    app.post("/auth/guest", express.json({ limit: "1kb" }), (req, res) => {
      if (!guestAllowed(req.ip ?? "unknown"))
        return void res.status(429).json({ error: "RATE_LIMITED" });
      const name = playerNameSchema.safeParse(req.body?.name);
      if (!name.success)
        return void res.status(400).json({ error: "INVALID_NAME" });
      res.json(issueGuestToken(name.data));
    });

    // Présence : un compte signale qu'il est en ligne, et lit celle de ses amis (filtrée par leurs réglages).
    const bearer = async (header: string | undefined) => {
      const identity = await verifyToken(header?.replace(/^Bearer /, ""));
      return identity?.kind === "user" ? identity : null;
    };
    // Suppression du compte par son propriétaire (le jeton prouve qui il est ; irréversible).
    app.delete("/account", async (req, res) => {
      const me = await bearer(req.headers.authorization);
      if (!me) return void res.status(401).json({ error: "UNAUTHORIZED" });
      // Une session ouverte depuis longtemps ne suffit pas : il faut s'être reconnecté à l'instant (mot de passe ou fournisseur).
      if (
        Date.now() / 1000 -
          lastAuthAt(req.headers.authorization?.replace(/^Bearer /, "")) >
        RECENT_AUTH_SECONDS
      )
        return void res.status(403).json({ error: "REAUTH_REQUIRED" });
      if (!(await deleteAccount(me.id)))
        return void res.status(500).json({ error: "DELETE_FAILED" });
      res.json({ ok: true });
    });
    app.post("/presence/ping", async (req, res) => {
      const me = await bearer(req.headers.authorization);
      if (!me) return void res.status(401).json({ error: "UNAUTHORIZED" });
      presence.ping(me.id);
      res.json({ ok: true, ttl: PRESENCE_TTL_SECONDS });
    });
    app.get("/presence", async (req, res) => {
      const me = await bearer(req.headers.authorization);
      if (!me) return void res.status(401).json({ error: "UNAUTHORIZED" });
      const friends = await fetchFriendsWithPresenceSetting(me.id);
      res.json(
        friends.map((friend) =>
          visiblePresence(presence.get(friend.id), friend.visibility, true),
        ),
      );
    });

    // Salons publics d'un jeu. Les salons privés ne sont joignables que par code.
    app.get("/rooms", async (req, res) => {
      const gameId = req.query.game;
      if (typeof gameId !== "string" || !GAME_IDS.includes(gameId as GameId)) {
        return void res.status(400).json({ error: "INVALID_GAME" });
      }
      const rooms = await matchMaker.query({ name: LOBBY_ROOM_NAME });
      const list: PublicRoomInfo[] = rooms
        .filter((room) => {
          const meta = room.metadata as LobbyMetadata | undefined;
          return meta?.isPublic && meta.gameId === gameId;
        })
        .map((room) => ({
          code: room.roomId,
          gameId: gameId as GameId,
          hostName: room.metadata.hostName,
          players: room.clients,
          capacity: room.maxClients,
          phase: room.metadata.phase,
        }));
      res.json(list);
    });
  },
});
