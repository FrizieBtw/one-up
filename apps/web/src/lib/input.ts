"use client";

import { useEffect, useState } from "react";

// Couche d'entrées commune aux jeux : actions abstraites, lues depuis le clavier ou la manette.
// Le clavier reste toujours utilisable ; la manette s'ajoute quand elle est branchée.

export type InputDevice = "keyboard" | "gamepad";

const pressed = new Set<string>();
const DEADZONE = 0.25;

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** Première manette connectée. Aucune hypothèse sur son agencement au-delà des axes 0 et 1. */
function activeGamepad(): Gamepad | null {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return null;
  for (const pad of navigator.getGamepads()) if (pad?.connected) return pad;
  return null;
}

/** Direction de déplacement, x vers la droite et z vers le bas de l'écran, norme au plus 1. */
export function readMove(): { x: number; z: number } {
  let x = 0;
  let z = 0;
  // `code` désigne la touche physique : ZQSD sur AZERTY et WASD sur QWERTY donnent les mêmes codes.
  if (pressed.has("KeyA") || pressed.has("ArrowLeft")) x -= 1;
  if (pressed.has("KeyD") || pressed.has("ArrowRight")) x += 1;
  if (pressed.has("KeyW") || pressed.has("ArrowUp")) z -= 1;
  if (pressed.has("KeyS") || pressed.has("ArrowDown")) z += 1;

  const pad = activeGamepad();
  if (pad && x === 0 && z === 0) {
    const ax = pad.axes[0] ?? 0;
    const az = pad.axes[1] ?? 0;
    if (Math.hypot(ax, az) > DEADZONE) {
      x = ax;
      z = az;
    } else {
      // Croix directionnelle, si la manette l'expose aux indices standards.
      if (pad.buttons[14]?.pressed) x -= 1;
      if (pad.buttons[15]?.pressed) x += 1;
      if (pad.buttons[12]?.pressed) z -= 1;
      if (pad.buttons[13]?.pressed) z += 1;
    }
  }
  const length = Math.hypot(x, z);
  return length > 1 ? { x: x / length, z: z / length } : { x, z };
}

let previousButtons: boolean[] = [];
/** Indices des boutons de manette qui viennent d'être enfoncés depuis le dernier appel. */
export function readGamepadPresses(): number[] {
  const buttons = activeGamepad()?.buttons.map((b) => b.pressed) ?? [];
  const fresh = buttons.flatMap((down, i) => (down && !previousButtons[i] ? [i] : []));
  previousButtons = buttons;
  return fresh;
}

/** Branche l'écoute du clavier. `onKey` reçoit les touches enfoncées hors saisie de texte. */
export function attachInput(onKey?: (code: string) => void): () => void {
  const down = (e: KeyboardEvent) => {
    if (isTyping(e.target)) return;
    if (e.code.startsWith("Arrow")) e.preventDefault(); // pas de défilement de page pendant le jeu
    if (!e.repeat) onKey?.(e.code);
    pressed.add(e.code);
  };
  const up = (e: KeyboardEvent) => pressed.delete(e.code);
  const clear = () => pressed.clear();
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  window.addEventListener("blur", clear);
  return () => {
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
    window.removeEventListener("blur", clear);
    clear();
  };
}

/** Périphérique à afficher dans les aides de commandes ; suit branchement et débranchement. */
export function useInputDevice(): InputDevice {
  const [device, setDevice] = useState<InputDevice>("keyboard");
  useEffect(() => {
    const sync = () => setDevice(activeGamepad() ? "gamepad" : "keyboard");
    sync();
    window.addEventListener("gamepadconnected", sync);
    window.addEventListener("gamepaddisconnected", sync);
    return () => {
      window.removeEventListener("gamepadconnected", sync);
      window.removeEventListener("gamepaddisconnected", sync);
    };
  }, []);
  return device;
}
