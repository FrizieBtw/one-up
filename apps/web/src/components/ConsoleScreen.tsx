"use client";

import { useState } from "react";
import { GAMES, type GameDefinition, type SettingDef } from "@stepup/shared";
import { playSfx } from "@/lib/audio";
import { useDisplay } from "@/lib/display";
import { ensureChamber, useChamber } from "@/lib/chamber";
import { useNav } from "@/lib/nav";
import { pfpBackground, useMyColor } from "@/lib/playerColor";
import { useSession } from "@/lib/session";
import { HudButton, HudOverlay, HudSegmented } from "./hud";
import { InfoBadge, type InfoKind } from "./InfoBadge";
import { CartridgeLabel } from "./CartridgeLabel";
import { EscapeHint } from "./inputPrompts";

/** Ce que la maquette affiche en plus du catalogue : durée, difficulté, règles courtes (valeurs à fixer avec les jeux). */
const INFO: Record<
  string,
  {
    color: string;
    duration: string;
    level: [InfoKind, string];
    rules?: string;
  }
> = {
  blackjack: {
    color: "#ff9eb5",
    duration: "15–30 min",
    level: ["light", "Facile"],
    rules: "Approche-toi de 21 sans le dépasser. Le croupier tire jusqu'à 17.",
  },
  kart: {
    color: "#7ec8f5",
    duration: "15 min",
    level: ["medium", "Moyen"],
  },
  party: {
    color: "#b9a3f5",
    duration: "45–60 min",
    level: ["medium", "Moyen"],
  },
};
/**
 * Cartouche rétro et colorée : corps en dégradé de la couleur du jeu, rainures de préhension en haut, étiquette blanche avec
 * illustration du jeu, broches en bas, ombre pleine décalée.
 */
function Cartridge({ game, soon }: { game: GameDefinition; soon: boolean }) {
  const color = INFO[game.id]?.color ?? "#e1d8fb";
  return (
    <span
      aria-hidden
      className="relative mx-auto mb-2 block h-[78px] w-[66px] rounded-t-[11px] rounded-b-[6px] border-[3px] border-outline shadow-[0_4px_0_var(--color-outline)]"
      style={{
        background: `linear-gradient(160deg, color-mix(in srgb, ${color} 62%, white), ${color} 55%, color-mix(in srgb, ${color} 78%, black))`,
        filter: soon ? "grayscale(.6) opacity(.8)" : undefined,
      }}
    >
      {/* rainures de préhension */}
      <span className="absolute top-1.5 right-2.5 left-2.5 flex flex-col gap-[3px]">
        <span className="h-[2px] rounded-full bg-outline/35" />
        <span className="h-[2px] rounded-full bg-outline/35" />
      </span>
      {/* étiquette illustrée */}
      <span className="absolute top-[18px] right-[7px] bottom-[14px] left-[7px] overflow-hidden rounded-[6px] border-2 border-outline bg-white">
        <CartridgeLabel gameId={game.id} className="block size-full" />
      </span>
      {/* broches */}
      <span
        className="absolute right-[9px] bottom-[3px] left-[9px] h-[6px] rounded-[2px] border-2 border-outline bg-outline/80"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, transparent 0 3px, rgba(255,255,255,.35) 3px 5px)",
        }}
      />
    </span>
  );
}

/** Écran Console (ouvert depuis la console de la chambre) : lancer une partie. */
export function ConsoleScreen() {
  const session = useSession();
  const myColor = useMyColor((s) => s.color);
  const storedGame = useDisplay((s) => s.gameId);
  const setGameId = useDisplay((s) => s.setGameId);
  const gameId = GAMES.some((g) => g.id === storedGame)
    ? storedGame!
    : (GAMES.find((g) => g.status === "available")?.id ?? GAMES[0]!.id);
  const [chosen, setChosen] = useState<Record<string, number | string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const game = GAMES.find((g) => g.id === gameId) ?? GAMES[0]!;
  const soon = game.status === "soon";
  const info = INFO[game.id];
  const defs: readonly SettingDef[] = game.settings;
  const selects = defs.filter(
    (s): s is Extract<SettingDef, { type: "select" }> => s.type === "select",
  );
  const min: number = game.minPlayers;
  const max: number = game.maxPlayers;
  const players = min === max ? `${max}` : `${min}–${max}`;
  const snapshot = useChamber((s) => s.snapshot);
  const room = useChamber((s) => s.room);
  const present = snapshot
    ? Object.values(snapshot.players).filter((p) => p.connected)
    : [];
  const inRoom = Math.max(1, present.length);
  // Seul l'hôte lance et règle la partie ; sans salon, la chambre est la tienne.
  const isHost = !snapshot || snapshot.hostSessionId === room?.sessionId;
  const name = session.name ?? "";

  // Lancer : on démarre le salon de la chambre (créé ici s'il n'existe pas encore) ; le compte à rebours se joue dans la chambre.
  const launch = async () => {
    setBusy(true);
    setError(null);
    await ensureChamber();
    const { room, gameId: roomGame, error: failure } = useChamber.getState();
    if (!room) {
      setBusy(false);
      return setError(failure ?? "Serveur de jeu injoignable.");
    }
    // Jeu et réglages choisis ici, envoyés dans cet ordre (changer de jeu remet les réglages par défaut).
    if (roomGame !== game.id) {
      room.send("setGame", { gameId: game.id });
      useChamber.setState({ gameId: game.id });
    }
    for (const [key, value] of Object.entries(chosen))
      room.send("setSetting", { key, value });
    room.send("start", {});
    setBusy(false);
    useNav.getState().goHome();
  };

  return (
    <HudOverlay
      compact
      role="region"
      aria-label="Console"
      className="h-[min(580px,calc(100dvh-108px))] w-[min(900px,calc(100vw-2rem))] flex-col"
      aria-busy={busy}
    >
      <div className="flex items-center justify-between border-b border-hud-divider px-4 py-3">
        <div className="flex items-center gap-3.5">
          <h1 className="font-hud! text-lg leading-none font-semibold text-black">
            Console
          </h1>
        </div>
        <EscapeHint />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-[18px] py-3.5">
        <div className="flex gap-4">
          <section aria-label="Cartouches" className="min-w-0 flex-1">
            <h2 className="mb-1.5 font-hud! text-xs font-semibold text-hud-muted">
              Choisis une cartouche
            </h2>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
              {GAMES.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    aria-pressed={g.id === gameId}
                    onClick={() => {
                      playSfx("select");
                      setGameId(g.id);
                      setNote(null);
                      setError(null);
                    }}
                    className={`relative w-full rounded-[14px] border-2 px-1.5 pt-2.5 pb-2 text-center font-hud text-[12.5px] font-semibold text-black ${g.id === gameId ? "border-hud-accent bg-hud-soft" : "border-transparent bg-hud-field"}`}
                  >
                    {g.status === "soon" && (
                      <span className="absolute top-1.5 right-1.5 rounded-[7px] bg-[#fff3c4] px-1.5 text-[10.5px] text-[#8a5a00]">
                        Bientôt
                      </span>
                    )}
                    <Cartridge game={g} soon={g.status === "soon"} />
                    {g.title}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section aria-label={game.title} className="w-[340px] flex-none">
            <h2 className="font-hud! text-lg font-semibold text-black">
              {game.title}
            </h2>
            <p className="text-[13px] text-hud-muted">{game.tagline}</p>
            <div className="mt-2 mb-1.5 flex gap-1.5">
              <InfoBadge kind="players" label={`${players} joueurs`} />
              {info && <InfoBadge kind="duration" label={info.duration} />}
              {info && <InfoBadge kind={info.level[0]} label={info.level[1]} />}
            </div>
            <div className="mb-1 flex items-center gap-2.5">
              <div className="flex" aria-hidden>
                <span
                  className="size-[30px] rounded-full border-2 border-white"
                  style={{ background: pfpBackground(name, myColor) }}
                />
              </div>
              <div className="text-[13px] font-semibold text-black">
                {inRoom} dans la chambre
              </div>
            </div>

            {soon ? (
              <p className="my-2 rounded-xl bg-hud-field px-3 py-2 text-[12.5px] text-[#4a477a]">
                Ce jeu arrive bientôt. Tu pourras le lancer dès sa sortie.
              </p>
            ) : (
              <>
                {info?.rules && (
                  <p className="my-2 rounded-xl bg-hud-field px-3 py-2 text-[12.5px] text-[#4a477a]">
                    <b>Règles.</b> {info.rules}
                  </p>
                )}
                {selects.length > 0 && (
                  <h3 className="mt-2.5 mb-1.5 font-hud! text-xs font-semibold text-hud-muted">
                    Réglages de la partie
                    {isHost ? "" : " (choisis par l'hôte)"}
                  </h3>
                )}
                {selects.map((s) => (
                  <div
                    key={s.key}
                    className="mb-1.5 flex items-center justify-between rounded-xl bg-hud-field px-3 py-2 text-sm text-black"
                  >
                    {s.label}
                    <HudSegmented
                      label={s.label}
                      value={String(chosen[s.key] ?? s.default)}
                      onChange={(v) =>
                        isHost &&
                        setChosen({
                          ...chosen,
                          [s.key]: s.options.find((o) => String(o.value) === v)!
                            .value,
                        })
                      }
                      className="w-auto [&_button]:flex-none [&_button]:px-[11px] [&_button]:py-1 [&_button]:text-xs [&_button]:whitespace-nowrap"
                      options={s.options.map((o) => ({
                        value: String(o.value),
                        label: o.label,
                      }))}
                    />
                  </div>
                ))}
              </>
            )}

            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {soon ? (
                <HudButton
                  variant="soft"
                  className="px-4 py-2.5"
                  onClick={() =>
                    setNote(`On te prévient à la sortie de ${game.title}.`)
                  }
                >
                  Me prévenir à la sortie
                </HudButton>
              ) : isHost ? (
                <HudButton
                  className="px-4 py-2.5"
                  disabled={busy || inRoom < min || inRoom > max}
                  onClick={() => void launch()}
                >
                  Lancer le jeu
                </HudButton>
              ) : (
                <span className="text-[12.5px] text-hud-muted">
                  Seul l'hôte lance et règle la partie.
                </span>
              )}
              {!soon && inRoom < min && (
                <span className="text-[12.5px] text-hud-bad">
                  Il faut au moins {min} joueur{min > 1 ? "s" : ""}.
                </span>
              )}
              {!soon && inRoom > max && (
                <span className="text-[12.5px] text-hud-bad">
                  Ce jeu accepte {max} joueurs au maximum.
                </span>
              )}
              {note && (
                <span role="status" className="text-[12.5px] text-hud-muted">
                  {note}
                </span>
              )}
            </div>
          </section>
        </div>
        <p role="alert" className="mt-1 min-h-4 text-[12.5px] text-hud-bad">
          {error}
        </p>
      </div>
    </HudOverlay>
  );
}
