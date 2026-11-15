const INK = "#2a1b4d";

/** Étoile à cinq branches (centre x, y ; rayon r). */
const star = (x: number, y: number, r: number) =>
  Array.from({ length: 10 }, (_, i) => {
    const radius = i % 2 ? r * 0.45 : r;
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    return `${x + Math.cos(a) * radius},${y + Math.sin(a) * radius}`;
  }).join(" ");

/** Carte à jouer inclinée, centrée en (x, y). */
function Card({
  x,
  y,
  angle,
  text,
  color,
}: {
  x: number;
  y: number;
  angle: number;
  text: string;
  color: string;
}) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${(angle * 180) / Math.PI})`}>
      <rect
        x={-60}
        y={-85}
        width={120}
        height={170}
        rx={16}
        fill="#fff"
        stroke={INK}
        strokeWidth={10}
      />
      <text
        y={8}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={84}
        fontWeight={800}
        fill={color}
        fontFamily="sans-serif"
      >
        {text}
      </text>
    </g>
  );
}

const ART: Record<
  string,
  { from: string; to: string; emblem: React.ReactNode }
> = {
  blackjack: {
    from: "#4a22c4",
    to: "#14c4bd",
    emblem: (
      <>
        <Card x={205} y={195} angle={-0.22} text="A" color="#ff5c6c" />
        <Card x={312} y={205} angle={0.18} text="K" color={INK} />
      </>
    ),
  },
  kart: {
    from: "#ff8a1f",
    to: "#ffd23f",
    emblem: (
      <>
        {Array.from({ length: 24 }, (_, i) => (
          <rect
            key={i}
            x={136 + (i % 6) * 40}
            y={90 + Math.floor(i / 6) * 40}
            width={40}
            height={40}
            fill={(Math.floor(i / 6) + (i % 6)) % 2 ? "#fff" : INK}
          />
        ))}
        <rect
          x={136}
          y={90}
          width={240}
          height={160}
          fill="none"
          stroke={INK}
          strokeWidth={10}
        />
        <circle cx={256} cy={250} r={62} fill={INK} />
        <circle
          cx={256}
          cy={250}
          r={26}
          fill="#ffd23f"
          stroke={INK}
          strokeWidth={10}
        />
      </>
    ),
  },
  party: {
    from: "#ff5c6c",
    to: "#6c3bf5",
    emblem: (
      <>
        <polygon
          points={star(180, 170, 78)}
          fill="#ffd23f"
          stroke={INK}
          strokeWidth={10}
          strokeLinejoin="round"
        />
        <polygon
          points={star(350, 120, 44)}
          fill="#ffd23f"
          stroke={INK}
          strokeWidth={10}
          strokeLinejoin="round"
        />
        <rect
          x={290}
          y={180}
          width={110}
          height={110}
          rx={20}
          fill="#fff"
          stroke={INK}
          strokeWidth={10}
        />
        {[
          [318, 208],
          [345, 235],
          [372, 262],
        ].map(([cx, cy]) => (
          <circle key={cx} cx={cx} cy={cy} r={11} fill={INK} />
        ))}
      </>
    ),
  },
};

const FALLBACK = {
  from: "#6c3bf5",
  to: "#ff5c6c",
  emblem: (
    <polygon
      points={star(256, 190, 90)}
      fill="#ffd23f"
      stroke={INK}
      strokeWidth={10}
      strokeLinejoin="round"
    />
  ),
};

/** Étiquette illustrée d'une cartouche (sans le titre) : dégradé, rayons rétro et emblème du jeu. */
export function CartridgeLabel({
  gameId,
  className,
}: {
  gameId: string;
  className?: string;
}) {
  const art = ART[gameId] ?? FALLBACK;
  const id = `label-${gameId}`;
  return (
    <svg
      viewBox="90 60 332 270"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      className={className}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={art.from} />
          <stop offset="1" stopColor={art.to} />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={512} height={460} fill={`url(#${id})`} />
      <g opacity={0.14} fill="#fff">
        {[0, 2, 4, 6, 8, 10].map((i) => {
          const a0 = (i * Math.PI) / 6;
          const a1 = ((i + 1) * Math.PI) / 6;
          return (
            <path
              key={i}
              d={`M256 200 L${256 + Math.cos(a0) * 700} ${200 + Math.sin(a0) * 700} L${256 + Math.cos(a1) * 700} ${200 + Math.sin(a1) * 700} Z`}
            />
          );
        })}
      </g>
      {art.emblem}
    </svg>
  );
}
