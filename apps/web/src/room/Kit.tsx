"use client";

import { useLoader } from "@react-three/fiber";
import { useMemo } from "react";
import { BackSide, MeshBasicMaterial, type Mesh, type Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KAYKIT_SCALE } from "@/avatar/parts/KayKitAvatar";

export type Vec3 = [number, number, number];

export const FURNITURE = "/models/kaykit/furniture/";
const OUTLINE = new MeshBasicMaterial({ color: "#0f0d22", side: BackSide });
/** Contour blanc du meuble avec lequel on peut interagir (infobulle affichée). */
const OUTLINE_LIT = new MeshBasicMaterial({ color: "#ffffff", side: BackSide });

/** Un meuble KayKit : modèle + contour (copie agrandie dont on ne voit que l'envers). L'origine des modèles est au pied, au centre. */
export function Kit({
  file,
  dir = FURNITURE,
  position,
  rotation = 0,
  scale = KAYKIT_SCALE,
  lit = false,
  litScale = 1.07,
}: {
  file: string;
  /** Dossier du modèle (meubles de la chambre par défaut). */
  dir?: string;
  position: Vec3;
  rotation?: number;
  scale?: number;
  lit?: boolean;
  /** Épaisseur du contour blanc (1 = pas de contour). */
  litScale?: number;
}) {
  const gltf = useLoader(GLTFLoader, `${dir}${file}.gltf`);
  const { body, hull } = useMemo(() => {
    const body = gltf.scene.clone(true);
    const hull = body.clone(true);
    hull.traverse((o: Object3D) => {
      if ((o as Mesh).isMesh)
        (o as Mesh).material = lit ? OUTLINE_LIT : OUTLINE;
    });
    return { body, hull };
  }, [gltf, lit]);
  return (
    <group position={position} rotation-y={rotation} scale={scale}>
      <primitive object={body} />
      <group scale={lit ? litScale : 1.05}>
        <primitive object={hull} />
      </group>
    </group>
  );
}
