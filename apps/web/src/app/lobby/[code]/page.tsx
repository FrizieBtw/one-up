"use client";

import type { Room } from "@colyseus/sdk";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CHAT_MAX_LENGTH,
  getGame,
  normalizeRoomCode,
  parseSettings,
  type ClientMessage,
  type ClientMessageType,
  type GameDefinition,
  type LobbySnapshot,
  type ServerMessages,
  type SettingDef,
  type SettingValue,
} from "@stepup/shared";
import { Badge, Button, Card, Input } from "@/components/ui";
import { connectLobby, describeJoinError, leaveLobby } from "@/lib/lobby";

/** Ligne du fil : message de chat (avec `name`) ou annonce système. */
type FeedLine = { key: number; name?: string; text: string };

export default function LobbyPage() {
  const code = normalizeRoomCode(useParams<{ code: string }>().code);
  const router = useRouter();
  const [room, setRoom] = useState<Room | null>(null);
  const [state, setState] = useState<LobbySnapshot | null>(null);
  const [online, setOnline] = useState(true);
  const [error, setError] = useState<string | null>(code ? null : "Code de salon invalide.");
  const [feed, setFeed] = useState<FeedLine[]>([]);
  const feedKey = useRef(0);

  useEffect(() => {
    if (!code) return;
    let active = true;
    const cleanups: (() => void)[] = [];
    const push = (line: Omit<FeedLine, "key">) =>
      setFeed((lines) => [...lines.slice(-99), { ...line, key: feedKey.current++ }]);

    connectLobby(code).then(
      (joined) => {
        if (!active) return;
        const game = getGame(joined.state?.gameId);
        const on = <K extends keyof ServerMessages>(type: K, handler: (message: ServerMessages[K]) => void) =>
          cleanups.push(joined.onMessage(type, handler));

        on("chat", (m) => push({ name: m.name, text: m.text }));
        on("error", (m) => push({ text: m.message }));
        on("notice", (m) => {
          if (m.type === "hostChanged") return push({ text: `${m.name} est maintenant l'hôte.` });
          if (m.type === "capacityChanged") return push({ text: `Capacité du salon : ${m.capacity} joueurs.` });
          const label = game?.settings.find((s) => s.key === m.key)?.label ?? m.key;
          push({ text: `Règle modifiée : ${label}.` });
        });

        const onState = (s: { toJSON(): unknown }) => setState(s.toJSON() as LobbySnapshot);
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
  }, [code]);

  if (error) {
    return (
      <main className="mx-auto max-w-xl px-5 py-16">
        <Card>
          <h1 className="text-3xl">Oups</h1>
          <p role="alert" className="mt-2 font-bold">
            {error}
          </p>
          <Link href="/" className="mt-4 inline-block font-bold underline">
            Retour à l'accueil
          </Link>
        </Card>
      </main>
    );
  }

  const game = state && getGame(state.gameId);
  if (!room || !state || !game) {
    return (
      <main className="px-5 py-16 text-center font-bold" aria-busy="true">
        Connexion au salon…
      </main>
    );
  }

  const send = <T extends ClientMessageType>(type: T, message: ClientMessage<T>) => room.send(type, message);
  const me = state.players[room.sessionId];
  const isHost = state.hostSessionId === room.sessionId;
  const players = Object.entries(state.players);
  const settings = parseSettings(state.settings);

  const leave = async () => {
    await leaveLobby();
    router.push("/");
  };

  const chat = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("text") as HTMLInputElement;
    const text = input.value.trim();
    if (!text) return;
    send("chat", { text });
    input.value = "";
  };

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl text-violet">{game.title}</h1>
          <p className="font-bold">
            Code <span className="rounded-lg bg-sun px-2 py-0.5 font-display tracking-widest">{state.code}</span> ·{" "}
            {state.isPublic ? "Salon public" : "Salon privé"}
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="plain" onClick={() => void navigator.clipboard.writeText(window.location.href)}>
            Copier le lien
          </Button>
          <Button variant="danger" onClick={() => void leave()}>
            Quitter
          </Button>
        </div>
      </header>

      {!online && (
        <p role="status" className="rounded-xl border-3 border-ink bg-coral px-4 py-2 font-bold">
          Connexion interrompue, tentative de reconnexion…
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="text-2xl">
            Joueurs {players.length}/{state.capacity}
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {players.map(([sessionId, player]) => (
              <li key={sessionId} className={`flex items-center gap-2 font-bold ${player.connected ? "" : "opacity-50"}`}>
                <span className="grow">
                  {player.name}
                  {sessionId === room.sessionId && " (vous)"}
                </span>
                {sessionId === state.hostSessionId && <Badge className="bg-sun">Hôte</Badge>}
                {!player.connected && <Badge className="bg-white">Déconnecté</Badge>}
                <Badge className={player.ready ? "bg-turquoise" : "bg-cream"}>{player.ready ? "Prêt" : "Pas prêt"}</Badge>
              </li>
            ))}
          </ul>
          <Button className="mt-4" variant={me?.ready ? "plain" : "calm"} onClick={() => send("ready", { ready: !me?.ready })}>
            {me?.ready ? "Annuler prêt" : "Je suis prêt"}
          </Button>
          <p className="mt-3 text-xs font-bold text-ink/70">Le lancement de partie arrive avec le premier jeu (phase 4).</p>
        </Card>

        <Card>
          <h2 className="text-2xl">Règles de la partie</h2>
          {!isHost && <p className="text-sm text-ink/70">Seul l'hôte peut modifier les règles.</p>}
          <div className="mt-3 flex flex-col gap-3">
            <SettingRow label="Capacité du salon" htmlFor="capacity">
              <select
                id="capacity"
                className="rounded-xl border-3 border-ink bg-cream px-3 py-1 font-bold"
                disabled={!isHost}
                value={state.capacity}
                onChange={(e) => send("setCapacity", { capacity: Number(e.target.value) })}
              >
                {capacityOptions(game, players.length).map((n) => (
                  <option key={n} value={n}>
                    {n} joueurs
                  </option>
                ))}
              </select>
            </SettingRow>
            {game.settings.map((def) => (
              <SettingRow key={def.key} label={def.label} htmlFor={`setting-${def.key}`}>
                <SettingControl def={def} value={settings[def.key]} disabled={!isHost} onChange={(value) => send("setSetting", { key: def.key, value })} />
              </SettingRow>
            ))}
          </div>
        </Card>

        <Card className="md:col-span-2">
          <h2 className="text-2xl">Chat</h2>
          <ul aria-live="polite" className="mt-3 flex h-48 flex-col gap-1 overflow-y-auto rounded-2xl border-3 border-ink bg-cream p-3 text-sm">
            {feed.map((line) =>
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
          <form onSubmit={chat} className="mt-3 flex gap-3">
            <Input name="text" aria-label="Message" maxLength={CHAT_MAX_LENGTH} placeholder="Votre message…" autoComplete="off" />
            <Button type="submit">Envoyer</Button>
          </form>
        </Card>
      </div>
    </main>
  );
}

function capacityOptions(game: GameDefinition, present: number): number[] {
  const min = Math.max(game.minPlayers, present);
  return Array.from({ length: Math.max(0, game.maxPlayers - min + 1) }, (_, i) => min + i);
}

function SettingRow({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
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
function SettingControl({
  def,
  value,
  disabled,
  onChange,
}: {
  def: SettingDef;
  value: SettingValue | undefined;
  disabled: boolean;
  onChange: (value: SettingValue) => void;
}) {
  const id = `setting-${def.key}`;
  const className = "rounded-xl border-3 border-ink bg-cream px-3 py-1 font-bold";
  switch (def.type) {
    case "bool":
      return <input id={id} type="checkbox" className="size-6 accent-violet" disabled={disabled} checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
    case "int":
      return (
        <select id={id} className={className} disabled={disabled} value={Number(value)} onChange={(e) => onChange(Number(e.target.value))}>
          {Array.from({ length: def.max - def.min + 1 }, (_, i) => def.min + i).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      );
    case "select":
      return (
        <select
          id={id}
          className={className}
          disabled={disabled}
          value={String(value)}
          onChange={(e) => onChange(def.options.find((o) => String(o.value) === e.target.value)!.value)}
        >
          {def.options.map((o) => (
            <option key={o.value} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
      );
  }
}
