"use client";

import { useEffect, useRef, type FormEvent } from "react";
import {
  CHAT_MAX_LENGTH,
  getGame,
  type ClientMessage,
  type ClientMessageType,
} from "@stepup/shared";
import { BlackjackScreen } from "@/blackjack/BlackjackScreen";
import { useBlocked } from "@/lib/blocked";
import { useChamber } from "@/lib/chamber";
import { useNav } from "@/lib/nav";
import { Button, Card, Input } from "./ui";

/**
 * Écran de partie (compte à rebours passé : en cours ou résultats). Avant et après la partie, le salon est la chambre
 * (voir RoomScreen) : on y revient automatiquement quand le serveur repasse en attente.
 */
export function LobbyScreen() {
  const room = useChamber((s) => s.room);
  const state = useChamber((s) => s.snapshot);
  const feed = useChamber((s) => s.feed);
  const rewards = useChamber((s) => s.rewards);
  const goHome = useNav((s) => s.goHome);
  const setLobbyGame = useNav((s) => s.setLobbyGame);
  const blocked = useBlocked((s) => s.ids);

  // Le fil de chat reste calé sur le dernier message.
  const feedList = useRef<HTMLUListElement>(null);
  useEffect(() => {
    feedList.current?.scrollTo({ top: feedList.current.scrollHeight });
  }, [feed.length]);

  const gameId = state?.gameId;
  useEffect(() => {
    if (gameId) setLobbyGame(gameId);
  }, [gameId, setLobbyGame]);

  const game = state && getGame(state.gameId);
  if (!room || !state || !game) {
    return (
      <p className="py-16 text-center font-bold" aria-busy="true">
        Connexion au salon…
      </p>
    );
  }

  const send = <T extends ClientMessageType>(
    type: T,
    message: ClientMessage<T>,
  ) => void room.send(type, message);
  const isHost = state.hostSessionId === room.sessionId;

  const chat = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem(
      "text",
    ) as HTMLInputElement;
    const text = input.value.trim();
    if (!text) return;
    send("chat", { text });
    input.value = "";
  };

  const chatCard = (
    <Card className="!p-4">
      <h3 className="text-xl">Chat</h3>
      <ul
        ref={feedList}
        aria-live="polite"
        className="mt-2 flex h-40 flex-col gap-1 overflow-y-auto rounded-2xl border-3 border-ink bg-cream p-3 text-sm"
      >
        {feed
          .filter((line) => !line.fromId || !blocked.includes(line.fromId))
          .map((line) =>
            line.name ? (
              <li key={line.key}>
                <strong>{line.name} :</strong> {line.text}
              </li>
            ) : (
              <li key={line.key} className="font-bold text-violet-deep">
                {line.text}
              </li>
            ),
          )}
      </ul>
      <form onSubmit={chat} className="mt-2 flex gap-2">
        <Input
          name="text"
          aria-label="Message"
          maxLength={CHAT_MAX_LENGTH}
          placeholder="Votre message…"
          autoComplete="off"
        />
        <Button type="submit" className="!px-4">
          Envoyer
        </Button>
      </form>
    </Card>
  );

  return (
    <>
      <BlackjackScreen
        state={state}
        sessionId={room.sessionId}
        isHost={isHost}
        send={send}
        chat={chatCard}
        onQuit={goHome}
        rewards={rewards}
        onBackToLobby={() => useChamber.setState({ rewards: null })}
      />
    </>
  );
}
