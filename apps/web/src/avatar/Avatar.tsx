"use client";

import { useEffect, useMemo, type RefObject } from "react";
import { CanvasTexture, SRGBColorSpace } from "three";
import { avatarFromSeed, type AvatarConfig, type AvatarCosmetics, type EmoteId } from "@stepup/shared";
import { KayKitBody, useAssembledModel } from "./parts/KayKitAvatar";

// Avatar de joueur : personnage KayKit assemblé (voir ./parts), un seul composant réutilisé partout (salon, jeux, profil).

/** Apparence d'un avatar : la même forme que la configuration enregistrée (`AvatarConfig`). */
export type AvatarLook = AvatarConfig;

/** Apparence par défaut, stable pour une identité donnée : invités et comptes sans avatar personnalisé. */
export const lookFromId = avatarFromSeed;

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
/**
 * Personnage KayKit assemblé (pièces, animations). Pendant le chargement du modèle, seuls l'ombre et le nom sont dessinés.
 * `pose` est lu à chaque image (pas de rendu React par image). Le parent positionne et oriente l'avatar.
 */
export function Avatar({
  look,
  name,
  pose,
  faded = false,
  cosmetics = {},
}: {
  look: AvatarLook;
  name?: string;
  pose: RefObject<AvatarPose>;
  faded?: boolean;
  /** Objets de boutique équipés : tenue, casquette, lunettes. Purement visuels. */
  cosmetics?: AvatarCosmetics;
}) {
  const model = useAssembledModel(look, cosmetics);
  const label = useMemo(() => (name ? createNameTexture(name) : null), [name]);
  useEffect(() => () => label?.texture.dispose(), [label]);

  const opacity = faded ? 0.4 : 1;

  return (
    <group>
      {/* Ombre de contact */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.01}>
        <circleGeometry args={[0.24, 24]} />
        <meshBasicMaterial color="#2a1b4d" transparent opacity={0.22 * opacity} />
      </mesh>

      {model && <KayKitBody model={model} pose={pose} faded={faded} />}

      {label && (
        <sprite position-y={1.32} scale={[0.26 * label.aspect, 0.26, 1]}>
          <spriteMaterial map={label.texture} transparent opacity={opacity} depthTest={false} toneMapped={false} />
        </sprite>
      )}
    </group>
  );
}
