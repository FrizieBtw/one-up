"use client";

import type { Room } from "@colyseus/sdk";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  CAPACITY_KEY,
  CHAT_MAX_LENGTH,
  EMOTES,
  getGame,
  launchBlocker,
  parseSettings,
  type ClientMessage,
  type ClientMessageType,
  type GameDefinition,
  type LobbySnapshot,
  type ServerMessages,
  type SettingDef,
  type SettingValue,
} from "@stepup/shared";
import { BlackjackScreen } from "@/blackjack/BlackjackScreen";
import { MINI_ANCHOR, anchor } from "@/cartridge/anchors";
import { playSfx } from "@/lib/audio";
import { useBlocked } from "@/lib/blocked";
import { useInputDevice } from "@/lib/input";
import { connectLobby, describeJoinError } from "@/lib/lobby";
import { useNav } from "@/lib/nav";
import { CartridgeBack } from "./CartridgeBack";
import { LaunchSequence } from "./LaunchSequence";
import { Badge, Button, Card, Input } from "./ui";

// WebGL : rendu côté client uniquement.
const LobbyRoom3D = dynamic(() => import("@/lobby3d/LobbyRoom3D"), { ssr: false });

/** Ligne du fil : message de chat (avec `name` et `fromId`) ou annonce système. */
type FeedLine = { key: number; fromId?: string; name?: string; text: string };

const settingLabel = (game: GameDefinition | undefined, key: string) =>
  key === CAPACITY_KEY ? "Capacité du salon" : (game?.settings.find((s) => s.key === key)?.label ?? key);

function describeValue(game: GameDefinition, key: string, value: SettingValue): string {
  if (key === CAPACITY_KEY) return `${value} joueurs`;
  const def = game.settings.find((s) => s.key === key);
  if (def?.type === "select") return def.options.find((o) => o.value === value)?.label ?? String(value);
  if (def?.type === "bool") return value ? "Oui" : "Non";
  return String(value);
}

// Les positions changent 20 fois par seconde et sont lues directement par la scène 3D :
// elles ne doivent pas provoquer de rendu React de l'interface.
const withoutMotion = (key: string, value: unknown) => (["x", "z", "dx", "dz"].includes(key) ? undefined : value);

function useLobbyRoom(code: string) {
  const [room, setRoom] = useState<Room | null>(null);
  const [state, setState] = useState<LobbySnapshot | null>(null);
  const [online, setOnline] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feed, setFeed] = useState<FeedLine[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const feedKey = useRef(0);

  const push = useCallback(
    (line: Omit<FeedLine, "key">) => setFeed((lines) => [...lines.slice(-99), { ...line, key: feedKey.current++ }]),
    [],
  );

  useEffect(() => {
    let active = true;
    const cleanups: (() => void)[] = [];
    const announce = (text: string) => {
      push({ text });
      setNotice(text);
    };

    connectLobby(code).then(
      (joined) => {
        if (!active) return;
        const label = (key: string) => settingLabel(getGame(joined.state?.gameId), key);
        const on = <K extends keyof ServerMessages>(type: K, handler: (message: ServerMessages[K]) => void) =>
          cleanups.push(joined.onMessage(type, handler));

        on("chat", (m) => push({ fromId: m.fromId, name: m.name, text: m.text }));
        on("error", (m) => push({ text: m.message }));
        on("notice", (m) => {
          switch (m.type) {
            case "hostChanged":
              return announce(`${m.name} est maintenant l'hôte.`);
            case "capacityChanged":
              return announce(`Capacité du salon : ${m.capacity} joueurs.`);
            case "settingChanged":
              return announce(`Règle modifiée : ${label(m.key)}.`);
            case "proposalCreated":
              return announce(`${m.name} propose de changer : ${label(m.key)}.`);
            case "launchCancelled":
              return announce("Lancement annulé.");
            case "proposalResolved":
              return announce(`Proposition ${m.accepted ? "validée" : "rejetée"} : ${label(m.key)}.`);
          }
        });

        let lastKey = "";
        const onState = (s: { toJSON(): unknown }) => {
          const snapshot = s.toJSON() as LobbySnapshot;
          const key = JSON.stringify(snapshot, withoutMotion);
          if (key === lastKey) return;
          lastKey = key;
          setState(snapshot);
        };
        const onDrop = () => setOnline(false);
        const onReconnect = () => setOnline(true);
        const onLeave = () => setError("Connexion au salon perdue.");
        joined.onStateChange(onState);
        joined.onDrop(onDrop);
        joined.onReconnect(onReconnect);
        joined.onLeave(onLeave);
        cleanups.push(
          () => joined.onStateChange.remove(onState),
          () => joined.onDrop.remove(onDrop),
          () => joined.onReconnect.remove(onReconnect),
          () => joined.onLeave.remove(onLeave),
        );
        if (joined.state?.players) onState(joined.state);
        setRoom(joined);
      },
      (e) => active && setError(describeJoinError(e)),
    );
    return () => {
      active = false;
      cleanups.forEach((fn) => fn());
    };
  }, [code, push]);

  // L'annonce reste visible quelques secondes.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  return { room, state, online, error, feed, notice, push };
}

export function LobbyScreen({ code }: { code: string }) {
  const { room, state, online, error, feed, notice, push } = useLobbyRoom(code);
  const goHome = useNav((s) => s.goHome);
  const settingsOpen = useNav((s) => s.settingsOpen);
  const setSettingsOpen = useNav((s) => s.setSettingsOpen);
  const setLobbyGame = useNav((s) => s.setLobbyGame);
  const blocked = useBlocked((s) => s.ids);
  const toggleBlocked = useBlocked((s) => s.toggle);
  const device = useInputDevice();

  // Le fil de chat reste calé sur le dernier message.
  const feedList = useRef<HTMLUListElement>(null);
  useEffect(() => {
    feedList.current?.scrollTo({ top: feedList.current.scrollHeight });
  }, [feed.length]);

  // La séquence de console ne joue qu'au lancement confirmé par le serveur (compte à rebours → partie),
  // pas lors d'un rechargement en cours de partie ; elle est abandonnée si la partie s'arrête.
  const phase = state?.phase;
  const previousPhase = useRef(phase);
  useEffect(() => {
    const previous = previousPhase.current;
    previousPhase.current = phase;
    const { launch, setLaunch } = useNav.getState();
    if (previous === "countdown" && phase === "playing") setLaunch("approach");
    else if (phase !== "playing" && launch !== "idle") setLaunch("idle");
  }, [phase]);

  const gameId = state?.gameId;
  useEffect(() => {
    if (gameId) setLobbyGame(gameId);
  }, [gameId, setLobbyGame]);

  if (error) {
    return (
      <Card className="mx-auto max-w-xl">
        <h2 className="text-3xl">Oups</h2>
        <p role="alert" className="mt-2 font-bold">
          {error}
        </p>
        <Button className="mt-4" onClick={goHome}>
          Retour à l'accueil
        </Button>
      </Card>
    );
  }

  const game = state && getGame(state.gameId);
  if (!room || !state || !game) {
    return (
      <p className="py-16 text-center font-bold" aria-busy="true">
        Connexion au salon…
      </p>
    );
  }

  const send = <T extends ClientMessageType>(type: T, message: ClientMessage<T>) => void room.send(type, message);
  const me = state.players[room.sessionId];
  const isHost = state.hostSessionId === room.sessionId;
  const players = Object.entries(state.players);
  const proposals = Object.values(state.proposals ?? {});
  const settings = parseSettings(state.settings);

  // L'hôte applique directement ; les autres joueurs créent une proposition soumise au vote.
  const change = (key: string, value: SettingValue) => {
    if (!isHost) return send("propose", { key, value });
    if (key === CAPACITY_KEY) send("setCapacity", { capacity: Number(value) });
    else send("setSetting", { key, value });
  };

  const chat = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("text") as HTMLInputElement;
    const text = input.value.trim();
    if (!text) return;
    send("chat", { text });
    input.value = "";
  };

  const report = (sessionId: string, name: string) => {
    send("report", { sessionId });
    push({ text: `Signalement de ${name} envoyé.` });
  };

  const chatCard = (
    <Card className="!p-4">
      <h3 className="text-xl">Chat</h3>
      <ul ref={feedList} aria-live="polite" className="mt-2 flex h-40 flex-col gap-1 overflow-y-auto rounded-2xl border-3 border-ink bg-cream p-3 text-sm">
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
        <Input name="text" aria-label="Message" maxLength={CHAT_MAX_LENGTH} placeholder="Votre message…" autoComplete="off" />
        <Button type="submit" className="!px-4">
          Envoyer
        </Button>
      </form>
    </Card>
  );

  // La cartouche du jeu reste en haut à droite : dans le lobby, elle ouvre les règles affichées sur son dos.
  const miniCartridge = (
    <button
      ref={anchor(MINI_ANCHOR)}
      type="button"
      aria-label="Règles de la partie : ouvrir la cartouche"
      aria-expanded={settingsOpen}
      disabled={state.phase !== "waiting"}
      className="fixed right-5 top-4 z-10 aspect-[1/1.25] h-28 cursor-pointer rounded-xl disabled:cursor-default"
      onClick={() => {
        playSfx("flip");
        setSettingsOpen(true);
      }}
    />
  );

  if (state.phase === "playing" || state.phase === "results") {
    return (
      <>
        {miniCartridge}
        <LaunchSequence title={game.title} />
        <BlackjackScreen state={state} sessionId={room.sessionId} isHost={isHost} send={send} chat={chatCard} onQuit={goHome} />
      </>
    );
  }

  const blocker = launchBlocker(game, Object.values(state.players));

  return (
    <>
      <LobbyRoom3D room={room} players={players.map(([sessionId, p]) => ({ sessionId, connected: p.connected }))} />

      {miniCartridge}

      <aside className="rise-in fixed left-4 top-24 z-10 flex max-h-[calc(100dvh-7rem)] w-72 flex-col gap-4 overflow-y-auto pb-2 pr-1">
        <Card className="!p-4">
          <h2 className="text-3xl text-violet">{game.title}</h2>
          <p className="text-sm font-bold">
            Code <span className="rounded-lg bg-sun px-2 py-0.5 font-display tracking-widest">{state.code}</span> ·{" "}
            {state.isPublic ? "Salon public" : "Salon privé"}
          </p>
          <div className="mt-3 flex gap-2">
            <Button className="!px-3 !py-1 !text-sm" variant="plain" onClick={() => void navigator.clipboard.writeText(window.location.href)}>
              Copier le lien
            </Button>
            <Button className="!px-3 !py-1 !text-sm" variant="danger" onClick={goHome}>
              Quitter
            </Button>
          </div>
        </Card>

        <Card className="!p-4">
          <h3 className="text-xl">
            Joueurs {players.length}/{state.capacity}
          </h3>
          <ul className="mt-2 flex flex-col gap-2">
            {players.map(([sessionId, player]) => (
              <li key={sessionId} className={`text-sm font-bold ${player.connected ? "" : "opacity-50"}`}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="grow">
                    {player.name}
                    {sessionId === room.sessionId && " (vous)"}
                  </span>
                  {sessionId === state.hostSessionId && <Badge className="bg-sun">Hôte</Badge>}
                  {!player.connected && <Badge className="bg-white">Déconnecté</Badge>}
                  <Badge className={player.ready ? "bg-turquoise" : "bg-cream"}>{player.ready ? "Prêt" : "Pas prêt"}</Badge>
                </div>
                {sessionId !== room.sessionId && (
                  <div className="flex gap-3 text-xs text-ink/70">
                    <button type="button" className="underline" onClick={() => toggleBlocked(player.id)}>
                      {blocked.includes(player.id) ? `Débloquer ${player.name}` : `Bloquer ${player.name}`}
                    </button>
                    <button type="button" className="underline" onClick={() => report(sessionId, player.name)}>
                      Signaler {player.name}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <Button className="mt-3" variant={me?.ready ? "plain" : "calm"} onClick={() => send("ready", { ready: !me?.ready })}>
            {me?.ready ? "Annuler prêt" : "Je suis prêt"}
          </Button>
          {isHost ? (
            <>
              <Button className="mt-2" variant="accent" disabled={blocker !== null} onClick={() => send("start", {})}>
                Lancer la partie
              </Button>
              {blocker && <p className="mt-1 text-xs font-bold text-ink/70">{blocker}</p>}
            </>
          ) : (
            <p className="mt-2 text-xs font-bold text-ink/70">L'hôte lance la partie quand plus de la moitié des joueurs sont prêts.</p>
          )}
        </Card>
      </aside>

      <aside className="rise-in fixed right-4 top-40 z-10 flex max-h-[calc(100dvh-11rem)] w-80 flex-col gap-4 overflow-y-auto pb-2 pl-1">
        {proposals.length > 0 && (
          <Card className="!p-4">
            <h3 className="text-xl">Propositions</h3>
            <ul className="mt-2 flex flex-col gap-3">
              {proposals.map((proposal) => (
                <li key={proposal.id} className="rounded-xl border-2 border-ink bg-cream p-2 text-sm font-bold">
                  <p>
                    {proposal.authorName} propose : {settingLabel(game, proposal.key)} → {describeValue(game, proposal.key, JSON.parse(proposal.value))}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    <Button className="!px-3 !py-0.5 !text-sm" variant="calm" onClick={() => send("vote", { id: proposal.id, approve: true })}>
                      Pour ({proposal.votesFor})
                    </Button>
                    <Button className="!px-3 !py-0.5 !text-sm" variant="plain" onClick={() => send("vote", { id: proposal.id, approve: false })}>
                      Contre ({proposal.votesAgainst})
                    </Button>
                    {isHost && (
                      <>
                        <Button className="!px-3 !py-0.5 !text-sm" variant="accent" onClick={() => send("resolveProposal", { id: proposal.id, accept: true })}>
                          Valider
                        </Button>
                        <Button className="!px-3 !py-0.5 !text-sm" variant="danger" onClick={() => send("resolveProposal", { id: proposal.id, accept: false })}>
                          Rejeter
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {chatCard}
      </aside>

      <div className="rise-in fixed bottom-4 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2">
        <div className="flex gap-2" role="group" aria-label="Emotes">
          {EMOTES.map((emote, i) => (
            <Button key={emote.id} className="!px-4 !py-1 !text-base" variant="plain" onClick={() => send("emote", { id: emote.id })}>
              {emote.label} <span className="text-xs text-ink/60">{i + 1}</span>
            </Button>
          ))}
        </div>
        <p className="rounded-full bg-white/80 px-3 py-0.5 text-xs font-bold text-ink/80">
          {device === "gamepad"
            ? "Manette : stick gauche pour bouger · boutons de façade pour les emotes"
            : "Déplacement : ZQSD ou flèches · Emotes : touches 1 à 4"}
        </p>
      </div>

      {state.phase === "countdown" && (
        <div role="status" className="fixed left-1/2 top-1/2 z-40 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 rounded-chunk border-3 border-ink bg-sun px-10 py-6 shadow-chunk">
          <p className="font-display text-2xl font-bold">La partie démarre dans</p>
          <p className="font-display text-7xl font-extrabold text-violet">{state.countdown}</p>
          {isHost && (
            <Button variant="plain" onClick={() => send("cancelStart", {})}>
              Annuler le lancement
            </Button>
          )}
        </div>
      )}

      {!online && (
        <p role="status" className="fixed left-1/2 top-4 z-40 -translate-x-1/2 rounded-xl border-3 border-ink bg-coral px-4 py-2 font-bold">
          Connexion interrompue, tentative de reconnexion…
        </p>
      )}
      <p role="status" className={`fixed left-1/2 top-20 z-40 max-w-80 -translate-x-1/2 rounded-xl border-3 border-ink bg-sun px-3 py-2 text-sm font-bold shadow-chunk-sm ${notice ? "" : "hidden"}`}>
        {notice}
      </p>

      {settingsOpen && (
        <CartridgeBack title="Règles de la partie" onClose={() => setSettingsOpen(false)}>
          <p className="text-sm font-bold text-ink/70">
            {isHost ? "Vous êtes l'hôte : vos changements s'appliquent à tous." : "Vos changements sont proposés aux joueurs ; l'hôte décide."}
          </p>
          <div className="flex flex-col gap-3">
            <SettingRow label="Capacité du salon" htmlFor="capacity">
              <select id="capacity" className={selectClass} value={state.capacity} onChange={(e) => change(CAPACITY_KEY, Number(e.target.value))}>
                {capacityOptions(game, players.length).map((n) => (
                  <option key={n} value={n}>
                    {n} joueurs
                  </option>
                ))}
              </select>
            </SettingRow>
            {game.settings.map((def) => (
              <SettingRow key={def.key} label={def.label} htmlFor={`setting-${def.key}`}>
                <SettingControl def={def} value={settings[def.key]} onChange={(value) => change(def.key, value)} />
              </SettingRow>
            ))}
          </div>
        </CartridgeBack>
      )}
    </>
  );
}

const selectClass = "rounded-xl border-3 border-ink bg-white px-3 py-1 font-bold";

function capacityOptions(game: GameDefinition, present: number): number[] {
  const min = Math.max(game.minPlayers, present);
  return Array.from({ length: Math.max(0, game.maxPlayers - min + 1) }, (_, i) => min + i);
}

function SettingRow({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label className="font-bold" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

/** Contrôle généré à partir du schéma de réglage du jeu. */
function SettingControl({ def, value, onChange }: { def: SettingDef; value: SettingValue | undefined; onChange: (value: SettingValue) => void }) {
  const id = `setting-${def.key}`;
  switch (def.type) {
    case "bool":
      return <input id={id} type="checkbox" className="size-6 accent-violet" checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
    case "int":
      return (
        <select id={id} className={selectClass} value={Number(value)} onChange={(e) => onChange(Number(e.target.value))}>
          {Array.from({ length: def.max - def.min + 1 }, (_, i) => def.min + i).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      );
    case "select":
      return (
        <select id={id} className={selectClass} value={String(value)} onChange={(e) => onChange(def.options.find((o) => String(o.value) === e.target.value)!.value)}>
          {def.options.map((o) => (
            <option key={o.value} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
      );
  }
}
