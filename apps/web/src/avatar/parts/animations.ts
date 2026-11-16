import type { AnimationClip } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Animations KayKit : fichiers de rig séparés, appliquées aux os par leur nom (identique dans tous les personnages).
// Pas de danse, de rire, de toupie ni de révérence dans les assets : ces emotes sont complétées par des rotations d'os (KayKitAvatar).

const FILES = [
  "Rig_Medium_General",
  "Rig_Medium_MovementBasic",
  "Rig_Medium_Simulation",
  "Rig_Medium_Special",
];
let clips: Promise<Record<string, AnimationClip>> | null = null;

export function loadClips(): Promise<Record<string, AnimationClip>> {
  // Un fichier de rig illisible ne doit pas priver les autres de leurs clips (sinon plus aucune animation : le personnage reste en T).
  clips ??= Promise.allSettled(
    FILES.map((f) =>
      new GLTFLoader().loadAsync(`/models/kaykit/animations/${f}.glb`),
    ),
  ).then((results) => {
    const byName: Record<string, AnimationClip> = {};
    for (const r of results) {
      if (r.status === "rejected") console.error("animations KayKit", r.reason);
      else for (const clip of r.value.animations) byName[clip.name] = clip;
    }
    return byName;
  });
  return clips;
}

/** Clip de base joué pour chaque état : les emotes sans clip jouent le repos et ajoutent des rotations d'os. */
export const CLIP_FOR = {
  idle: "Idle_B",
  idleA: "Idle_A",
  walk: "Walking_A",
  run: "Running_A",
  jump: "Jump_Full_Short",
  fall: "Jump_Idle",
  death: "Death_A",
  getUp: "Sit_Floor_StandUp",
  interact: "Interact",
  spawn: "Spawn_Ground",
  sitDown: "Sit_Floor_Down",
  sitIdle: "Sit_Floor_Idle",
  standUp: "Sit_Floor_StandUp",
  chairDown: "Sit_Chair_Down",
  chairIdle: "Sit_Chair_Idle",
  chairUp: "Sit_Chair_StandUp",
  wave: "Waving",
  cheer: "Cheering",
} as const;
