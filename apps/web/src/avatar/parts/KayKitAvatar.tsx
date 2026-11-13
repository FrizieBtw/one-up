"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { AnimationAction, AnimationMixer, MathUtils, type Group, type Material, type Mesh, type Object3D } from "three";
import type { AvatarConfig, AvatarCosmetics } from "@stepup/shared";
import type { AvatarPose } from "../Avatar";
import { assemble } from "./assemble";
import { CLIP_FOR, loadClips } from "./animations";

/** Hauteur d'un personnage KayKit (~2,3) ramenée à celle de l'ancien avatar (~1,1). */
export const KAYKIT_SCALE = 0.48;

/** Assemble le personnage de façon asynchrone ; `null` tant qu'il n'est pas prêt ou en cas d'échec (l'appelant affiche alors un repli). */
export function useAssembledModel(look: AvatarConfig, cosmetics: AvatarCosmetics): Group | null {
  const [model, setModel] = useState<Group | null>(null);
  // Seuls la tenue et l'accessoire des cosmétiques changent les pièces (l'effet n'est pas un modèle).
  const key = JSON.stringify({ look, outfit: cosmetics.outfit, accessory: cosmetics.accessory });
  useEffect(() => {
    let alive = true;
    let built: Group | null = null;
    const { look: config, outfit, accessory } = JSON.parse(key) as { look: AvatarConfig; outfit?: AvatarCosmetics["outfit"]; accessory?: AvatarCosmetics["accessory"] };
    assemble(config, { outfit, accessory })
      .then((m) => {
        if (!alive) return disposeModel(m);
        built = m;
        m.traverse((o: Object3D) => {
          o.frustumCulled = false;
        });
        setModel(m);
        const w = window as unknown as { __kaykitLoaded?: number };
        w.__kaykitLoaded = (w.__kaykitLoaded ?? 0) + 1; // compteur lu par les captures de /dev/avatar-anim
      })
      .catch((e) => {
        console.error("avatar KayKit", e);
        if (alive) setModel(null);
      });
    return () => {
      alive = false;
      setModel(null);
      if (built) disposeModel(built);
    };
  }, [key]);
  return model;
}

/** Libère les matériaux et palettes recolorés propres à ce personnage (les géométries sont partagées par le cache). */
function disposeModel(model: Object3D) {
  model.traverse((o) => {
    const material = (o as Mesh).material as Material | Material[] | undefined;
    for (const m of Array.isArray(material) ? material : material ? [material] : []) {
      (m as { map?: { dispose(): void } | null }).map?.dispose();
      m.dispose();
    }
  });
}

type Base = keyof typeof CLIP_FOR;

/** Corps animé : clips KayKit pour repos, marche, salut et bravo ; rotations d'os pour danse, rire, toupie et révérence. */
export function KayKitBody({ model, pose, faded }: { model: Group; pose: RefObject<AvatarPose>; faded: boolean }) {
  const root = useRef<Group>(null!);
  const mixer = useMemo(() => new AnimationMixer(model), [model]);
  const phase = useMemo(() => Math.random() * 10, []);
  const actions = useRef<Partial<Record<Base, AnimationAction>>>({});
  const current = useRef<Base | null>(null);
  const bones = useMemo(() => {
    const get = (n: string) => model.getObjectByName(n) ?? null;
    return { hips: get("hips"), spine: get("spine"), head: get("head"), armL: get("upperarm.l"), armR: get("upperarm.r") };
  }, [model]);

  useEffect(() => {
    let alive = true;
    loadClips().then((clips) => {
      if (!alive) return;
      for (const base of Object.keys(CLIP_FOR) as Base[]) {
        const clip = clips[CLIP_FOR[base]];
        if (clip) actions.current[base] = mixer.clipAction(clip);
      }
    }).catch((e) => console.error("clips KayKit", e));
    return () => {
      alive = false;
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
    };
  }, [mixer, model]);

  useEffect(() => {
    model.traverse((o) => {
      const m = (o as Mesh).material as Material | undefined;
      if (m) {
        m.transparent = faded;
        m.opacity = faded ? 0.4 : 1;
      }
    });
  }, [model, faded]);

  useFrame(({ clock }, delta) => {
    const { moving, emote } = pose.current;
    const t = clock.elapsedTime + phase;
    const wanted: Base = moving ? "walk" : emote === "wave" ? "wave" : emote === "cheer" ? "cheer" : "idle";
    if (wanted !== current.current) {
      const next = actions.current[wanted];
      if (next) {
        const prev = current.current ? actions.current[current.current] : undefined;
        next.reset().fadeIn(0.2).play();
        prev?.fadeOut(0.2);
        current.current = wanted;
      }
    }
    mixer.update(delta);

    // Emotes sans clip : décalages d'os appliqués après l'animation de repos.
    const rotate = (bone: Object3D | null, x = 0, y = 0, z = 0) => {
      if (bone) bone.rotation.set(bone.rotation.x + x, bone.rotation.y + y, bone.rotation.z + z);
    };
    const k = Math.min(1, delta * 12);
    const spin = emote === "spin" && !moving;
    root.current.rotation.y = spin ? (t * 11) % (Math.PI * 2) : MathUtils.lerp(root.current.rotation.y, 0, k);
    if (moving) return;
    if (emote === "dance") {
      const s = Math.sin(t * 7);
      rotate(bones.hips, 0, Math.sin(t * 3.5) * 0.7, 0);
      rotate(bones.armL, -(1.4 + s * 0.5));
      rotate(bones.armR, -(1.4 + s * 0.5));
      root.current.position.y = Math.abs(s) * 0.06;
    } else {
      root.current.position.y = 0;
      if (emote === "bow") rotate(bones.spine, 0.7);
      else if (emote === "laugh") {
        rotate(bones.head, -0.35 + Math.sin(t * 16) * 0.05);
        rotate(bones.spine, 0, 0, Math.sin(t * 16) * 0.04);
      }
    }
  });

  return (
    <group ref={root} scale={KAYKIT_SCALE}>
      <primitive object={model} />
    </group>
  );
}
