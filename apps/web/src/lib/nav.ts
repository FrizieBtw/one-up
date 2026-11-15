"use client";

import { create } from "zustand";
import { normalizeRoomCode } from "@stepup/shared";
import { leaveLobby } from "./lobby";

export type CartridgePanel = "menu" | "search" | "code" | "create";
export type ProfileTabId =
  | "profile"
  | "avatar"
  | "shop"
  | "inventory"
  | "missions"
  | "achievements"
  | "leaderboards"
  | "friends"
  | "history";

// États de navigation : accueil → cartouche sélectionnée (dos visible) → lobby.
// Une seule page et une seule scène 3D : les transitions sont continues, l'URL suit via l'historique.
interface Nav {
  /** `room` : la chambre (accueil) ; `home` : l'écran Console, grille des jeux. */
  view: "room" | "home" | "cartridge" | "lobby" | "profile" | "settings";
  /** Écran affiché sous les Paramètres (on y revient en les fermant). */
  previousView: "room" | "home" | "profile" | "lobby";
  /** Jeu de la cartouche sélectionnée, ou du salon une fois son état reçu. */
  gameId: string | null;
  panel: CartridgePanel;
  code: string | null;
  /** Section du profil à ouvrir (la boutique s'ouvre depuis l'en-tête). */
  profileTab: ProfileTabId;
  /** Lobby : cartouche agrandie, réglages affichés au dos. */
  settingsOpen: boolean;
  hovered: string | null;
  /** Séquence de lancement : approche de la console, insertion, attente du chargement réel. */
  /** La scène de jeu est chargée et affichable. */

  select(gameId: string): void;
  setPanel(panel: CartridgePanel): void;
  setHovered(gameId: string | null): void;
  enterLobby(code: string, gameId: string | null): void;
  setLobbyGame(gameId: string): void;
  setSettingsOpen(open: boolean): void;
  /** Retour d'un cran (Échap, bouton retour). Ne quitte jamais un salon ; dans la chambre, ouvre les Paramètres. */
  back(): void;
  goHome(): void;
  /** Retour à la chambre sans quitter le salon (fin de partie). */
  showRoom(): void;
  /** Console de la chambre : choix du jeu. */
  openConsole(): void;
  openProfile(tab?: ProfileTabId): void;
  /** Paramètres : une vue comme les autres, mais le salon en cours (lobby) n'est pas quitté. */
  openSettings(): void;
  closeSettings(): void;
  /** Objet de boutique à essayer dans l'éditeur d'avatar (« Essayer au miroir »). */
  tryItemId: string | null;
  tryAtMirror(itemId: string): void;
  syncFromUrl(): void;
}

/** Quitter le salon seulement si on y est : la chambre (salon créé à l'arrivée) reste ouverte quand on ouvre la Console, le profil, la boutique… */
const leaveIfInLobby = (s: { view: string; previousView: string }) => {
  if (
    s.view === "lobby" ||
    (s.view === "settings" && s.previousView === "lobby")
  )
    void leaveLobby();
};

const setUrl = (path: string) => {
  if (window.location.pathname !== path)
    window.history.pushState(null, "", path);
};

export const useNav = create<Nav>((set, get) => ({
  view: "room",
  previousView: "room",
  gameId: null,
  panel: "menu",
  code: null,
  profileTab: "profile",
  tryItemId: null,
  settingsOpen: false,
  hovered: null,

  select: (gameId) =>
    set({ view: "cartridge", gameId, panel: "menu", hovered: null }),
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
    if (view === "cartridge")
      set(
        panel === "menu" ? { view: "home", gameId: null } : { panel: "menu" },
      );
    else if (view === "lobby" && settingsOpen) set({ settingsOpen: false });
    else if (view === "settings") get().closeSettings();
    // Échap : Console, profil et boutique reviennent à la chambre ; dans la chambre, il ouvre les Paramètres.
    else if (view === "home" || view === "profile") get().goHome();
    else if (view === "room") get().openSettings();
  },
  showRoom: () => {
    set({ view: "room" });
    setUrl("/");
  },
  goHome: () => {
    leaveIfInLobby(get());
    set({ view: "room", gameId: null, code: null, settingsOpen: false });
    setUrl("/");
  },
  openConsole: () => {
    leaveIfInLobby(get());
    set({ view: "home", gameId: null, code: null, settingsOpen: false });
    setUrl("/");
  },
  tryAtMirror: (itemId) => {
    leaveIfInLobby(get());
    set({
      view: "profile",
      profileTab: "avatar",
      tryItemId: itemId,
      gameId: null,
      code: null,
      settingsOpen: false,
    });
    setUrl("/");
  },
  openProfile: (tab = "profile") => {
    leaveIfInLobby(get());
    set({
      view: "profile",
      profileTab: tab,
      tryItemId: null,
      gameId: null,
      code: null,
      settingsOpen: false,
    });
    setUrl("/");
  },
  openSettings: () => {
    const { view } = get();
    if (view === "settings") return;
    const previousView = view === "cartridge" ? "lobby" : view;
    // La route ne change pas : Paramètres, profil et boutique sont des écrans de la chambre.
    set({ view: "settings", previousView });
  },
  closeSettings: () => {
    const { previousView } = get();
    set({ view: previousView });
  },
  syncFromUrl: () => {
    if (window.location.pathname === "/settings") {
      leaveIfInLobby(get());
      return set({
        view: "settings",
        previousView: "room",
        gameId: null,
        code: null,
      });
    }
    if (window.location.pathname === "/profile") {
      leaveIfInLobby(get());
      return set({
        view: "profile",
        gameId: null,
        code: null,
        settingsOpen: false,
      });
    }
    const match = window.location.pathname.match(/^\/lobby\/([^/]+)$/);
    const code = match
      ? normalizeRoomCode(decodeURIComponent(match[1]!))
      : null;
    const state = get();
    if (code) {
      // Lien de partage : on arrive dans la chambre de l'hôte (la jointure se fait dans StepUpApp).
      set({ view: "room", code: null, gameId: null, settingsOpen: false });
      setUrl("/");
      window.dispatchEvent(new CustomEvent("stepup:join", { detail: code }));
    } else if (
      state.view === "lobby" ||
      state.view === "profile" ||
      state.view === "settings"
    ) {
      leaveIfInLobby(get());
      set({ view: "room", gameId: null, code: null, settingsOpen: false });
    }
  },
}));
