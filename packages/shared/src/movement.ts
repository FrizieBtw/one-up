import {
  AVATAR_RADIUS,
  LOBBY_SPEED,
  ROOM_BLOCKS,
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
const blocked = (x: number, z: number) =>
  ROOM_BLOCKS.some(
    ([x0, x1, z0, z1]) =>
      x > x0 - AVATAR_RADIUS &&
      x < x1 + AVATAR_RADIUS &&
      z > z0 - AVATAR_RADIUS &&
      z < z1 + AVATAR_RADIUS,
  );

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
): void {
  const step = (run ? RUN_SPEED : LOBBY_SPEED) * seconds;
  const nx = Math.max(-limit, Math.min(limit, position.x + direction.x * step));
  const nz = Math.max(-limit, Math.min(limit, position.z + direction.z * step));
  const free = (x: number, z: number) =>
    !blocked(x, z) && !bumps(x, z, position, others);
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
      if (!blocked(nx, nz)) {
        target.x = nx;
        target.z = nz;
      }
    }
  }
}
