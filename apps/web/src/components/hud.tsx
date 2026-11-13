import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

// Composants de la direction OneUP : panneaux blancs plats et arrondis posés sur le monde 3D pastel.
const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" ");

export function HudPanel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx("rounded-hud bg-white font-hud text-hud-ink", className)} />;
}

const buttonVariants = {
  primary: "bg-hud-accent text-white",
  soft: "bg-hud-soft text-hud-accent",
  outline: "border-[1.5px] border-hud-line bg-white text-hud-ink",
  danger: "bg-hud-bad-soft text-hud-bad",
  discord: "bg-[#5865f2] text-white",
};

export function HudButton({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonVariants }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-hud text-sm font-semibold transition-opacity",
        "hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
        buttonVariants[variant],
        className,
      )}
    />
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/** Sélecteur en capsule (onglets Connexion / Créer un compte, etc.). */
export function HudSegmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cx("flex rounded-full bg-hud-soft p-[3px]", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            "flex-1 rounded-full py-1.5 font-hud text-[13px] font-semibold",
            o.value === value ? "bg-hud-accent text-white" : "text-black",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export type FieldState = "ok" | "bad" | undefined;

/** Champ à libellé, indication et état (valide / erreur) : l'indication est reliée au champ pour les lecteurs d'écran. */
export function HudField({
  label,
  hint,
  state,
  action,
  className,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; state?: FieldState; action?: ReactNode; id: string }) {
  const hintId = `${id}-hint`;
  return (
    <div className={cx("mb-2", className)}>
      <label htmlFor={id} className="mb-0.5 block text-xs font-semibold text-hud-ink">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          aria-describedby={hint ? hintId : undefined}
          aria-invalid={state === "bad" || undefined}
          {...props}
          className={cx(
            "h-[38px] w-full rounded-[11px] border-[1.5px] bg-hud-field px-3 font-hud text-sm text-hud-ink outline-none placeholder:text-[#9a97bd] focus:bg-white",
            state === "bad" ? "border-hud-bad-line" : state === "ok" ? "border-hud-ok" : "border-hud-line focus:border-hud-accent",
            action ? "pr-20" : undefined,
          )}
        />
        {action && <span className="absolute top-1/2 right-2.5 -translate-y-1/2">{action}</span>}
      </div>
      {hint && (
        <p id={hintId} className={cx("mt-0.5 min-h-4 text-[11.5px]", state === "bad" ? "text-hud-bad" : state === "ok" ? "text-hud-ok" : "text-hud-muted")}>
          {hint}
        </p>
      )}
    </div>
  );
}
