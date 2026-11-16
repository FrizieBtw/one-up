import {
  AVATAR_RADIUS,
  BLACKJACK_TABLE,
  blackjackSeat,
  LOBBY_SPEED,
  ROOM_BLOCKS,
  ROOM_BLOCK_HEIGHTS,
  ROOM_HALF,
  RUN_SPEED,
} from "./config";

export interface Vec2 {
  x: number;
  z: number;
}

/** Direction de déplacement sûre : valeurs finies, norme au plus 1. */
export function clampDirection(x: number, z: number): Vec2 {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return { x: 0, z: 0 };
  const length = Math.hypot(x, z);
  return length > 1 ? { x: x / length, z: z / length } : { x, z };
}

const limit = ROOM_HALF;
/** Vitesse (unités/s) à laquelle un joueur qui avance contre un autre le repousse : lente, et annulée si l'autre pousse aussi. */
const PUSH_SPEED = 0.35;
/** Secondes après le départ d'une partie de blackjack où les meubles de la chambre ont disparu : leurs obstacles aussi. */
export const BLACKJACK_FURNITURE_GONE_AT = 2;

// ---------- Saut ----------

/** Gravité et vitesse de saut : un saut dure 0,65 s et monte à 0,75 (la même courbe que l'animation de saut). */
export const GRAVITY = 14.2;
export const JUMP_SPEED = 4.6;
/** Marge (hauteur) tolérée pour monter sur un obstacle en marchant. */
const STEP_HEIGHT = 0.06;

/** Position verticale d'un personnage : hauteur des pieds au-dessus du sol de la chambre, et vitesse verticale. */
export interface Body {
  y: number;
  vy: number;
}

/** `furniture` : faux quand les meubles ont disparu (partie de blackjack), seules les limites de la chambre comptent alors. `y` : hauteur des pieds, un meuble plus bas ne bloque pas. */
const blocked = (x: number, z: number, furniture = true, y = 0) =>
  furniture &&
  ROOM_BLOCKS.some(
    ([x0, x1, z0, z1], i) =>
      x > x0 - AVATAR_RADIUS &&
      x < x1 + AVATAR_RADIUS &&
      z > z0 - AVATAR_RADIUS &&
      z < z1 + AVATAR_RADIUS &&
      y + STEP_HEIGHT < (ROOM_BLOCK_HEIGHTS[i] ?? 9),
  );

/** Dessus du meuble sous (x, z) : le plus haut des meubles dont l'emprise contient la position, ou 0 (le sol). */
function furnitureGround(x: number, z: number, furniture: boolean): number {
  if (!furniture) return 0;
  let ground = 0;
  ROOM_BLOCKS.forEach(([x0, x1, z0, z1], i) => {
    if (
      x > x0 - AVATAR_RADIUS &&
      x < x1 + AVATAR_RADIUS &&
      z > z0 - AVATAR_RADIUS &&
      z < z1 + AVATAR_RADIUS
    )
      ground = Math.max(ground, ROOM_BLOCK_HEIGHTS[i] ?? 9);
  });
  return ground;
}

/** Un autre joueur gêne le pas s'il se rapproche à moins de deux rayons ; deux joueurs déjà superposés peuvent toujours s'écarter. */
const bumps = (x: number, z: number, from: Vec2, others: readonly Vec2[]) =>
  others.some((o) => {
    const next = Math.hypot(x - o.x, z - o.z);
    return (
      next < AVATAR_RADIUS * 2 && next < Math.hypot(from.x - o.x, from.z - o.z)
    );
  });

/**
 * Avance une position dans la chambre : limites carrées, meubles et autres joueurs (`others`) contournés (l'avatar glisse le long). `run` double la vitesse.
 * Même fonction côté serveur (autorité) et côté client (prédiction locale), pour que les deux simulations concordent.
 */
export function stepLobbyPosition(
  position: Vec2,
  direction: Vec2,
  seconds: number,
  run = false,
  others: readonly Vec2[] = [],
  /** Obstacle supplémentaire (la table de blackjack et ses poufs) : vrai si la position est bloquée. */
  extra?: (x: number, z: number) => boolean,
  /** Les meubles de la chambre sont-ils encore là (et donc des obstacles) ? */
  furniture = true,
  /** Hauteur des pieds : on passe par-dessus les obstacles plus bas. */
  y = 0,
): void {
  const step = (run ? RUN_SPEED : LOBBY_SPEED) * seconds;
  const nx = Math.max(-limit, Math.min(limit, position.x + direction.x * step));
  const nz = Math.max(-limit, Math.min(limit, position.z + direction.z * step));
  const free = (x: number, z: number) =>
    !blocked(x, z, furniture, y) &&
    !(extra?.(x, z) ?? false) &&
    !bumps(x, z, position, others);
  if (free(nx, nz)) {
    position.x = nx;
    position.z = nz;
  } else if (free(nx, position.z)) position.x = nx;
  else if (free(position.x, nz)) position.z = nz;
}

/**
 * Poussée entre joueurs : celui qui avance contre un autre le repousse tout doucement, dans l'axe qui les sépare.
 * Deux joueurs qui se poussent l'un l'autre s'annulent. Les positions modifiées restent dans la chambre et hors des meubles.
 */
export function pushApart(
  players: readonly (Vec2 & { dx: number; dz: number })[],
  seconds: number,
  furniture = true,
): void {
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i]!;
      const b = players[j]!;
      const distance = Math.hypot(b.x - a.x, b.z - a.z);
      if (distance === 0 || distance >= AVATAR_RADIUS * 2.7) continue;
      const ux = (b.x - a.x) / distance;
      const uz = (b.z - a.z) / distance;
      const net =
        (Math.max(0, a.dx * ux + a.dz * uz) -
          Math.max(0, -(b.dx * ux + b.dz * uz))) *
        PUSH_SPEED *
        seconds;
      if (net === 0) continue;
      // Seul le joueur poussé recule (net > 0 : b, net < 0 : a) ; celui qui pousse est juste bloqué par la collision.
      const target = net > 0 ? b : a;
      const nx = Math.max(-limit, Math.min(limit, target.x + ux * net));
      const nz = Math.max(-limit, Math.min(limit, target.z + uz * net));
      if (!blocked(nx, nz, furniture)) {
        target.x = nx;
        target.z = nz;
      }
    }
  }
}

// ---------- Table de blackjack : obstacles posés dans la chambre pendant la partie ----------

/**
 * Secondes (depuis le départ de la partie) où chaque élément a fini de tomber et devient un obstacle : la table, les poufs
 * (l'un après l'autre) puis le croupier. Reprend le rythme de l'animation d'arrivée côté client.
 */
export const BLACKJACK_LAND_AT = {
  table: 3.5,
  stool: (index: number) => 4.2 + index * 0.12,
  dealer: 6.0,
};
const TABLE_RADIUS = 1.5;
/** Hauteurs du dessus de la table, d'un pouf et du croupier (ce dernier est trop haut pour sauter dessus). */
const TABLE_HEIGHT = 0.52;
const STOOL_HEIGHT = 0.25;
const DEALER_HEIGHT = 1.5;
const STOOL_RADIUS = 0.3;
const DEALER_RADIUS = 0.35;
const DEALER_BEHIND = 0.2;

interface Blocker {
  x: number;
  z: number;
  radius: number;
  /** Demi-disque : seul le côté de ce vecteur (vers les joueurs) est plein. */
  half?: { x: number; z: number };
  landedAt: number;
  /** Hauteur du dessus : plus bas que les pieds du personnage, l'élément ne bloque plus. */
  height: number;
}

function blackjackBlockers(): Blocker[] {
  const { x, z, seats, facingDegrees } = BLACKJACK_TABLE;
  const turn = (facingDegrees * Math.PI) / 180;
  const dir = { x: Math.sin(turn), z: Math.cos(turn) };
  const blockers: Blocker[] = [
    {
      x,
      z,
      radius: TABLE_RADIUS,
      half: dir,
      landedAt: BLACKJACK_LAND_AT.table,
      height: TABLE_HEIGHT,
    },
    {
      x: x - dir.x * DEALER_BEHIND,
      z: z - dir.z * DEALER_BEHIND,
      radius: DEALER_RADIUS,
      landedAt: BLACKJACK_LAND_AT.dealer,
      height: DEALER_HEIGHT,
    },
  ];
  for (let i = 0; i < seats; i++) {
    const seat = blackjackSeat(i);
    blockers.push({
      x: seat.x,
      z: seat.z,
      radius: STOOL_RADIUS,
      landedAt: BLACKJACK_LAND_AT.stool(i),
      height: STOOL_HEIGHT,
    });
  }
  return blockers;
}
const BLOCKERS = blackjackBlockers();

const insideBlocker = (b: Blocker, px: number, pz: number) => {
  const dx = px - b.x;
  const dz = pz - b.z;
  if (Math.hypot(dx, dz) >= b.radius + AVATAR_RADIUS) return false;
  return !b.half || dx * b.half.x + dz * b.half.z >= -AVATAR_RADIUS;
};

/** Vrai si la position est dans la table, un pouf ou le croupier déjà posés `elapsed` secondes après le départ de la partie. */
export function blockedByBlackjack(
  px: number,
  pz: number,
  elapsed: number,
  /** Hauteur des pieds : un élément plus bas ne bloque pas (on saute dessus). */
  y = 0,
): boolean {
  return BLOCKERS.some(
    (b) =>
      elapsed >= b.landedAt &&
      y + STEP_HEIGHT < b.height &&
      insideBlocker(b, px, pz),
  );
}

/** Sol sous (x, z) : 0, ou le dessus du plus haut meuble ou élément de la table sous la position (on peut y atterrir et y marcher). */
export function groundHeight(
  x: number,
  z: number,
  furniture: boolean,
  elapsed: number | null,
): number {
  let ground = furnitureGround(x, z, furniture);
  if (elapsed !== null)
    for (const b of BLOCKERS)
      if (elapsed >= b.landedAt && insideBlocker(b, x, z))
        ground = Math.max(ground, b.height);
  return ground;
}

/** Démarre un saut si le personnage est au sol (ou sur un meuble). */
export function startJump(body: Body, ground: number): boolean {
  if (body.y > ground + 0.02 || body.vy !== 0) return false;
  body.vy = JUMP_SPEED;
  return true;
}

/** Fait avancer la verticale : gravité, atterrissage sur le sol sous la position. Même fonction pour le serveur et le client. */
export function stepVertical(
  body: Body,
  ground: number,
  seconds: number,
): void {
  body.vy -= GRAVITY * seconds;
  body.y += body.vy * seconds;
  if (body.y <= ground) {
    body.y = ground;
    body.vy = 0;
  }
}

/**
 * Pousse hors des éléments qui viennent d'atterrir un joueur resté dessous : il est repoussé vers le point libre le plus proche
 * (hors de la table, des poufs et du croupier). `seconds` : durée du pas (vitesse de poussée 4 unités/s).
 */
export function pushOutOfBlackjack(
  position: Vec2,
  elapsed: number,
  seconds: number,
  y = 0,
): void {
  if (!blockedByBlackjack(position.x, position.z, elapsed, y)) return;
  for (let radius = 0.15; radius <= 4; radius += 0.15) {
    let best: Vec2 | null = null;
    for (let k = 0; k < 24; k++) {
      const angle = (k / 24) * Math.PI * 2;
      const x = position.x + Math.cos(angle) * radius;
      const z = position.z + Math.sin(angle) * radius;
      if (
        Math.abs(x) > limit ||
        Math.abs(z) > limit ||
        blocked(x, z, elapsed < BLACKJACK_FURNITURE_GONE_AT) ||
        blockedByBlackjack(x, z, elapsed)
      )
        continue;
      best = { x, z };
      break;
    }
    if (!best) continue;
    const step = Math.min(4 * seconds, radius);
    position.x += ((best.x - position.x) / radius) * step;
    position.z += ((best.z - position.z) / radius) * step;
    return;
  }
}
