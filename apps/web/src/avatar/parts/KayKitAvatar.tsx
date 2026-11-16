"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  AnimationAction,
  AnimationMixer,
  LoopOnce,
  MathUtils,
  Plane,
  Vector3,
  type Group,
  type Material,
  type Mesh,
  type Object3D,
} from "three";
import type { AvatarConfig, AvatarCosmetics } from "@stepup/shared";
import type { AvatarPose } from "../Avatar";
import { assemble } from "./assemble";
import { CLIP_FOR, loadClips } from "./animations";

/** Hauteur d'un personnage KayKit (~2,3) ramenée à celle de l'ancien avatar (~1,1). */
export const KAYKIT_SCALE = 0.48;
/** Vitesse (unités/s) à laquelle le clip Walking_A, à cadence normale, ne fait pas patiner un personnage à cette échelle. */
const WALK_CLIP_SPEED = 0.9;
/** Hauteur (unités monde) et durée du saut. */
const JUMP_HEIGHT = 0.75;
const JUMP_SECONDS = 0.65;
/** Immobile depuis ce temps (secondes) : le personnage s'assoit. */
const SIT_AFTER_SECONDS = 20;
/** Idem pour Running_A : ~2,4 fois la marche (course de pied mesurée sur les deux clips). */
const CLIP_SPEED = { walk: WALK_CLIP_SPEED, run: WALK_CLIP_SPEED * 2.4 };

/** Assemble le personnage de façon asynchrone ; `null` tant qu'il n'est pas prêt ou en cas d'échec (l'appelant affiche alors un repli). */
export function useAssembledModel(
  look: AvatarConfig,
  cosmetics: AvatarCosmetics,
): Group | null {
  const [model, setModel] = useState<Group | null>(null);
  // Seuls la tenue et l'accessoire des cosmétiques changent les pièces (l'effet n'est pas un modèle).
  const key = JSON.stringify({
    look,
    outfit: cosmetics.outfit,
    accessory: cosmetics.accessory,
  });
  useEffect(() => {
    let alive = true;
    let built: Group | null = null;
    const {
      look: config,
      outfit,
      accessory,
    } = JSON.parse(key) as {
      look: AvatarConfig;
      outfit?: AvatarCosmetics["outfit"];
      accessory?: AvatarCosmetics["accessory"];
    };
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
    for (const m of Array.isArray(material)
      ? material
      : material
        ? [material]
        : []) {
      (m as { map?: { dispose(): void } | null }).map?.dispose();
      m.dispose();
    }
  });
}

type Base = keyof typeof CLIP_FOR;
/** Durée du balayage de bras du croupier quand il distribue (s). */
const CARD_GESTURE_SECONDS = 0.8;

/** Corps animé : clips KayKit pour repos, marche, salut et bravo ; rotations d'os pour rire, toupie et révérence. */
export function KayKitBody({
  model,
  pose,
  faded,
  clipY,
}: {
  model: Group;
  pose: RefObject<AvatarPose>;
  faded: boolean;
  clipY?: number;
}) {
  const root = useRef<Group>(null!);
  const mixer = useMemo(() => new AnimationMixer(model), [model]);
  const phase = useMemo(() => Math.random() * 10, []);
  const actions = useRef<Partial<Record<Base, AnimationAction>>>({});
  const current = useRef<Base | null>(null);
  const jumpTime = useRef(0);
  // Immobile longtemps : le personnage s'assoit par terre (descente, attente), puis se relève dès qu'il fait quelque chose.
  const still = useRef(0);
  const born = useRef<number>(-1);
  const cardTick = useRef<number | undefined>(undefined);
  const cardTime = useRef(0);
  const handPos = useRef(new Vector3());
  const seat = useRef<{ state: "none" | "down" | "idle" | "up"; t: number }>({
    state: "none",
    t: 0,
  });
  const bones = useMemo(() => {
    const get = (n: string) => model.getObjectByName(n) ?? null;
    return {
      hips: get("hips"),
      spine: get("spine"),
      head: get("head"),
      // Le modèle assemblé (parties) perd les points des noms d'os : « upperarml » au lieu de « upperarm.l ».
      armL: get("upperarm.l") ?? get("upperarml"),
      armR: get("upperarm.r") ?? get("upperarmr"),
      handL: get("handslot.l") ?? get("handslotl"),
    };
  }, [model]);

  useEffect(() => {
    // Nouveau modèle (changement de tête, de tenue…) : repartir de zéro, sans quoi l'ancien état empêche de rejouer un clip.
    actions.current = {};
    current.current = null;
    let alive = true;
    loadClips()
      .then((clips) => {
        if (!alive) return;
        for (const base of Object.keys(CLIP_FOR) as Base[]) {
          const clip = clips[CLIP_FOR[base]];
          if (!clip) continue;
          const action = mixer.clipAction(clip);
          if (
            base === "jump" ||
            base === "death" ||
            base === "getUp" ||
            base === "interact" ||
            base === "spawn" ||
            base === "sitDown" ||
            base === "chairDown" ||
            base === "chairUp" ||
            base === "standUp"
          ) {
            action.setLoop(LoopOnce, 1); // ces gestes ne se répètent pas
            action.clampWhenFinished = true;
          }
          actions.current[base] = action;
        }
      })
      .catch((e) => console.error("clips KayKit", e));
    return () => {
      alive = false;
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
    };
  }, [mixer, model]);

  // Rien sous le sol : pendant l'arrivée, la partie du corps sous `clipY` est coupée (la scène active le découpage local).
  useEffect(() => {
    const planes =
      clipY === undefined ? null : [new Plane(new Vector3(0, 1, 0), -clipY)];
    model.traverse((o) => {
      const m = (o as Mesh).material as Material | undefined;
      if (m) {
        m.clippingPlanes = planes;
        m.needsUpdate = true;
      }
    });
  }, [model, clipY]);

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
    if (born.current < 0) born.current = clock.elapsedTime;
    const t = clock.elapsedTime + phase;
    const busy =
      moving ||
      Boolean(pose.current.wantsMove) ||
      Boolean(emote) ||
      Boolean(
        pose.current.jumping ||
        pose.current.interacting ||
        pose.current.spawning,
      );
    const sit = seat.current;
    if (pose.current.forceSeat !== undefined) {
      // Joueur distant : on suit sa posture. Arrivé déjà assis, il est directement assis (pas de descente rejouée).
      const wantSit = pose.current.forceSeat;
      // Compteur d'immobilité remis à zéro : sinon, à la fin du relevé, l'avatar se rassoit aussitôt par terre (« immobile depuis
      // longtemps »), puis se relève dès qu'on bouge : animations en conflit.
      still.current = 0;
      if (wantSit && (sit.state === "none" || sit.state === "up"))
        Object.assign(sit, {
          state: clock.elapsedTime - born.current < 0.4 ? "idle" : "down",
          t: 0,
        });
      else if (!wantSit && (sit.state === "down" || sit.state === "idle"))
        Object.assign(sit, { state: "up", t: 0 });
    } else if (busy) {
      still.current = 0;
      if (sit.state === "down" || sit.state === "idle")
        Object.assign(sit, { state: "up", t: 0 });
    } else still.current += delta;
    if (
      pose.current.forceSeat === undefined &&
      !pose.current.calm &&
      sit.state === "none" &&
      still.current > SIT_AFTER_SECONDS
    )
      Object.assign(sit, { state: "down", t: 0 });
    if (sit.state !== "none") {
      sit.t += delta;
      if (
        sit.state === "down" &&
        sit.t >=
          (actions.current[
            pose.current.chair ? "chairDown" : "sitDown"
          ]?.getClip().duration ?? 1)
      )
        Object.assign(sit, { state: "idle", t: 0 });
      else if (
        sit.state === "up" &&
        sit.t >=
          (actions.current[
            pose.current.chair ? "chairUp" : "standUp"
          ]?.getClip().duration ?? 1)
      )
        Object.assign(sit, { state: "none", t: 0 });
    }
    pose.current.seat = sit.state;
    const wanted: Base = pose.current.spawning
      ? "spawn"
      : pose.current.fall
        ? "fall"
        : pose.current.death
          ? "death"
          : pose.current.getUp
            ? "getUp"
            : sit.state === "down"
              ? pose.current.chair
                ? "chairDown"
                : "sitDown"
              : sit.state === "idle"
                ? pose.current.chair
                  ? "chairIdle"
                  : "sitIdle"
                : sit.state === "up"
                  ? pose.current.chair
                    ? "chairUp"
                    : "standUp"
                  : pose.current.jumping
                    ? "jump"
                    : pose.current.interacting
                      ? "interact"
                      : moving
                        ? pose.current.running
                          ? "run"
                          : "walk"
                        : emote === "wave"
                          ? "wave"
                          : emote === "cheer"
                            ? "cheer"
                            : "idleA";
    // Geste de distribution (croupier) : pas de clip, un balayage de bras ajouté au repos (voir plus bas). Chronométré depuis le dernier cardTick.
    if (pose.current.cardTick !== cardTick.current) {
      cardTick.current = pose.current.cardTick;
      cardTime.current = 0;
    }
    cardTime.current += delta;
    if (wanted !== current.current) {
      const next = actions.current[wanted];
      if (next) {
        const prev = current.current
          ? actions.current[current.current]
          : undefined;
        // Sortie du sol (ou premier clip d'un modèle) : pas de fondu depuis la pose de base, sinon T-pose ou chute visibles.
        if (wanted === "spawn" || !prev) {
          prev?.stop();
          next.reset().play();
        } else {
          next.reset().fadeIn(0.2).play();
          prev?.fadeOut(0.2);
        }
        current.current = wanted;
      }
    }
    // Le clip de marche est calé sur ~WALK_CLIP_SPEED unités/s : au-delà, on accélère les pas plutôt que de laisser glisser les pieds.
    for (const gait of ["walk", "run"] as const) {
      const action = actions.current[gait];
      if (action)
        action.timeScale =
          moving && gait === wanted && pose.current.speed
            ? pose.current.speed / CLIP_SPEED[gait]
            : 1;
    }
    mixer.update(pose.current.frozen ? 0 : delta);
    // Tant que le clip d'arrivée n'est pas chargé, on ne montre pas le personnage debout (il apparaîtrait avant de sortir du sol).
    root.current.visible =
      current.current !== null &&
      !(pose.current.spawning && !actions.current.spawn); // caché tant qu'aucun clip ne joue (sinon : T-pose)

    // Emotes sans clip : décalages d'os appliqués après l'animation de repos.
    const rotate = (bone: Object3D | null, x = 0, y = 0, z = 0) => {
      if (bone)
        bone.rotation.set(
          bone.rotation.x + x,
          bone.rotation.y + y,
          bone.rotation.z + z,
        );
    };
    // Saut : en plus du clip, le personnage s'élève (arc de sinus sur la durée du saut).
    jumpTime.current = pose.current.jumping ? jumpTime.current + delta : 0;
    // La hauteur vient de la simulation (saut sur les meubles) quand le parent la gère ; sinon courbe d'animation seule.
    const lift = pose.current.physics
      ? 0
      : Math.sin(Math.min(1, jumpTime.current / JUMP_SECONDS) * Math.PI) *
        JUMP_HEIGHT;
    root.current.position.y = lift;
    pose.current.lift = lift;
    const k = Math.min(1, delta * 12);
    const spin = emote === "spin" && !moving;
    root.current.rotation.y = spin
      ? (t * 11) % (Math.PI * 2)
      : MathUtils.lerp(root.current.rotation.y, 0, k);
    if (moving) return;
    if (pose.current.cardAction) {
      // Le croupier distribue : la main gauche se lève vers le sabot (la carte y apparaît), puis part vers la cible et revient.
      // Trois temps : le bras part de côté vers le sabot (prise), pivote vers l'avant (le lancer, la carte part à la fin), revient.
      const s = cardTime.current;
      const reach = MathUtils.smoothstep(s, 0, 0.2);
      const swing = MathUtils.smoothstep(s, 0.2, 0.4);
      const back = 1 - MathUtils.smoothstep(s, 0.55, CARD_GESTURE_SECONDS);
      // La main reste au-dessus de la table : le bras est toujours levé vers l'avant (jamais pendant ni dans le dos).
      rotate(
        bones.armL,
        -(1.8 * reach + 0.1 * swing) * back,
        0,
        -0.6 * reach * (1 - swing) * back,
      );
      rotate(bones.spine, 0.35 * reach * back); // se penche un peu vers la table
    }
    // Position de la main gauche (monde) : la carte distribuée y est tenue avant de partir.
    if (bones.handL) {
      model.updateWorldMatrix(true, true);
      bones.handL.getWorldPosition(handPos.current);
      pose.current.handWorld = {
        x: handPos.current.x,
        y: handPos.current.y,
        z: handPos.current.z,
      };
    }
    if (emote === "bow") rotate(bones.spine, 0.7);
    else if (emote === "laugh") {
      rotate(bones.head, -0.35 + Math.sin(t * 16) * 0.05);
      rotate(bones.spine, 0, 0, Math.sin(t * 16) * 0.04);
    }
  });

  return (
    <group ref={root} scale={KAYKIT_SCALE}>
      <primitive object={model} />
    </group>
  );
}
