"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

// Effets sonores originaux, synthétisés à la volée (Web Audio) : aucun fichier audio.
// Le contexte audio n'est créé qu'au premier son, donc après une interaction de l'utilisateur.

export const useAudio = create(
  persist<{ muted: boolean; sfxVolume: number; setMuted: (muted: boolean) => void; setSfxVolume: (volume: number) => void }>(
    (set) => ({
      muted: false,
      sfxVolume: 0.6,
      setMuted: (muted) => set({ muted }),
      setSfxVolume: (sfxVolume) => set({ sfxVolume }),
    }),
    { name: "stepup-audio" },
  ),
);

/** Note : fréquence (Hz), début (s), durée (s), forme d'onde. */
type Note = [frequency: number, start: number, duration: number, wave: OscillatorType];

const SOUNDS = {
  select: [[660, 0, 0.07, "square"], [990, 0.06, 0.1, "square"]],
  flip: [[330, 0, 0.08, "triangle"], [220, 0.07, 0.14, "triangle"]],
  // Glissement puis verrouillage mécanique de la cartouche.
  insert: [[150, 0, 0.12, "square"], [70, 0.1, 0.24, "sawtooth"], [1200, 0.32, 0.05, "square"]],
  ready: [[523, 0, 0.1, "square"], [659, 0.1, 0.1, "square"], [784, 0.2, 0.1, "square"], [1047, 0.3, 0.24, "square"]],
} satisfies Record<string, Note[]>;

export type SoundName = keyof typeof SOUNDS;

let context: AudioContext | null = null;

export function playSfx(name: SoundName): void {
  const { muted, sfxVolume } = useAudio.getState();
  if (muted || sfxVolume <= 0 || typeof AudioContext === "undefined") return;
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
    const now = context.currentTime;
    for (const [frequency, start, duration, wave] of SOUNDS[name]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = wave;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(sfxVolume * 0.18, now + start);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + start);
      oscillator.stop(now + start + duration);
    }
  } catch {
    // Audio indisponible ou refusé par le navigateur : le jeu continue sans son.
  }
}
