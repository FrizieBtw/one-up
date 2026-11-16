"use client";

import { create } from "zustand";
import { keepAcrossReloads } from "./hmr";
import { normalizeRoomCode } from "@stepup/shared";

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

// Navigation : la chambre est l'écran de base ; la Console, le profil (et la boutique) et les Paramètres sont des fenêtres posées dessus,
// une seule à la fois. La route reste « / » (sauf les liens de partage /lobby/CODE, lus au chargement).
interface Nav {
  /** `room` : la chambre ; `home` : la Console (grille des jeux) ; puis le profil (avec la boutique) et les Paramètres. */
  view: "room" | "home" | "profile" | "settings";
  /** Écran affiché sous les Paramètres (on y revient en les fermant). */
  previousView: "room" | "home" | "profile";
  /** Section du profil à ouvrir (la boutique s'ouvre depuis l'en-tête). */
  profileTab: ProfileTabId;
  /** Objet de boutique à essayer dans l'éditeur d'avatar (« Essayer au miroir »). */
  tryItemId: string | null;

  /** Retour d'un cran (Échap, bouton B). La Console et le profil reviennent à la chambre ; dans la chambre, il ouvre les Paramètres. */
  back(): void;
  goHome(): void;
  /** Console de la chambre : choix du jeu. */
  openConsole(): void;
  openProfile(tab?: ProfileTabId): void;
  openSettings(): void;
  closeSettings(): void;
  tryAtMirror(itemId: string): void;
  syncFromUrl(): void;
}

const setUrl = (path: string) => {
  if (window.location.pathname !== path)
    window.history.pushState(null, "", path);
};

export const useNav = keepAcrossReloads("stepup:nav", () =>
  create<Nav>((set, get) => ({
    view: "room",
    previousView: "room",
    profileTab: "profile",
    tryItemId: null,

    back: () => {
      const { view } = get();
      if (view === "settings") get().closeSettings();
      else if (view === "home" || view === "profile") get().goHome();
      else get().openSettings();
    },
    goHome: () => {
      set({ view: "room" });
      setUrl("/");
    },
    openConsole: () => {
      set({ view: "home" });
      setUrl("/");
    },
    tryAtMirror: (itemId) => {
      set({ view: "profile", profileTab: "avatar", tryItemId: itemId });
      setUrl("/");
    },
    openProfile: (tab = "profile") => {
      set({ view: "profile", profileTab: tab, tryItemId: null });
      setUrl("/");
    },
    openSettings: () => {
      const { view } = get();
      if (view === "settings") return;
      // La route ne change pas : les Paramètres sont une fenêtre posée sur l'écran d'où l'on vient.
      set({ view: "settings", previousView: view });
    },
    closeSettings: () => set({ view: get().previousView }),
    syncFromUrl: () => {
      if (window.location.pathname === "/settings")
        return set({ view: "settings", previousView: "room" });
      if (window.location.pathname === "/profile")
        return set({ view: "profile" });
      const match = window.location.pathname.match(/^\/lobby\/([^/]+)$/);
      const code = match
        ? normalizeRoomCode(decodeURIComponent(match[1]!))
        : null;
      if (code) {
        // Lien de partage : on arrive dans la chambre de l'hôte (la jointure se fait dans StepUpApp).
        set({ view: "room" });
        setUrl("/");
        window.dispatchEvent(new CustomEvent("stepup:join", { detail: code }));
      } else if (get().view === "profile" || get().view === "settings")
        set({ view: "room" });
    },
  })),
);
