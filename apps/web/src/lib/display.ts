"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RoomAccess } from "@stepup/shared";

/** Réglages d'affichage et de chambre, mémorisés sur l'appareil. */
export const useDisplay = create(
  persist<{
    floatingDecor: boolean;
    setFloatingDecor: (on: boolean) => void;
    roomAccess: RoomAccess;
    setRoomAccess: (access: RoomAccess) => void;
    gameId: string | null;
    setGameId: (id: string) => void;
    musicOn: boolean;
    setMusicOn: (on: boolean) => void;
    chatOverlay: boolean;
    setChatOverlay: (on: boolean) => void;
  }>(
    (set) => ({
      floatingDecor: true,
      setFloatingDecor: (floatingDecor) => set({ floatingDecor }),
      /** Accès à la chambre : fermée (code requis), publique (visible dans « Chambres ouvertes ») ou amis seulement ; fermée par défaut. */
      roomAccess: "closed",
      setRoomAccess: (roomAccess) => set({ roomAccess }),
      /** Cartouche choisie dans la Console (affichée dans les infos de la chambre). */
      gameId: null,
      setGameId: (gameId) => set({ gameId }),
      // Réglages mémorisés dès maintenant ; la musique et le chat à l'écran arrivent avec leurs fonctions.
      musicOn: true,
      setMusicOn: (musicOn) => set({ musicOn }),
      chatOverlay: true,
      setChatOverlay: (chatOverlay) => set({ chatOverlay }),
    }),
    { name: "stepup-display" },
  ),
);
