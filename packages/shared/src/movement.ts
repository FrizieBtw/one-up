import { LOBBY_RADIUS, LOBBY_SPEED } from "./config";

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

/**
 * Avance une position dans la salle de lobby. Même fonction côté serveur (autorité)
 * et côté client (prédiction locale), pour que les deux simulations concordent.
 */
export function stepLobbyPosition(position: Vec2, direction: Vec2, seconds: number): void {
  position.x += direction.x * LOBBY_SPEED * seconds;
  position.z += direction.z * LOBBY_SPEED * seconds;
  const distance = Math.hypot(position.x, position.z);
  if (distance > LOBBY_RADIUS) {
    position.x *= LOBBY_RADIUS / distance;
    position.z *= LOBBY_RADIUS / distance;
  }
}
