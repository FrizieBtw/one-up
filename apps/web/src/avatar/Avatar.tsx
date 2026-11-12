"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { CanvasTexture, MathUtils, SRGBColorSpace, type Group } from "three";
import type { EmoteId } from "@stepup/shared";

// Avatar chibi original, entièrement procédural (sphères et capsules) : un seul composant,
// réutilisé partout (lobby aujourd'hui ; profil, jeux et résultats ensuite).

export interface AvatarLook {
  skin: string;
  hair: string;
  outfit: string;
  hairStyle: 0 | 1 | 2;
  eyeStyle: 0 | 1;
}

const SKINS = ["#ffd9b8", "#f2b98f", "#c98a5e", "#8a5a3c"];
const HAIRS = ["#2a1b4d", "#6b3a1e", "#f2c14e", "#ff5c6c", "#14c4bd", "#f4f0ff"];
const OUTFITS = ["#6c3bf5", "#14c4bd", "#ff8a1f", "#ff5c6c", "#ffd23f", "#3fa7ff"];

/** Apparence par défaut, stable pour une identité donnée (remplacée par l'éditeur d'avatar en phase 6). */
export function lookFromId(id: string): AvatarLook {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  const pick = (n: number) => {
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
    return (hash >>> 0) % n;
  };
  return {
    skin: SKINS[pick(SKINS.length)]!,
    hair: HAIRS[pick(HAIRS.length)]!,
    outfit: OUTFITS[pick(OUTFITS.length)]!,
    hairStyle: pick(3) as AvatarLook["hairStyle"],
    eyeStyle: pick(2) as AvatarLook["eyeStyle"],
  };
}

export interface AvatarPose {
  moving: boolean;
  emote: EmoteId | null;
}

function createNameTexture(name: string): { texture: CanvasTexture; aspect: number } {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = "800 44px system-ui, sans-serif";
  ctx.font = font;
  canvas.width = Math.ceil(ctx.measureText(name).width) + 48;
  canvas.height = 72;
  ctx.font = font;
  ctx.fillStyle = "rgba(42, 27, 77, 0.85)";
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, 36);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name, canvas.width / 2, canvas.height / 2 + 3);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return { texture, aspect: canvas.width / canvas.height };
}

/**
 * `pose` est lu à chaque image (pas de rendu React par image). Le parent positionne et oriente l'avatar.
 */
export function Avatar({ look, name, pose, faded = false }: { look: AvatarLook; name?: string; pose: RefObject<AvatarPose>; faded?: boolean }) {
  const body = useRef<Group>(null!);
  const head = useRef<Group>(null!);
  const armL = useRef<Group>(null!);
  const armR = useRef<Group>(null!);
  const footL = useRef<Group>(null!);
  const footR = useRef<Group>(null!);
  const phase = useMemo(() => Math.random() * 10, []);

  const label = useMemo(() => (name ? createNameTexture(name) : null), [name]);
  useEffect(() => () => label?.texture.dispose(), [label]);

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime + phase;
    const { moving, emote } = pose.current;
    const k = Math.min(1, delta * 12);
    const to = (object: Group, axis: "x" | "y" | "z", value: number) => {
      object.rotation[axis] = MathUtils.lerp(object.rotation[axis], value, k);
    };

    // Cibles par défaut : repos, légère respiration.
    let bodyY = Math.sin(t * 2) * 0.012;
    let bodyRotY = 0;
    let bodyRotZ = 0;
    let headRotX = 0;
    let armLz = 0.25;
    let armRz = -0.25;
    let armLx = 0;
    let armRx = 0;
    let footLz = 0;
    let footRz = 0;
    let footLy = 0;
    let footRy = 0;

    if (moving) {
      const step = Math.sin(t * 13);
      bodyY = Math.abs(step) * 0.035;
      footLz = step * 0.09;
      footRz = -step * 0.09;
      footLy = Math.max(0, step) * 0.05;
      footRy = Math.max(0, -step) * 0.05;
      armLx = -step * 0.7;
      armRx = step * 0.7;
    } else if (emote === "wave") {
      armRz = -2.5 + Math.sin(t * 10) * 0.35;
      bodyRotZ = 0.06;
    } else if (emote === "dance") {
      bodyY = Math.abs(Math.sin(t * 7)) * 0.07;
      bodyRotY = Math.sin(t * 3.5) * 0.9;
      armLz = 1.4 + Math.sin(t * 7) * 0.6;
      armRz = -1.4 + Math.sin(t * 7) * 0.6;
      footLy = Math.max(0, Math.sin(t * 7)) * 0.05;
      footRy = Math.max(0, -Math.sin(t * 7)) * 0.05;
    } else if (emote === "cheer") {
      bodyY = Math.abs(Math.sin(t * 6)) * 0.22;
      armLz = 2.6;
      armRz = -2.6;
      footLy = footRy = bodyY;
    } else if (emote === "laugh") {
      bodyY = Math.abs(Math.sin(t * 16)) * 0.025;
      headRotX = -0.35;
      bodyRotZ = Math.sin(t * 16) * 0.04;
    }

    body.current.position.y = MathUtils.lerp(body.current.position.y, bodyY, k);
    to(body.current, "y", bodyRotY);
    to(body.current, "z", bodyRotZ);
    to(head.current, "x", headRotX);
    to(armL.current, "z", armLz);
    to(armR.current, "z", armRz);
    to(armL.current, "x", armLx);
    to(armR.current, "x", armRx);
    footL.current.position.set(-0.09, 0.06 + footLy, footLz);
    footR.current.position.set(0.09, 0.06 + footRy, footRz);
  });

  const opacity = faded ? 0.4 : 1;
  const material = (color: string) => <meshStandardMaterial color={color} roughness={0.6} transparent={faded} opacity={opacity} />;
  const eyeHeight = look.eyeStyle === 0 ? 1 : 1.6;

  return (
    <group>
      {/* Ombre de contact */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.01}>
        <circleGeometry args={[0.24, 24]} />
        <meshBasicMaterial color="#2a1b4d" transparent opacity={0.22 * opacity} />
      </mesh>

      <group ref={footL}>
        <mesh scale={[1, 0.6, 1.35]}>
          <sphereGeometry args={[0.08, 16, 12]} />
          {material("#2a1b4d")}
        </mesh>
      </group>
      <group ref={footR}>
        <mesh scale={[1, 0.6, 1.35]}>
          <sphereGeometry args={[0.08, 16, 12]} />
          {material("#2a1b4d")}
        </mesh>
      </group>

      <group ref={body}>
        <mesh position-y={0.34}>
          <capsuleGeometry args={[0.17, 0.14, 6, 16]} />
          {material(look.outfit)}
        </mesh>

        {/* Bras : pivot à l'épaule, membre pendant vers le bas */}
        <group ref={armL} position={[-0.19, 0.46, 0]}>
          <mesh position-y={-0.1}>
            <capsuleGeometry args={[0.05, 0.12, 4, 10]} />
            {material(look.skin)}
          </mesh>
        </group>
        <group ref={armR} position={[0.19, 0.46, 0]}>
          <mesh position-y={-0.1}>
            <capsuleGeometry args={[0.05, 0.12, 4, 10]} />
            {material(look.skin)}
          </mesh>
        </group>

        <group ref={head} position-y={0.8}>
          <mesh scale={[1, 0.94, 0.96]}>
            <sphereGeometry args={[0.28, 28, 20]} />
            {material(look.skin)}
          </mesh>
          {/* Cheveux : calotte, plus mèche ou couettes selon le style */}
          <mesh position-y={0.03} rotation-x={-0.25}>
            <sphereGeometry args={[0.295, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.52]} />
            {material(look.hair)}
          </mesh>
          {look.hairStyle === 1 && (
            <mesh position={[0, 0.3, 0.02]}>
              <sphereGeometry args={[0.09, 14, 10]} />
              {material(look.hair)}
            </mesh>
          )}
          {look.hairStyle === 2 &&
            [-1, 1].map((side) => (
              <mesh key={side} position={[side * 0.3, 0.1, -0.02]}>
                <sphereGeometry args={[0.11, 14, 10]} />
                {material(look.hair)}
              </mesh>
            ))}
          {[-1, 1].map((side) => (
            <group key={side}>
              <mesh position={[side * 0.1, -0.02, 0.25]} scale={[1, eyeHeight, 0.5]}>
                <sphereGeometry args={[0.036, 12, 10]} />
                <meshBasicMaterial color="#2a1b4d" transparent={faded} opacity={opacity} />
              </mesh>
              <mesh position={[side * 0.17, -0.09, 0.225]} scale={[1, 0.6, 0.3]}>
                <sphereGeometry args={[0.045, 12, 8]} />
                <meshBasicMaterial color="#ff8fa0" transparent opacity={0.6 * opacity} />
              </mesh>
            </group>
          ))}
        </group>
      </group>

      {label && (
        <sprite position-y={1.32} scale={[0.26 * label.aspect, 0.26, 1]}>
          <spriteMaterial map={label.texture} transparent opacity={opacity} depthTest={false} toneMapped={false} />
        </sprite>
      )}
    </group>
  );
}
