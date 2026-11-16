"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  GAMES,
  ROOM_CODE_LENGTH,
  filterChat,
  launchBlocker,
  ROOM_ACCESS,
  ROOM_CAPACITY,
  normalizeRoomCode,
  type AvatarConfig,
  type RoomAccess,
} from "@stepup/shared";
import { lookFromId } from "@/avatar/Avatar";
import { useDisplay } from "@/lib/display";
import { useEquippedCosmetics } from "@/lib/economy";
import { readGamepadPresses } from "@/lib/input";
import {
  chamberSend,
  ensureChamber,
  joinChamber,
  leaveChamber,
  pushFeed,
  startChamberGame,
  useChamber,
  type FeedLine,
} from "@/lib/chamber";
import { PAD_INDEX, keyLabel, useKeybinds, useLayoutMap } from "@/lib/keybinds";
import { useNav } from "@/lib/nav";
import { useSession } from "@/lib/session";
import { loadMyProfile } from "@/lib/social";
import type { RoomSpot } from "@/room/RoomScene";
import { BlackjackScreen } from "@/blackjack/BlackjackScreen";
import { autoColor, pfpBackground, useMyColor } from "@/lib/playerColor";
import { HudButton, HudPanel } from "./hud";
import {
  EnterRoomIcon,
  FriendsIcon,
  LockIcon,
  PadIcon,
  QrIcon,
  UnlockIcon,
  UsersIcon,
} from "./icons";
import { SceneBoundary } from "./SceneBoundary";

// WebGL : rendu côté client uniquement.
const RoomScene = dynamic(() => import("@/room/RoomScene"), { ssr: false });
const FloatingDecor = dynamic(() => import("./login/LoginDecor"), {
  ssr: false,
});

/** Bulle « Appuyez sur E » au-dessus du meuble : carré arrondi, pointe vers le bas. Toujours dans le DOM (clic, lecteur d'écran), visible seulement à proximité. */
function Prompt({
  holoRef,
  visible,
  label,
  onClick,
}: {
  holoRef: React.RefObject<HTMLDivElement | null>;
  visible: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <div ref={holoRef} className="pointer-events-none fixed top-0 left-0 z-20">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={`relative -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-2xl bg-white px-4 py-2.5 text-center font-hud text-sm font-semibold text-hud-ink shadow-[0_6px_20px_rgba(15,13,34,0.35)] transition-opacity focus-visible:opacity-100 ${visible ? "pointer-events-auto opacity-100" : "opacity-0"}`}
      >
        <span className="flex items-center gap-2">
          Appuyez sur
          <kbd className="grid min-w-7 place-items-center rounded-lg border-[1.5px] border-hud-line bg-hud-field px-1.5 py-0.5 text-sm font-semibold">
            {keyLabel(
              useKeybinds((k) => k.keys.it),
              useLayoutMap(),
            )}
          </kbd>
        </span>
        <span
          aria-hidden
          className="absolute top-full left-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[3px] bg-white"
        />
      </button>
    </div>
  );
}

/** Chat éphémère en bas à gauche : les messages du salon (ou les tiens, en chambre solo) disparaissent en fondu après quelques secondes. */
/** Couleur choisie par un joueur de la chambre, d'après son pseudo (la nôtre d'abord), ou undefined (couleur automatique). */
function colorOfName(name: string): string | undefined {
  const room = useChamber.getState().room;
  const players = room?.state?.players as
    | { forEach(cb: (p: { name: string; color: string }) => void): void }
    | undefined;
  let found: string | undefined;
  players?.forEach((p) => {
    if (p.name === name && p.color) found = p.color;
  });
  // Notre propre couleur, connue avant que le salon ne nous l'ait renvoyée (annonce « a rejoint » à la création).
  if (
    !found &&
    room?.state?.players &&
    name ===
      (useChamber.getState().snapshot?.players[room.sessionId]?.name ?? "")
  )
    found = useMyColor.getState().color ?? undefined;
  return found;
}

/** Pseudo en gras, coloré quand c'est le nôtre. */
function Pseudo({ name, color }: { name: string; color?: string }) {
  return (
    <b className="font-bold" style={{ color: color || autoColor(name) }}>
      {name}
    </b>
  );
}

function RoomChat({ name }: { name: string }) {
  const overlay = useDisplay((s) => s.chatOverlay);
  const chatKey = useKeybinds((k) => k.keys.ch);
  const feed = useChamber((s) => s.feed);
  const room = useChamber((s) => s.room);
  const [shown, setShown] = useState<FeedLine[]>([]);
  const seen = useRef(feed.at(-1)?.key ?? -1);
  const input = useRef<HTMLInputElement>(null);

  // Les nouveaux messages de chat s'affichent 7 s (le fondu est en CSS) ; les annonces système (sans pseudo) aussi.
  useEffect(() => {
    const fresh = feed.filter((line) => line.key > seen.current);
    seen.current = feed.at(-1)?.key ?? seen.current;
    if (fresh.length === 0) return;
    setShown((list) => [...list, ...fresh].slice(-10));
    for (const line of fresh)
      setTimeout(
        () => setShown((list) => list.filter((l) => l.key !== line.key)),
        7000,
      );
  }, [feed]);

  // La touche « Ouvrir le chat » (Entrée par défaut) place le curseur dans le champ.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      const typing =
        el instanceof HTMLElement &&
        (el.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
      if (e.code === chatKey && !typing && !e.repeat) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatKey]);

  const send = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = input.current?.value.trim() ?? "";
    if (!text) return;
    if (room) chamberSend("chat", { text });
    else
      pushFeed({
        name,
        color: useMyColor.getState().color ?? undefined,
        text: filterChat(text),
      });
    input.current!.value = "";
    input.current!.blur();
  };

  return (
    <div className="fixed bottom-4 left-4 z-20 w-[340px]">
      {overlay && (
        <ul aria-live="polite" className="mb-1.5 flex flex-col gap-1">
          {shown.map((m) => (
            <li key={m.key}>
              <HudPanel className="chat-fade w-fit max-w-[330px] rounded-[14px] px-3.5 py-1.5 text-[13px]">
                {m.name ? (
                  <>
                    <Pseudo name={m.name} color={m.color || undefined} /> :{" "}
                    {m.text}
                  </>
                ) : m.who && m.text.startsWith(m.who) ? (
                  <i>
                    <Pseudo name={m.who} color={colorOfName(m.who)} />
                    {m.text.slice(m.who.length)}
                  </i>
                ) : (
                  <i className="text-hud-ink/70">{m.text}</i>
                )}
              </HudPanel>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={send}>
        <input
          ref={input}
          aria-label="Message"
          maxLength={120}
          autoComplete="off"
          placeholder="Écrire un message…"
          onKeyDown={(e) => {
            // Échap dans le chat le quitte seulement (sans ouvrir les Paramètres).
            if (e.key !== "Escape") return;
            e.stopPropagation();
            e.currentTarget.blur();
          }}
          className="w-full rounded-full bg-white px-4 py-2.5 font-hud text-sm text-hud-ink outline-none placeholder:text-[#9a97bd]"
        />
      </form>
    </div>
  );
}

/** Libellé de chaque mode d'accès à la chambre. */
const ACCESS_LABEL: Record<RoomAccess, string> = {
  closed: "Fermée",
  public: "Publique",
  friends: "Amis seulement",
};

/** Ligne cliquable du panneau : curseur main (règle globale des boutons) et fond grisé au survol. */
const ROW =
  "-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-lg px-2 text-left hover:bg-hud-divider";

/** Infos de la chambre en bas à droite : joueurs (liste, exclusion), accès, code, jeu. Le salon fait foi dès qu'il existe. */
function RoomInfo({ name, inGame }: { name: string; inGame: boolean }) {
  const { roomAccess, setRoomAccess, gameId } = useDisplay();
  const myColor = useMyColor((s) => s.color);
  const { code, room, snapshot, creating, error } = useChamber();
  // La chambre a toujours un code : son salon est créé dès l'arrivée (et recréé si on la quitte ou qu'elle est fermée).
  useEffect(() => {
    if (!code && !creating && !error) void ensureChamber();
  }, [code, creating, error]);
  const [copied, setCopied] = useState(false);
  const [showPlayers, setShowPlayers] = useState(false);
  const [invited, setInvited] = useState(false);

  // Inviter : copie le lien de la chambre (créée à la demande) ; qui l'ouvre arrive directement dedans.
  const invite = async () => {
    await ensureChamber();
    const roomCode = useChamber.getState().code;
    if (!roomCode) return;
    await navigator.clipboard?.writeText(
      `${window.location.origin}/lobby/${roomCode}`,
    );
    setInvited(true);
    setTimeout(() => setInvited(false), 1500);
  };

  const mySession = room?.sessionId;
  const entries = snapshot ? Object.entries(snapshot.players) : [];
  const roster = entries
    .map(([sessionId, p]) => ({
      sessionId,
      name: p.name,
      color: p.color,
      host: sessionId === snapshot!.hostSessionId,
      me: sessionId === mySession,
    }))
    .sort((a, b) => Number(b.host) - Number(a.host));
  const isHost = !snapshot || snapshot.hostSessionId === mySession;
  // Sans salon, la chambre ne contient que toi.
  const list =
    roster.length > 0
      ? roster
      : [{ sessionId: "me", name, color: myColor ?? "", host: true, me: true }];
  const players = Math.max(1, entries.length);
  const capacity = snapshot?.capacity ?? ROOM_CAPACITY;
  const access = (snapshot?.access ?? roomAccess) as RoomAccess;
  const hostName = roster.find((p) => p.host)?.name ?? name;
  // Quitter le jeu : libre s'il n'y a personne à la table, sinon seulement entre deux manches.
  const someoneSeated = snapshot
    ? Object.values(snapshot.players).some((p) => p.seat >= 0)
    : false;
  const canQuitGame =
    !someoneSeated || snapshot?.blackjack.stage === "roundEnd";
  // Place du joueur à la table (-1 : debout).
  const mySeatInfo =
    snapshot && mySession ? (snapshot.players[mySession]?.seat ?? -1) : -1;
  const game =
    GAMES.find((g) => g.id === (snapshot?.gameId ?? gameId)) ??
    GAMES.find((g) => g.status === "available") ??
    GAMES[0]!;
  const blocker = launchBlocker(
    game,
    entries.length > 0 ? entries.map(([, p]) => p) : [{ connected: true }],
  );

  return (
    <HudPanel className="px-4 py-3 text-sm leading-[1.9]">
      {showPlayers && (
        <HudPanel
          role="dialog"
          aria-label="Joueurs présents"
          className="absolute right-0 bottom-full mb-2 w-full px-3 py-2.5 leading-normal"
        >
          <p className="mb-1.5 text-xs font-semibold text-hud-muted">
            Joueurs présents
          </p>
          <ul className="flex flex-col gap-1.5">
            {list.map((p) => (
              <li
                key={p.sessionId}
                className="flex items-center gap-2 text-[13px]"
              >
                <span
                  className="grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold"
                  style={{ background: pfpBackground(p.name, p.color) }}
                  aria-hidden
                >
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 grow truncate">
                  {p.name}
                  {p.me && <span className="text-hud-muted"> (toi)</span>}
                </span>
                {p.host && (
                  <span className="rounded-md bg-hud-soft px-1.5 text-[11px] font-semibold text-hud-accent">
                    Hôte
                  </span>
                )}
                {isHost && !p.me && code && (
                  <button
                    type="button"
                    aria-label={`Exclure ${p.name}`}
                    className="rounded-md bg-hud-bad-soft px-1.5 text-[11px] font-semibold text-hud-bad"
                    onClick={() =>
                      chamberSend("kick", { sessionId: p.sessionId })
                    }
                  >
                    Exclure
                  </button>
                )}
              </li>
            ))}
          </ul>
          <HudButton
            className="mt-2.5 h-8 w-full text-[13px]"
            onClick={() => void invite()}
          >
            {invited ? "Lien copié" : "Inviter"}
          </HudButton>
        </HudPanel>
      )}
      <p className="mb-0.5 text-[15px] font-semibold">Chambre de {hostName}</p>
      <button
        type="button"
        className={ROW}
        aria-expanded={showPlayers}
        aria-label={`Joueurs : ${players} sur ${capacity}`}
        onClick={() => setShowPlayers((v) => !v)}
      >
        <UsersIcon className="size-[15px] text-hud-accent" />
        {players} / {capacity} joueurs
      </button>
      <button
        type="button"
        className={ROW}
        disabled={!isHost}
        title={isHost ? undefined : "Réservé à l'hôte"}
        aria-label={`Accès à la chambre : ${ACCESS_LABEL[access]}`}
        // Fermée → Publique → Amis seulement → Fermée.
        onClick={() =>
          setRoomAccess(
            ROOM_ACCESS[
              (ROOM_ACCESS.indexOf(access) + 1) % ROOM_ACCESS.length
            ]!,
          )
        }
      >
        {access === "closed" ? (
          <LockIcon className="size-[15px] text-hud-accent" />
        ) : access === "friends" ? (
          <FriendsIcon className="size-[15px] text-hud-accent" />
        ) : (
          <UnlockIcon className="size-[15px] text-hud-accent" />
        )}
        {ACCESS_LABEL[access]}
      </button>
      {code ? (
        <button
          type="button"
          className={ROW}
          aria-label={`Copier le code de la chambre : ${code}`}
          title="Copier le code"
          onClick={() => {
            void navigator.clipboard?.writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          <QrIcon className="size-[15px] text-hud-accent" />
          <span className="tracking-widest">{code}</span>
          {copied && <span className="text-xs text-hud-muted">Copié</span>}
        </button>
      ) : (
        <button
          type="button"
          className={ROW}
          disabled={creating}
          onClick={() => void ensureChamber()}
        >
          <QrIcon className="size-[15px] text-hud-accent" />
          {creating
            ? "Création du code…"
            : error
              ? "Réessayer"
              : "Code en préparation…"}
        </button>
      )}
      <button
        type="button"
        className={ROW}
        aria-label={`Jeu : ${game.title}`}
        title={inGame ? undefined : "Choisir un autre jeu"}
        disabled={inGame}
        onClick={() => useNav.getState().openConsole()}
      >
        <PadIcon className="size-[15px] text-hud-accent" />
        {game.title}
      </button>
      {isHost ? (
        <>
          {!inGame && (
            <HudButton
              className="mt-2 w-full py-2! leading-tight"
              disabled={Boolean(blocker)}
              title={blocker ?? undefined}
              onClick={() =>
                void startChamberGame(game.id).then(
                  (failure) =>
                    failure && useChamber.setState({ error: failure }),
                )
              }
            >
              Lancer le jeu
            </HudButton>
          )}
          {inGame && mySeatInfo < 0 && (
            // Debout pendant la partie : l'hôte peut l'arrêter (mises de la manche rendues), tout le monde revient dans la chambre.
            <button
              type="button"
              disabled={!canQuitGame}
              title={
                canQuitGame
                  ? undefined
                  : "Des joueurs sont à la table : attends la fin de la manche."
              }
              className="mt-2 w-full rounded-xl bg-hud-bad py-2 font-hud text-sm leading-tight font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => chamberSend("stopGame")}
            >
              Quitter le jeu
            </button>
          )}
        </>
      ) : (
        <button
          type="button"
          className="mt-2 w-full rounded-xl bg-hud-bad py-2 font-hud text-sm leading-tight font-semibold text-white"
          onClick={() => void leaveChamber()}
        >
          Quitter la chambre
        </button>
      )}
    </HudPanel>
  );
}

/** Encoche au-dessus de la chambre : 4 cases pour le code d'une chambre et un bouton pour la rejoindre. */
function RoomJoin() {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const [bad, setBad] = useState<string | null>(null);
  const [shake, setShake] = useState(0); // relance le fondu quand la même erreur revient
  const show = (message: string) => {
    setBad(message);
    setShake((n) => n + 1);
  };
  // Erreurs de création du salon (serveur injoignable…) : même bandeau.
  const chamberError = useChamber((c) => c.error);
  useEffect(() => {
    if (chamberError) show(chamberError);
  }, [chamberError]);
  // Le bandeau s'efface après 7 s, comme les messages du chat.
  useEffect(() => {
    if (!bad) return;
    const timer = setTimeout(() => setBad(null), 7000);
    return () => clearTimeout(timer);
  }, [bad, shake]);
  const read = () =>
    refs.current
      .map((el) => el?.value ?? "")
      .join("")
      .toUpperCase();
  const join = async () => {
    const code = normalizeRoomCode(read());
    if (!code)
      return setBad(`Entre les ${ROOM_CODE_LENGTH} caractères du code.`);
    const failure = await joinChamber(code);
    if (failure) show(failure);
    else refs.current.forEach((el) => el && (el.value = ""));
  };
  return (
    <>
      {bad && (
        <HudPanel
          key={bad + String(shake)}
          role="alert"
          className="chat-fade bg-hud-bad! px-3 py-1.5 text-center text-xs leading-tight font-semibold text-white!"
        >
          {bad}
        </HudPanel>
      )}
      <HudPanel className="flex items-center justify-between gap-1.5 px-3 py-2.5">
        <div className="flex gap-1.5">
          {Array.from({ length: ROOM_CODE_LENGTH }, (_, i) => (
            <input
              key={i}
              ref={(el) => {
                refs.current[i] = el;
              }}
              maxLength={1}
              autoComplete="off"
              aria-label={`Code de chambre, caractère ${i + 1}`}
              aria-invalid={bad ? true : undefined}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => {
                e.currentTarget.value = e.currentTarget.value
                  .replace(/[^A-Za-z0-9]/g, "")
                  .slice(-1)
                  .toUpperCase();
                setBad(null);
                if (e.currentTarget.value && i < ROOM_CODE_LENGTH - 1)
                  refs.current[i + 1]?.focus();
              }}
              onPaste={(e) => {
                // Coller le code entier : il se répartit sur les cases.
                const text = e.clipboardData
                  .getData("text")
                  .replace(/[^A-Za-z0-9]/g, "")
                  .toUpperCase()
                  .slice(0, ROOM_CODE_LENGTH);
                if (!text) return;
                e.preventDefault();
                refs.current.forEach(
                  (el, j) => el && (el.value = text[j] ?? ""),
                );
                setBad(null);
                refs.current[
                  Math.min(text.length, ROOM_CODE_LENGTH - 1)
                ]?.focus();
              }}
              onKeyDown={(e) => {
                if (e.key === "Backspace" && !e.currentTarget.value && i > 0)
                  refs.current[i - 1]?.focus();
                else if (e.key === "Enter") void join();
              }}
              className={`h-10 w-8 rounded-lg border-2 bg-hud-field p-0 text-center font-hud text-lg font-semibold text-hud-ink uppercase outline-none focus:bg-white ${bad ? "border-hud-bad" : "border-hud-line focus:border-hud-accent"}`}
            />
          ))}
        </div>
        <button
          type="button"
          aria-label="Rejoindre la chambre"
          title="Rejoindre la chambre"
          onClick={() => void join()}
          className="grid size-10 place-items-center rounded-lg bg-hud-accent text-white"
        >
          <EnterRoomIcon className="size-5" />
        </button>
      </HudPanel>
    </>
  );
}

/** Annonce du salon (hôte changé, lancement annulé…) : un bandeau de quelques secondes en haut de la chambre. */
function Notice() {
  const notice = useChamber((s) => s.notice);
  if (!notice) return null;
  return (
    <HudPanel
      role="status"
      className="fixed top-24 left-1/2 z-30 -translate-x-1/2 rounded-full px-5 py-2 text-sm font-semibold shadow-[0_6px_20px_rgba(15,13,34,0.35)]"
    >
      {notice}
    </HudPanel>
  );
}

/** Accueil : la chambre du joueur (seul ou avec ceux qui l'ont rejointe). On se déplace au clavier ou à la manette ; près de la console ou du miroir, une bulle propose d'appuyer sur E pour ouvrir l'écran correspondant. */
export function RoomScreen({
  active,
  showPlayer,
}: {
  active: boolean;
  showPlayer: boolean;
}) {
  const session = useSession();
  const cosmetics = useEquippedCosmetics();
  const room = useChamber((s) => s.room);
  const snapshot = useChamber((s) => s.snapshot);
  // Pendant une partie de blackjack, la chambre devient la salle de jeu : la table descend, l'interface de jeu s'affiche.
  const inGame = Boolean(
    snapshot &&
    snapshot.gameId === "blackjack" &&
    (snapshot.phase === "playing" || snapshot.phase === "results"),
  );
  const seatRef = useRef<HTMLDivElement>(null);
  const [nearSeat, setNearSeat] = useState<number | null>(null);
  const [avatar, setAvatar] = useState<AvatarConfig | null>(null);
  const [near, setNear] = useState<RoomSpot | null>(null);
  const [interactTick, setInteractTick] = useState(0);
  const consoleRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!session.userId) return setAvatar(null);
    let live = true;
    loadMyProfile(session.userId).then(
      (p) => live && setAvatar(p.avatar),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [session.userId, active]);

  const actions = {
    console: () => useNav.getState().openConsole(),
    mirror: () => useNav.getState().openProfile("avatar"),
  };

  // Près d'un meuble : la touche E ou le bouton A de la manette ouvre son écran (le miroir est réservé aux comptes).
  useEffect(() => {
    if (!near || (near === "mirror" && !session.userId)) return;
    // Le personnage fait son geste, puis l'écran s'ouvre.
    const run = () => {
      setInteractTick((n) => n + 1);
      setTimeout(actions[near], 550);
    };
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      const typing =
        el instanceof HTMLElement &&
        (el.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
      if (e.code === useKeybinds.getState().keys.it && !e.repeat && !typing)
        run();
    };
    window.addEventListener("keydown", onKey);
    readGamepadPresses(); // vide les appuis déjà en attente
    const poll = setInterval(
      () =>
        readGamepadPresses().includes(
          PAD_INDEX[useKeybinds.getState().pad.it ?? "a"],
        ) && run(),
      50,
    );
    return () => {
      window.removeEventListener("keydown", onKey);
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `actions` ne dépend que du magasin de navigation
  }, [near, session.userId]);

  // Blackjack : s'asseoir sur une place libre, ou se relever, avant la première manche et entre deux manches.
  const bjSnap =
    snapshot?.gameId === "blackjack" && snapshot.phase === "playing"
      ? snapshot
      : null;
  const seatingOpen = Boolean(
    bjSnap &&
    (bjSnap.blackjack.round === 0 ||
      bjSnap.blackjack.stage === "roundEnd" ||
      bjSnap.blackjack.stage === "betting"),
  );
  const mySeat =
    room && snapshot ? (snapshot.players[room.sessionId]?.seat ?? -1) : -1;
  const canStand = seatingOpen && mySeat >= 0;
  const canSit = seatingOpen && mySeat < 0 && nearSeat !== null;
  const seatAction = () => {
    if (canSit && nearSeat !== null) chamberSend("sitAt", { seat: nearSeat });
    else if (canStand) chamberSend("standUp", {});
  };
  useEffect(() => {
    if (!canSit && !canStand) return;
    const act = seatAction;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      const typing =
        el instanceof HTMLElement &&
        (el.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
      if (e.code === useKeybinds.getState().keys.it && !e.repeat && !typing)
        act();
    };
    window.addEventListener("keydown", onKey);
    readGamepadPresses();
    const poll = setInterval(
      () =>
        readGamepadPresses().includes(
          PAD_INDEX[useKeybinds.getState().pad.it ?? "a"],
        ) && act(),
      50,
    );
    return () => {
      window.removeEventListener("keydown", onKey);
      clearInterval(poll);
    };
  }, [canSit, canStand, nearSeat]);

  const floatingDecor = useDisplay((s) => s.floatingDecor);
  const name = session.name ?? "";
  const look = avatar ?? lookFromId(session.identityId ?? name);
  const peers =
    room && snapshot
      ? Object.keys(snapshot.players).filter((id) => id !== room.sessionId)
      : [];

  return (
    <>
      {floatingDecor && (
        <SceneBoundary>
          <FloatingDecor className="!pointer-events-none !fixed inset-0 z-0" />
        </SceneBoundary>
      )}
      <RoomScene
        look={look}
        name={name}
        cosmetics={cosmetics}
        holo={{ console: consoleRef, mirror: mirrorRef, seat: seatRef }}
        litSeat={canSit ? nearSeat : null}
        active={active}
        showPlayer={showPlayer}
        room={room}
        peers={peers}
        interactTick={interactTick}
        near={active && !(near === "mirror" && !session.userId) ? near : null} // pas de miroir (contour) sans compte
        onNear={setNear}
        onNearSeat={setNearSeat}
      />
      {active && (
        <>
          <Prompt
            holoRef={consoleRef}
            visible={near === "console"}
            label="Console : Choisir un jeu"
            onClick={() => {
              setInteractTick((n) => n + 1);
              setTimeout(actions.console, 550);
            }}
          />
          {session.userId && (
            <Prompt
              holoRef={mirrorRef}
              visible={near === "mirror"}
              label="Miroir : Modifier mon avatar"
              onClick={() => {
                setInteractTick((n) => n + 1);
                setTimeout(actions.mirror, 550);
              }}
            />
          )}
          <RoomChat name={name} />
          {inGame &&
          room &&
          snapshot &&
          !(snapshot.phase === "playing" && snapshot.blackjack.round === 0) ? (
            <BlackjackScreen
              state={snapshot}
              sessionId={room.sessionId}
              isHost={snapshot.hostSessionId === room.sessionId}
              send={(type, message) => void room.send(type, message)}
            />
          ) : null}
          {/* Les infos de la chambre et l'encoche pour rejoindre une chambre restent en bas à droite pendant la partie. */}
          <div className="fixed right-4 bottom-4 z-20 flex w-[214px] flex-col gap-2">
            <RoomJoin />
            <RoomInfo name={name} inGame={inGame} />
          </div>
          <Prompt
            holoRef={seatRef}
            visible={canSit}
            label="S'asseoir"
            onClick={seatAction}
          />
          <Notice />
        </>
      )}
    </>
  );
}
