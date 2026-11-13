"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, type ReactNode } from "react";
import { handValue, type Rank } from "@stepup/blackjack";
import { levelProgress, type BlackjackPlayerSnapshot, type CardSnapshot, type ClientMessage, type ClientMessageType, type LobbySnapshot, type ServerMessages } from "@stepup/shared";
import { loadMissionTitles } from "@/lib/economy";
import { loadAchievementTitles } from "@/lib/social";
import { Badge, Button, Card } from "@/components/ui";
import { attachInput, readGamepadPresses, useInputDevice } from "@/lib/input";

// WebGL : rendu côté client uniquement.
const BlackjackTable3D = dynamic(() => import("./BlackjackTable3D"), { ssr: false });

type Send = <T extends ClientMessageType>(type: T, message: ClientMessage<T>) => void;

const total = (cards: CardSnapshot[]) => handValue(cards as { rank: Rank }[]).total;

function statusLabel(player: BlackjackPlayerSnapshot): string {
  if (player.result === "win") return "Gagné +3";
  if (player.result === "push") return "Égalité +1";
  if (player.result === "loss") return "Perdu";
  return { playing: "En jeu", stood: "Reste", bust: "Dépassé", blackjack: "Blackjack !" }[player.status];
}

export function BlackjackScreen({
  state,
  sessionId,
  isHost,
  send,
  chat,
  onQuit,
  rewards,
  onBackToLobby,
}: {
  state: LobbySnapshot;
  sessionId: string;
  isHost: boolean;
  send: Send;
  chat: ReactNode;
  onQuit: () => void;
  /** Récompenses de fin de session (comptes enregistrés uniquement). */
  rewards: ServerMessages["rewards"] | null;
  onBackToLobby: () => void;
}) {
  const [achievementTitles, setAchievementTitles] = useState<string[]>([]);
  const [missionTitles, setMissionTitles] = useState<string[]>([]);
  useEffect(() => {
    if (!rewards) return;
    void loadAchievementTitles(rewards.achievements).then(setAchievementTitles, () => setAchievementTitles(rewards.achievements));
    void loadMissionTitles(rewards.missions).then(setMissionTitles, () => setMissionTitles(rewards.missions));
  }, [rewards]);
  const bj = state.blackjack;
  const device = useInputDevice();
  const me = bj.players[sessionId];
  const myTurn = state.phase === "playing" && bj.stage === "playing" && bj.turn === sessionId;
  // Classement : score décroissant ; à égalité, l'ordre de la table est conservé.
  const ranking = Object.entries(bj.players).sort(([, a], [, b]) => b.score - a.score);

  // Tirer : T ou bouton de façade bas ; Rester : R ou bouton de façade droit.
  useEffect(() => {
    if (!myTurn) return;
    const act = (action: "hit" | "stand") => send("bjAction", { action });
    const detach = attachInput((code) => {
      if (code === "KeyT") act("hit");
      if (code === "KeyR") act("stand");
    });
    const poll = setInterval(() => {
      for (const button of readGamepadPresses()) {
        if (button === 0) act("hit");
        if (button === 1) act("stand");
      }
    }, 50);
    return () => {
      detach();
      clearInterval(poll);
    };
  }, [myTurn, send]);

  const identities = Object.fromEntries(Object.entries(state.players).map(([id, player]) => [id, { id: player.id, avatar: player.avatar, cosmetics: player.cosmetics }]));

  if (state.phase === "results") {
    return (
      <>
        <BlackjackTable3D blackjack={bj} identities={identities} />
        <div className="rise-in fixed inset-0 z-10 flex items-center justify-center p-4">
        <Card className="w-full max-w-xl">
          <h2 className="text-4xl text-violet">Résultats</h2>
          <p className="text-sm font-bold text-ink/70">
            Blackjack Battle · {bj.round} {bj.round > 1 ? "manches" : "manche"}
          </p>
          <table className="mt-4 w-full text-left font-bold">
            <thead className="text-xs uppercase text-ink/60">
              <tr>
                <th className="py-1">Rang</th>
                <th>Joueur</th>
                <th>Victoires</th>
                <th>Égalités</th>
                <th>Défaites</th>
                <th className="text-right">Score</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map(([id, player], i) => {
                // Les ex æquo partagent le même rang.
                const rank = ranking.findIndex(([, other]) => other.score === player.score) + 1;
                return (
                  <tr key={id} className={rank === 1 ? "bg-sun" : i % 2 ? "bg-cream" : ""}>
                    <td className="rounded-l-lg px-2 py-1.5 font-display text-xl">{rank}</td>
                    <td>
                      {player.name}
                      {id === sessionId && " (vous)"}
                    </td>
                    <td>{player.wins}</td>
                    <td>{player.pushes}</td>
                    <td>{player.losses}</td>
                    <td className="rounded-r-lg px-2 text-right font-display text-xl">{player.score}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rewards ? (
            <div className="mt-4 rounded-xl border-2 border-ink bg-cream p-3 font-bold">
              <p>
                +{rewards.xpGained} XP · Niveau {levelProgress(rewards.xp).level} ({rewards.xp} XP au total)
              </p>
              <p>
                +{rewards.tokens} jetons · solde {rewards.balance}
              </p>
              {achievementTitles.length > 0 && <p className="text-sm">Succès débloqués : {achievementTitles.join(", ")}</p>}
              {missionTitles.length > 0 && <p className="text-sm">Missions accomplies : {missionTitles.join(", ")}</p>}
            </div>
          ) : (
            <p className="mt-4 text-xs font-bold text-ink/70">Les invités ne gagnent ni XP ni succès : créez un compte pour conserver votre progression.</p>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {isHost ? (
              <Button
                variant="accent"
                onClick={() => {
                  onBackToLobby();
                  send("backToLobby", {});
                }}
              >
                Retour au lobby
              </Button>
            ) : (
              <p className="text-sm font-bold text-ink/70">L'hôte ramène tout le monde au lobby.</p>
            )}
            <Button variant="plain" onClick={onQuit}>
              Quitter
            </Button>
          </div>
        </Card>
        </div>
      </>
    );
  }

  const turnName = bj.players[bj.turn]?.name;
  const banner =
    bj.stage === "playing"
      ? myTurn
        ? `À vous de jouer · ${bj.seconds} s`
        : `Tour de ${turnName ?? "…"} · ${bj.seconds} s`
      : bj.stage === "dealer"
        ? "Le croupier joue…"
        : `Manche ${bj.round} terminée · suivante dans ${bj.seconds} s`;

  return (
    <>
      <BlackjackTable3D blackjack={bj} identities={identities} />

      <div className="fixed left-1/2 top-4 z-10 flex -translate-x-1/2 flex-col items-center gap-1.5">
        <p role="status" className={`rounded-full border-3 border-ink px-4 py-1 font-display text-lg font-bold shadow-chunk-sm ${myTurn ? "bg-sun" : "bg-white"}`}>
          {banner}
        </p>
        <p className="rounded-full bg-white/85 px-3 py-0.5 text-sm font-bold">
          Croupier : {bj.dealer.length ? total(bj.dealer) : "–"}
          {bj.dealerHidden && " + carte cachée"}
        </p>
      </div>

      <aside className="rise-in fixed left-4 top-24 z-10 flex max-h-[calc(100dvh-7rem)] w-72 flex-col gap-4 overflow-y-auto pb-2 pr-1">
        <Card className="!p-4">
          <h2 className="text-2xl text-violet">Manche {bj.round}</h2>
          <ul className="mt-2 flex flex-col gap-1.5" aria-label="Classement">
            {ranking.map(([id, player]) => (
              <li key={id} className={`rounded-xl border-2 px-2 py-1 text-sm font-bold ${bj.turn === id ? "border-ink bg-sun" : "border-transparent"}`}>
                <div className="flex items-center gap-2">
                  <span className="grow">
                    {player.name}
                    {id === sessionId && " (vous)"}
                  </span>
                  <span className="font-display text-lg">{player.score} pts</span>
                </div>
                <div className="flex items-center justify-between text-xs text-ink/70">
                  <span>Main : {total(player.cards)}</span>
                  <Badge className={player.result === "win" ? "bg-turquoise" : player.result === "loss" || player.status === "bust" ? "bg-coral" : "bg-white"}>
                    {statusLabel(player)}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
          <Button className="mt-3 !px-3 !py-1 !text-sm" variant="danger" onClick={onQuit}>
            Quitter la table
          </Button>
        </Card>
      </aside>

      <aside className="rise-in fixed right-4 top-40 z-10 w-80">{chat}</aside>

      <div className="fixed bottom-4 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2">
        {bj.stage === "roundEnd" ? (
          isHost ? (
            <div className="flex gap-3">
              <Button variant="accent" onClick={() => send("bjNext", {})}>
                Manche suivante
              </Button>
              <Button variant="plain" onClick={() => send("bjEnd", {})}>
                Terminer la session
              </Button>
            </div>
          ) : (
            <p className="rounded-full bg-white/85 px-3 py-1 text-sm font-bold">L'hôte enchaîne ou termine la session.</p>
          )
        ) : (
          me && (
            <>
              <p className="rounded-full bg-white/85 px-3 py-0.5 text-sm font-bold">
                Votre main : {total(me.cards)} · {statusLabel(me)}
              </p>
              <div className="flex gap-3">
                <Button variant="calm" disabled={!myTurn} onClick={() => send("bjAction", { action: "hit" })}>
                  Tirer
                </Button>
                <Button variant="accent" disabled={!myTurn} onClick={() => send("bjAction", { action: "stand" })}>
                  Rester
                </Button>
              </div>
              <p className="rounded-full bg-white/80 px-3 py-0.5 text-xs font-bold text-ink/80">
                {device === "gamepad" ? "Manette : bouton bas pour tirer · bouton droit pour rester" : "Clavier : T pour tirer · R pour rester"}
              </p>
            </>
          )
        )}
      </div>
    </>
  );
}
