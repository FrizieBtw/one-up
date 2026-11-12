"use client";

import { create } from "zustand";
import { normalizeRoomCode } from "@stepup/shared";
import { leaveLobby } from "./lobby";

export type CartridgePanel = "menu" | "search" | "code" | "create";

// États de navigation : accueil → cartouche sélectionnée (dos visible) → lobby.
// Une seule page et une seule scène 3D : les transitions sont continues, l'URL suit via l'historique.
interface Nav {
  view: "home" | "cartridge" | "lobby";
  /** Jeu de la cartouche sélectionnée, ou du salon une fois son état reçu. */
  gameId: string | null;
  panel: CartridgePanel;
  code: string | null;
  /** Lobby : cartouche agrandie, réglages affichés au dos. */
  settingsOpen: boolean;
  hovered: string | null;

  select(gameId: string): void;
  setPanel(panel: CartridgePanel): void;
  setHovered(gameId: string | null): void;
  enterLobby(code: string, gameId: string | null): void;
  setLobbyGame(gameId: string): void;
  setSettingsOpen(open: boolean): void;
  /** Retour d'un cran (Échap, bouton retour). Ne quitte jamais un salon. */
  back(): void;
  goHome(): void;
  syncFromUrl(): void;
}

const setUrl = (path: string) => {
  if (window.location.pathname !== path) window.history.pushState(null, "", path);
};

export const useNav = create<Nav>((set, get) => ({
  view: "home",
  gameId: null,
  panel: "menu",
  code: null,
  settingsOpen: false,
  hovered: null,

  select: (gameId) => set({ view: "cartridge", gameId, panel: "menu", hovered: null }),
  setPanel: (panel) => set({ panel }),
  setHovered: (hovered) => set({ hovered }),
  enterLobby: (code, gameId) => {
    set({ view: "lobby", code, gameId, settingsOpen: false });
    setUrl(`/lobby/${code}`);
  },
  setLobbyGame: (gameId) => set({ gameId }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  back: () => {
    const { view, panel, settingsOpen } = get();
    if (view === "cartridge") set(panel === "menu" ? { view: "home", gameId: null } : { panel: "menu" });
    else if (settingsOpen) set({ settingsOpen: false });
  },
  goHome: () => {
    void leaveLobby();
    set({ view: "home", gameId: null, code: null, settingsOpen: false });
    setUrl("/");
  },
  syncFromUrl: () => {
    const match = window.location.pathname.match(/^\/lobby\/([^/]+)$/);
    const code = match ? normalizeRoomCode(decodeURIComponent(match[1]!)) : null;
    const state = get();
    if (code) {
      if (state.view !== "lobby" || state.code !== code) set({ view: "lobby", code, gameId: null, settingsOpen: false });
    } else if (state.view === "lobby") {
      void leaveLobby();
      set({ view: "home", gameId: null, code: null, settingsOpen: false });
    }
  },
}));
