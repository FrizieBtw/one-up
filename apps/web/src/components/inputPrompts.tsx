import { CONTROLLER_BUTTONS, KEYBOARD_KEYS } from "./inputPromptsData";
import { useInputDevice } from "@/lib/input";

const INK = "#2a2750";

const BY_CODE: Record<string, string> = {
  ArrowUp: "arrow_up",
  ArrowDown: "arrow_down",
  ArrowLeft: "arrow_left",
  ArrowRight: "arrow_right",
  Enter: "enter",
  NumpadEnter: "enter",
  Escape: "escape",
  Space: "space",
  ShiftLeft: "shift",
  ShiftRight: "shift",
  ControlLeft: "ctrl",
  ControlRight: "ctrl",
  AltLeft: "alt",
  AltRight: "alt",
  Tab: "tab",
  Backspace: "backspace",
  CapsLock: "capslock",
  Delete: "delete",
  Home: "home",
  End: "end",
  PageUp: "page_up",
  PageDown: "page_down",
};

/** Nom de l'icône Kenney d'une touche : la lettre imprimée sur la touche (agencement du clavier) ou un nom fixe ; undefined si le pack n'en a pas. */
function keyName(code: string, printed?: string): string | undefined {
  if (BY_CODE[code]) return BY_CODE[code];
  const letter = (
    printed ?? code.replace(/^Key/, "").replace(/^Digit/, "")
  ).toLowerCase();
  if (/^[a-z0-9]$/.test(letter) && KEYBOARD_KEYS[letter]) return letter;
  if (/^F\d{1,2}$/.test(code)) return code.toLowerCase();
  return undefined;
}

/** Touche de clavier (Kenney Input Prompts) ; une pastille de texte si le pack n'a pas d'icône pour cette touche. */
export function KeyIcon({
  code,
  printed,
  label,
  className = "size-8",
}: {
  code: string;
  printed?: string;
  label: string;
  className?: string;
}) {
  const name = keyName(code, printed);
  if (!name || !KEYBOARD_KEYS[name]) {
    return (
      <span className="grid h-8 min-w-8 place-items-center rounded-lg bg-hud-ink px-1.5 font-hud text-xs font-semibold text-white">
        {label}
      </span>
    );
  }
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label={label}
      className={className}
    >
      <path fill={INK} d={KEYBOARD_KEYS[name]} />
    </svg>
  );
}

/** Rappel « Échap : Fermer » (B avec une manette) affiché dans les fenêtres (elles n'ont pas de bouton de fermeture). */
export function EscapeHint({ className = "" }: { className?: string }) {
  const device = useInputDevice();
  return (
    <span
      className={`flex items-center gap-1.5 text-[13px] font-semibold text-black ${className}`}
    >
      {device === "gamepad" ? (
        <ControllerIcon button="b" label="B" />
      ) : (
        <KeyIcon code="Escape" label="Échap" />
      )}
      Fermer
    </span>
  );
}

/** Bouton de manette Xbox (Kenney Input Prompts) : A, B, X, Y en couleur, les autres en encre. `fixed` les dessine en noir (déplacements non modifiables). */
export function ControllerIcon({
  button,
  label,
  fixed,
  className = "size-8",
}: {
  button: string;
  label: string;
  fixed?: boolean;
  className?: string;
}) {
  const entry = CONTROLLER_BUTTONS[button];
  if (!entry) return null;
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label={label}
      className={className}
    >
      <path fill={fixed ? "#000" : (entry[1] ?? INK)} d={entry[0]} />
    </svg>
  );
}
