import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes } from "react";

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" ");

const variants = {
  primary: "bg-violet text-white",
  accent: "bg-orange text-ink",
  calm: "bg-turquoise text-ink",
  plain: "bg-white text-ink",
  danger: "bg-coral text-ink",
};

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "rounded-full border-3 border-ink px-5 py-2 font-display text-lg font-bold shadow-chunk-sm transition-transform",
        "hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0",
        variants[variant],
        className,
      )}
    />
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx("rounded-chunk border-3 border-ink bg-white p-5 shadow-chunk", className)} />;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx("w-full rounded-2xl border-3 border-ink bg-cream px-4 py-2 font-semibold placeholder:text-ink/40", className)}
    />
  );
}

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} className={cx("rounded-full border-2 border-ink px-2.5 py-0.5 text-xs font-extrabold", className)} />;
}
