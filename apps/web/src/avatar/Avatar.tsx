"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { CanvasTexture, SRGBColorSpace, type Sprite } from "three";
import {
  avatarFromSeed,
  type AvatarConfig,
  type AvatarCosmetics,
  type EmoteId,
} from "@stepup/shared";
import { KayKitBody, useAssembledModel } from "./parts/KayKitAvatar";

// Avatar de joueur : personnage KayKit assemblé (voir ./parts), un seul composant réutilisé partout (salon, jeux, profil).

/** Apparence d'un avatar : la même forme que la configuration enregistrée (`AvatarConfig`). */
export type AvatarLook = AvatarConfig;

/** Apparence par défaut, stable pour une identité donnée : invités et comptes sans avatar personnalisé. */
export const lookFromId = avatarFromSeed;

export interface AvatarPose {
  moving: boolean;
  emote: EmoteId | null;
  /** Vitesse réelle de déplacement (unités/s) : cadence les pas du clip de marche pour que les pieds ne patinent pas. */
  speed?: number;
  /** Course (Maj) : joue le clip de course au lieu de la marche. */
  running?: boolean;
  /** Saut en cours (clip joué une fois). */
  jumping?: boolean;
  /** Geste d'interaction (console, miroir) : clip joué une fois. */
  interacting?: boolean;
  /** Arrivée dans la chambre : le personnage sort du sol (clip joué une fois, ~3,6 s). */
  spawning?: boolean;
  /** Hauteur dont le corps est soulevé (saut) : le nom la suit. */
  lift?: number;
  /** Posture d'attente au sol (renseignée par le corps) : le joueur ne marche pas tant qu'il n'est pas debout. */
  seat?: "none" | "down" | "idle" | "up";
  /** Le joueur veut bouger (touches enfoncées), même si l'avatar est bloqué : il se relève. */
  wantsMove?: boolean;
  /** Aperçu : reste toujours en repos (ni autre repos aléatoire, ni assis). */
  calm?: boolean;
  /** Pose figée (portrait) : le clip de repos est posé une fois, sans s'animer. */
  frozen?: boolean;
  /** Joueur distant : posture assise décidée par son propre client (`undefined` pour le joueur local, qui décide seul). */
  forceSeat?: boolean;
}

function createNameTexture(name: string): {
  texture: CanvasTexture;
  aspect: number;
} {
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
/**
 * Personnage KayKit assemblé (pièces, animations). Pendant le chargement du modèle, seuls l'ombre et le nom sont dessinés.
 * `pose` est lu à chaque image (pas de rendu React par image). Le parent positionne et oriente l'avatar.
 */
export function Avatar({
  look,
  name,
  pose,
  faded = false,
  clipY,
  cosmetics = {},
}: {
  look: AvatarLook;
  name?: string;
  pose: RefObject<AvatarPose>;
  faded?: boolean;
  /** Hauteur (monde) sous laquelle le corps n'est pas dessiné : le sol d'une scène. */
  clipY?: number;
  /** Objets de boutique équipés : tenue, casquette, lunettes. Purement visuels. */
  cosmetics?: AvatarCosmetics;
}) {
  const model = useAssembledModel(look, cosmetics);
  const label = useMemo(() => (name ? createNameTexture(name) : null), [name]);
  // Le nom suit le saut du personnage.
  const nameSprite = useRef<Sprite>(null);
  useFrame(() => {
    if (nameSprite.current) nameSprite.current.position.y = 1.32 + (pose.current?.lift ?? 0);
  });
  useEffect(() => () => label?.texture.dispose(), [label]);

  const opacity = faded ? 0.4 : 1;

  return (
    <group>
      {/* Ombre de contact */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.01}>
        <circleGeometry args={[0.24, 24]} />
        <meshBasicMaterial
          color="#2a1b4d"
          transparent
          opacity={0.22 * opacity}
        />
      </mesh>

      {model && (
        <KayKitBody model={model} pose={pose} faded={faded} clipY={clipY} />
      )}

      {label && (
        <sprite ref={nameSprite} position-y={1.32} scale={[0.26 * label.aspect, 0.26, 1]}>
          <spriteMaterial
            map={label.texture}
            transparent
            opacity={opacity}
            depthTest={false}
            toneMapped={false}
          />
        </sprite>
      )}
    </group>
  );
}
