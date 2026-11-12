"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

// Joueurs bloqués (par identité) : leurs messages de chat sont masqués sur cet appareil.
// shortcut: stockage local ; à rattacher au compte en base quand les profils arrivent (phase 6).
export const useBlocked = create(
  persist<{ ids: string[]; toggle: (id: string) => void }>(
    (set) => ({
      ids: [],
      toggle: (id) => set((s) => ({ ids: s.ids.includes(id) ? s.ids.filter((other) => other !== id) : [...s.ids, id] })),
    }),
    { name: "stepup-blocked" },
  ),
);
