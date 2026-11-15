"use client";

import { create } from "zustand";
import { PLAYER_COLORS } from "@stepup/shared";

/** Couleur automatique d'un joueur sans choix (invités compris) : tirée de son pseudo, donc la même pour tous les joueurs. */
export const autoColor = (name: string): string =>
  PLAYER_COLORS[
    [...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) %
      PLAYER_COLORS.length
  ]!;

/** Fond de pastille : la couleur choisie (sinon la couleur automatique du pseudo), adoucie pour rester lisible. */
export function pfpBackground(name: string, color?: string | null): string {
  return `color-mix(in srgb, ${color || autoColor(name)} 38%, white)`;
}

/** Couleur du compte connecté (ou null : automatique), partagée entre l'en-tête, le profil et la console. */
export const useMyColor = create<{
  color: string | null;
  set: (color: string | null) => void;
}>((set) => ({
  color: null,
  set: (color) => set({ color }),
}));
