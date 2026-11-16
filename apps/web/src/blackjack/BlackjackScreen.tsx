"use client";

import { useEffect, useRef, useState } from "react";
import {
  BLACKJACK_CHIPS,
  BLACKJACK_MAX_BET,
  BLACKJACK_MIN_BET,
  type ClientMessage,
  ClientMessageType,
  type LobbySnapshot,
} from "@stepup/shared";
import { attachInput, readGamepadPresses, useInputDevice } from "@/lib/input";
import { keyLabel, useKeybinds, useLayoutMap } from "@/lib/keybinds";
import { HudButton, HudPanel } from "@/components/hud";
import { ControllerIcon, KeyIcon } from "@/components/inputPrompts";
import { TokensIcon } from "@/components/icons";
import { useBetPreview, useDealt } from "@/room/dealt";
import { useEconomy } from "@/lib/economy";
import { CHIP_STYLE } from "@/room/chips";
import { handValue, type Rank } from "@stepup/blackjack";

// Partie de blackjack : la table et les cartes sont dans la scène 3D (voir room/BlackjackTable).
// Ce composant ne garde que les commandes : les boutons d'action (clic ou touche) et les raccourcis clavier / manette.

type Send = <T extends ClientMessageType>(
  type: T,
  message: ClientMessage<T>,
) => void;

/** Montant en jetons, avec l'icône de jetons (la même que dans l'encoche de profil). */
function Amount({ value, sign }: { value: number; sign?: boolean }) {
  const text = Math.abs(value).toLocaleString("fr-FR");
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      {sign ? (value > 0 ? "+" : value < 0 ? "−" : "") : ""}
      {text}
      <TokensIcon className="size-[1.15em]" />
    </span>
  );
}

/** Bouton d'action avec le rappel de sa touche. */
function ActionButton({
  code,
  pad,
  label,
  variant,
  onClick,
}: {
  code: string;
  /** Bouton de manette équivalent (affiché à la place de la touche quand on joue à la manette). */
  pad?: string;
  label: string;
  variant: "primary" | "outline" | "danger" | "soft";
  onClick: () => void;
}) {
  const layout = useLayoutMap();
  const device = useInputDevice();
  const shown = keyLabel(code, layout);
  return (
    <HudButton variant={variant} onClick={onClick} className="min-w-28 px-5">
      {label}
      {device === "gamepad" && pad ? (
        <ControllerIcon
          button={pad}
          label={pad.toUpperCase()}
          className="size-8"
        />
      ) : (
        // La touche dessinée occupe 48 sur 64 de l'icône (marge de 8 de chaque côté, coins de rayon 8) : le fond blanc fait
        // exactement cette taille, l'icône (agrandie à 32 px) déborde dessus de 4 px de chaque côté.
        <span className="size-6 rounded-[4px] bg-white">
          <KeyIcon
            code={code}
            printed={shown}
            label={shown}
            className="-m-1 size-8"
          />
        </span>
      )}
    </HudButton>
  );
}

/**
 * Commandes : T (ou A) tire, R (ou B) reste, F (ou X) sépare une paire, D (ou Y) double. Entre deux manches : l'hôte enchaîne avec N, chacun peut se lever (touche d'interaction, gérée par la chambre) ; aux résultats : B ramène à la chambre.
 */
export function BlackjackScreen({
  state,
  sessionId,
  isHost,
  send,
}: {
  state: LobbySnapshot;
  sessionId: string;
  isHost: boolean;
  send: Send;
}) {
  const bj = state.blackjack;
  // Les actions n'apparaissent qu'une fois toutes les cartes distribuées (le croupier les lance une à une depuis le sabot).
  const expected =
    Object.values(bj.players).reduce(
      (n, p) => n + p.cards.length + p.cards2.length,
      0,
    ) +
    bj.dealer.length +
    (bj.dealerHidden ? 1 : 0);
  const landed = useDealt((d) => d.landed);
  const myTurn =
    state.phase === "playing" &&
    bj.stage === "playing" &&
    bj.turn === sessionId &&
    landed >= expected;
  const canSplit = myTurn && Boolean(bj.players[sessionId]?.canSplit);
  const canDouble = myTurn && Boolean(bj.players[sessionId]?.canDouble);
  const roundEnd = state.phase === "playing" && bj.stage === "roundEnd";
  const results = state.phase === "results";
  // Se lever : entre deux manches (même règle que le serveur). La touche est gérée par la chambre.
  const canStand =
    (roundEnd || (state.phase === "playing" && bj.stage === "betting")) &&
    (state.players[sessionId]?.seat ?? -1) >= 0;
  const interactKey = useKeybinds((k) => k.keys.it);
  // Mises : étape avant la distribution, avec les jetons du portefeuille (un joueur sans portefeuille, ou sans assez de jetons, ne mise pas).
  const me0 = bj.players[sessionId];
  const betting =
    state.phase === "playing" &&
    bj.stage === "betting" &&
    Boolean(me0) &&
    me0!.balance >= BLACKJACK_MIN_BET &&
    me0!.bet === 0;
  const betPlaced =
    state.phase === "playing" && bj.stage === "betting" && (me0?.bet ?? 0) > 0;
  // Jetons choisis pour la mise (leur somme est la mise), dans l'ordre où on les pose.
  const [stack, setStack] = useState<number[]>([]);
  const pending = stack.reduce((sum, c) => sum + c, 0);
  // La table montre déjà les jetons choisis devant la place, avant la validation.
  useEffect(() => {
    useBetPreview.setState({ chips: betting ? stack : [] });
    return () => useBetPreview.setState({ chips: [] });
  }, [betting, stack]);
  // Les jetons de la manche précédente sont repris d'office (modifiables avec les jetons ou « Effacer »), dans la limite du solde et de la mise maximale.
  const lastChips = useRef<number[]>([]);
  useEffect(() => {
    if (betPlaced && me0!.chips)
      lastChips.current = me0!.chips.split(",").map(Number);
  }, [betPlaced]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const cap = Math.min(BLACKJACK_MAX_BET, Math.max(0, me0?.balance ?? 0));
    const keep: number[] = [];
    for (const chip of lastChips.current)
      if (keep.reduce((sum, c) => sum + c, 0) + chip <= cap) keep.push(chip);
    setStack(keep);
  }, [bj.round]); // eslint-disable-line react-hooks/exhaustive-deps
  const betCap = Math.min(BLACKJACK_MAX_BET, me0?.balance ?? 0);
  // Le solde du portefeuille change quand on mise et quand les gains sont versés : l'en-tête se met à jour.
  const betKey = `${me0?.bet ?? 0}-${roundEnd}-${results}`;
  useEffect(() => {
    if (me0 && me0.balance >= 0) void useEconomy.getState().refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [betKey]);
  // « Vous : X / Croupier : Y », une fois les cartes distribuées (le croupier ne compte que ses cartes visibles). Deux totaux après une séparation.
  const me = bj.players[sessionId];
  const total = (cards: readonly { rank: string }[]) =>
    handValue(cards.map((c) => ({ rank: c.rank as Rank }))).total;
  const score =
    state.phase === "playing" &&
    me &&
    me.cards.length > 0 &&
    bj.stage !== "finished" &&
    bj.stage !== "betting" &&
    landed >= expected
      ? `Vous : ${me.cards2.length > 0 ? `${total(me.cards)} et ${total(me.cards2)}` : total(me.cards)} | Croupier : ${total(bj.dealer)}`
      : null;
  // Fin de manche : le résultat du joueur (deux, après une séparation) (affiché au-dessus du score).
  const label = { win: "Gagné", push: "Égalité", loss: "Perdu" } as const;
  // Gain net de la manche (jetons rendus moins mise), quand on a misé.
  const net = me?.staked ? me.net : null;
  const result =
    (roundEnd || bj.stage === "betting") && me?.result
      ? [me.result, me.cards2.length > 0 ? me.result2 : ""]
          .filter((r): r is keyof typeof label => r in label)
          // Blackjack naturel (21 en deux cartes, sans séparation) gagné : mention spéciale.
          .map((r) =>
            r === "win" && me.status === "blackjack"
              ? "Gagné par Blackjack"
              : label[r],
          )
          .join(" · ")
      : null;

  // Le résultat de la manche reste affiché pendant la phase de mise suivante (le serveur le garde jusqu'à la distribution).
  const kept = result ? { text: result, net } : null;

  useEffect(() => {
    const detach = attachInput((code) => {
      if (myTurn && code === "KeyT") send("bjAction", { action: "hit" });
      if (myTurn && code === "KeyR") send("bjAction", { action: "stand" });
      if (canSplit && code === "KeyF") send("bjAction", { action: "split" });
      if (canDouble && code === "KeyD") send("bjAction", { action: "double" });
      if (isHost && results && code === "KeyB") send("backToLobby", {});
    });
    const poll = setInterval(() => {
      for (const button of readGamepadPresses()) {
        if (myTurn && button === 0) send("bjAction", { action: "hit" });
        if (myTurn && button === 1) send("bjAction", { action: "stand" });
        if (canSplit && button === 2) send("bjAction", { action: "split" });
        if (canDouble && button === 3) send("bjAction", { action: "double" });
        if (isHost && results && button === 1) send("backToLobby", {});
      }
    }, 50);
    return () => {
      detach();
      clearInterval(poll);
    };
  }, [myTurn, canSplit, canDouble, roundEnd, results, isHost, send]);

  if (
    !myTurn &&
    !roundEnd &&
    !score &&
    !betting &&
    !betPlaced &&
    !(isHost && results)
  )
    return null;
  const stake = (me0?.bet ?? 0) + (me0?.bet2 ?? 0);
  const bubble =
    "rounded-2xl px-5 py-2 text-center text-sm font-semibold whitespace-nowrap shadow-[0_6px_20px_rgba(15,13,34,0.35)]";
  return (
    <>
      {(score || roundEnd || myTurn || betting || betPlaced) && (
        // Au-dessus des boutons d'action : le score pendant la manche ; en fin de manche, le résultat, le score puis le compte à rebours.
        <div className="fixed bottom-24 left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-2">
          {/* Résultat de la manche précédente et portefeuille sur une même ligne ; après la mise, le résultat reste seul. */}
          {(betting || betPlaced) && (kept || betting) && (
            <HudPanel role="status" className={bubble}>
              {kept && (
                <>
                  {kept.text}
                  {kept.net !== null && (
                    <>
                      {" ("}
                      <Amount value={kept.net} sign />
                      {")"}
                    </>
                  )}
                </>
              )}
              {kept && betting && " | "}
              {betting && (
                <>
                  Portefeuille : <Amount value={me0!.balance} />
                </>
              )}
            </HudPanel>
          )}
          {betting && (
            <HudPanel role="timer" className={bubble}>
              Temps pour miser : {bj.seconds} s
            </HudPanel>
          )}
          {betPlaced && (
            <>
              <HudPanel role="status" className={bubble}>
                Mise : <Amount value={stake} />
              </HudPanel>
              <HudPanel role="status" className={bubble}>
                En attente des autres joueurs… ({bj.seconds} s)
              </HudPanel>
            </>
          )}
          {result && roundEnd && (
            <HudPanel role="status" className={bubble}>
              {result}
              {net !== null && (
                <>
                  {" ("}
                  <Amount value={net} sign />
                  {")"}
                </>
              )}
            </HudPanel>
          )}
          {score && (
            <HudPanel role="status" className={bubble}>
              {score}
            </HudPanel>
          )}
          {stake > 0 && !betPlaced && !roundEnd && (
            <HudPanel role="status" className={bubble}>
              Mise : <Amount value={stake} />
            </HudPanel>
          )}
          {myTurn && (
            <HudPanel
              role="timer"
              className="rounded-2xl px-5 py-2 text-center text-sm font-semibold whitespace-nowrap shadow-[0_6px_20px_rgba(15,13,34,0.35)]"
            >
              Temps restant : {bj.seconds} s
            </HudPanel>
          )}
        </div>
      )}
      {betting && (
        <HudPanel
          role="group"
          aria-label="Mise"
          className="fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-2xl p-2 shadow-[0_6px_20px_rgba(15,13,34,0.35)]"
        >
          {BLACKJACK_CHIPS.map((value) => (
            <button
              key={value}
              type="button"
              aria-label={`Ajouter ${value} à la mise`}
              disabled={pending + value > betCap}
              onClick={() => setStack((chips) => [...chips, value])}
              style={{ background: CHIP_STYLE[value]?.color }}
              className="grid size-12 place-items-center rounded-full border-[3px] border-dashed border-white/85 text-sm font-bold text-white shadow-[inset_0_0_0_3px_rgba(255,255,255,0.2)] transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {value}
            </button>
          ))}
          <HudButton
            variant="outline"
            disabled={pending === 0}
            onClick={() => setStack([])}
          >
            Effacer
          </HudButton>
          <HudButton
            variant="primary"
            disabled={pending < BLACKJACK_MIN_BET}
            onClick={() => send("bjBet", { amount: pending, chips: stack })}
          >
            Miser {pending > 0 ? pending.toLocaleString("fr-FR") : ""}
          </HudButton>
          <ActionButton
            code={interactKey}
            pad="a"
            label="Se lever"
            variant="outline"
            onClick={() => send("standUp", {})}
          />
        </HudPanel>
      )}
      {(myTurn || (canStand && !betting) || (isHost && results)) && (
        <HudPanel
          role="group"
          aria-label="Actions"
          className="fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 gap-2 rounded-2xl p-2 shadow-[0_6px_20px_rgba(15,13,34,0.35)]"
        >
          {myTurn && (
            <>
              <ActionButton
                code="KeyT"
                pad="a"
                label="Tirer"
                variant="primary"
                onClick={() => send("bjAction", { action: "hit" })}
              />
              <ActionButton
                code="KeyR"
                pad="b"
                label="Rester"
                variant="outline"
                onClick={() => send("bjAction", { action: "stand" })}
              />
              {canDouble && (
                <ActionButton
                  code="KeyD"
                  pad="y"
                  label="Doubler"
                  variant="soft"
                  onClick={() => send("bjAction", { action: "double" })}
                />
              )}
              {canSplit && (
                <ActionButton
                  code="KeyF"
                  pad="x"
                  label="Séparer"
                  variant="soft"
                  onClick={() => send("bjAction", { action: "split" })}
                />
              )}
            </>
          )}
          {canStand && (
            <ActionButton
              code={interactKey}
              pad="a"
              label="Se lever"
              variant="outline"
              onClick={() => send("standUp", {})}
            />
          )}
          {isHost && results && (
            <ActionButton
              code="KeyB"
              pad="b"
              label="Retour à la chambre"
              variant="primary"
              onClick={() => send("backToLobby", {})}
            />
          )}
        </HudPanel>
      )}
    </>
  );
}
