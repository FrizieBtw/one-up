"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Actions remappables (Paramètres > Commandes). Les touches sont des codes physiques : ZQSD sur AZERTY et WASD sur QWERTY partagent les mêmes. */
export type Action =
  "fw" | "bk" | "lf" | "rt" | "run" | "jump" | "it" | "ch" | "em" | "mn";

export const ACTIONS: {
  id: Action;
  label: string;
  fixedPad?: "up" | "down" | "left" | "right";
}[] = [
  { id: "fw", label: "Avancer", fixedPad: "up" },
  { id: "bk", label: "Reculer", fixedPad: "down" },
  { id: "lf", label: "Aller à gauche", fixedPad: "left" },
  { id: "rt", label: "Aller à droite", fixedPad: "right" },
  { id: "run", label: "Courir (maintenir)" },
  { id: "jump", label: "Sauter" },
  { id: "it", label: "Interagir (console, miroir)" },
  { id: "ch", label: "Ouvrir le chat" },
  { id: "em", label: "Roue des emotes" },
  { id: "mn", label: "Ouvrir le menu" },
];

export type PadButton =
  "a" | "b" | "x" | "y" | "lb" | "rb" | "lt" | "rt" | "view" | "menu";
/** Indices standard d'une manette (Gamepad API) pour chaque bouton. */
export const PAD_INDEX: Record<PadButton, number> = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  lb: 4,
  rb: 5,
  lt: 6,
  rt: 7,
  view: 8,
  menu: 9,
};

const DEFAULT_KEYS: Record<Action, string> = {
  fw: "KeyW",
  bk: "KeyS",
  lf: "KeyA",
  rt: "KeyD",
  run: "ShiftLeft",
  jump: "Space",
  it: "KeyE",
  ch: "Enter",
  em: "KeyQ",
  mn: "Escape",
};
const DEFAULT_PAD: Partial<Record<Action, PadButton>> = {
  run: "b",
  jump: "a",
  ch: "view",
  it: "x",
  em: "y",
  mn: "menu",
};

interface Keybinds {
  keys: Record<Action, string>;
  pad: Partial<Record<Action, PadButton>>;
  setKey(action: Action, code: string): void;
  setPad(action: Action, button: PadButton): void;
  reset(): void;
}

export const useKeybinds = create(
  persist<Keybinds>(
    (set) => ({
      keys: DEFAULT_KEYS,
      pad: DEFAULT_PAD,
      setKey: (action, code) =>
        set((s) => ({ keys: { ...s.keys, [action]: code } })),
      setPad: (action, button) =>
        set((s) => ({ pad: { ...s.pad, [action]: button } })),
      reset: () => set({ keys: DEFAULT_KEYS, pad: DEFAULT_PAD }),
    }),
    {
      name: "stepup-keybinds",
      // Version 2 : nouvelles touches de manette par défaut (les anciennes ne sont pas conservées).
      version: 2,
      migrate: (saved) =>
        ({ ...(saved as object), pad: DEFAULT_PAD }) as Keybinds,
      // Les réglages mémorisés avant l'ajout d'une action n'ont pas sa touche : on complète avec les valeurs par défaut.
      merge: (saved, current) => {
        const stored = saved as Partial<Keybinds> | undefined;
        return {
          ...current,
          ...stored,
          keys: { ...current.keys, ...stored?.keys },
          pad: { ...current.pad, ...stored?.pad },
        };
      },
    },
  ),
);

const NAMED: Record<string, string> = {
  Enter: "Entrée",
  Escape: "Échap",
  Space: "Espace",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Tab: "Tab",
  ShiftLeft: "Maj",
  ShiftRight: "Maj",
};

/** Libellé d'une touche : la lettre imprimée selon l'agencement du clavier quand le navigateur le dit, sinon la lettre QWERTY. */
export function keyLabel(
  code: string,
  layout?: Map<string, string> | null,
): string {
  if (NAMED[code]) return NAMED[code];
  const printed = layout?.get(code);
  if (printed) return printed.toUpperCase();
  return code.replace(/^Key/, "").replace(/^Digit/, "");
}

/** Agencement du clavier (code physique → lettre imprimée) ; absent sur les navigateurs sans l'API `navigator.keyboard`. */
export function useLayoutMap(): Map<string, string> | null {
  const [map, setMap] = useState<Map<string, string> | null>(null);
  useEffect(() => {
    const keyboard = (
      navigator as unknown as {
        keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> };
      }
    ).keyboard;
    keyboard?.getLayoutMap?.().then(setMap, () => undefined);
  }, []);
  return map;
}
