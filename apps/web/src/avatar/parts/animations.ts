import type { AnimationClip } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Animations KayKit : fichiers de rig séparés, appliquées aux os par leur nom (identique dans tous les personnages).
// Pas de danse, de rire, de toupie ni de révérence dans les assets : ces emotes sont complétées par des rotations d'os (KayKitAvatar).

const FILES = ["Rig_Medium_General", "Rig_Medium_MovementBasic", "Rig_Medium_Simulation"];
let clips: Promise<Record<string, AnimationClip>> | null = null;

export function loadClips(): Promise<Record<string, AnimationClip>> {
  clips ??= Promise.all(FILES.map((f) => new GLTFLoader().loadAsync(`/models/kaykit/animations/${f}.glb`))).then((gltfs) => {
    const byName: Record<string, AnimationClip> = {};
    for (const g of gltfs) for (const clip of g.animations) byName[clip.name] = clip;
    return byName;
  });
  return clips;
}

/** Clip de base joué pour chaque état : les emotes sans clip jouent le repos et ajoutent des rotations d'os. */
export const CLIP_FOR = {
  idle: "Idle_A",
  walk: "Walking_A",
  wave: "Waving",
  cheer: "Cheering",
} as const;
