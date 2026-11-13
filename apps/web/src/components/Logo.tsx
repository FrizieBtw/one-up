const INK = "#0f0d22";

/** Logo avec le nom : la marque à gauche, « OneUP » en Outfit extra gras à droite. */
export function LogoLockup({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 font-hud text-hud-ink ${className ?? ""}`}>
      <LogoMark decorative className="h-[46px] w-auto" />
      <span className="text-[32px] leading-none font-extrabold tracking-tight">
        One<span className="text-hud-accent">UP</span>
      </span>
    </span>
  );
}

/**
 * Logo OneUP : manette lavande, flèche jaune penchée vers la droite (« level up »), dé et carte au premier plan.
 * Même dessin dans `app/icon.svg` (icône de l'onglet) : à garder synchronisé.
 */
export function LogoMark({ className, decorative }: { className?: string; decorative?: boolean }) {
  return (
    <svg viewBox="0 0 160 140" {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": "OneUP" })} className={className}>
      <path
        d="M42 30C22 30 10 50 8 84C6 106 14 120 28 118C42 116 50 104 56 94L104 94C110 104 118 116 132 118C146 120 154 106 152 84C150 50 138 30 118 30Z"
        fill="#b9a3f5"
        stroke={INK}
        strokeWidth="6"
        strokeLinejoin="round"
      />
      <path d="M26 56h12v10h10v12H38v10H26V78H16V66h10z" fill="#fff" stroke={INK} strokeWidth="4.5" strokeLinejoin="round" />
      <circle cx="126" cy="58" r="9" fill="#ff9eb5" stroke={INK} strokeWidth="4.5" />
      <circle cx="141" cy="74" r="9" fill="#8fe3c0" stroke={INK} strokeWidth="4.5" />
      <path d="M80 6L114 46H95V104H65V46H46Z" fill="#ffe08a" stroke={INK} strokeWidth="6.5" strokeLinejoin="round" transform="rotate(12 80 56)" />
      <g transform="translate(30 104) rotate(-12)">
        <rect x="-18" y="-18" width="36" height="36" rx="8" fill="#fff" stroke={INK} strokeWidth="5" />
        {[[-8, -8], [8, -8], [0, 0], [-8, 8], [8, 8]].map(([x, y]) => (
          <circle key={`${x}${y}`} cx={x} cy={y} r="3.4" fill={INK} />
        ))}
      </g>
      <g transform="translate(132 98) rotate(12)">
        <rect x="-17" y="-24" width="34" height="48" rx="6" fill="#fff" stroke={INK} strokeWidth="5" />
        <path d="M0 -9C11 -1 13 6 7 9C4 11 2 10 1 8L3 15H-3L-1 8C-2 10-4 11-7 9C-13 6-11 -1 0 -9Z" fill={INK} />
      </g>
    </svg>
  );
}
