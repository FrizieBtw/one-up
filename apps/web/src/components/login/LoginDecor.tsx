"use client";

import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useMemo, useRef } from "react";
import { BackSide, Box3, MeshBasicMaterial, Vector3, type Group, type Mesh, type Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Décor 3D de l'écran de connexion : vrais modèles KayKit (Board Game Bits, CC0) qui flottent doucement, sans parallaxe.
// Contour épais façon dessin : une copie du modèle, agrandie, dont on ne voit que l'envers.
const OUTLINE = new MeshBasicMaterial({ color: "#0f0d22", side: BackSide });
const DIR = "/models/kaykit/props/";

interface Prop {
  file: string;
  /** Position normalisée dans la fenêtre : -1 à 1 sur chaque axe. */
  at: [number, number];
  /** Plus grande dimension du modèle, en unités de scène (1 unité = 90 px). */
  size: number;
  speed: number;
  phase: number;
}

// Répartis sur tout l'écran, en évitant le centre occupé par la carte : coins, bords, et rangées intermédiaires.
const PROPS: Prop[] = [
  { file: "D6_A_red", at: [-0.88, 0.84], size: 0.7, speed: 0.7, phase: 0.4 },
  { file: "coin_gold", at: [0.84, 0.9], size: 0.62, speed: 1.1, phase: 2.1 },
  { file: "card_spades_ace", at: [-0.6, 0.38], size: 0.95, speed: 0.6, phase: 3.3 },
  { file: "D20_blue", at: [0.68, 0.42], size: 0.72, speed: 0.9, phase: 5 },
  { file: "pawn_A_blue", at: [-0.9, -0.3], size: 0.8, speed: 0.8, phase: 1.2 },
  { file: "meeple_yellow", at: [0.92, -0.18], size: 0.72, speed: 0.7, phase: 4.1 },
  { file: "D4_yellow", at: [-0.28, 0.93], size: 0.5, speed: 1, phase: 2.7 },
  { file: "chip_A_green", at: [0.34, -0.94], size: 0.56, speed: 0.8, phase: 0.9 },
  { file: "coin_gold", at: [-0.66, -0.8], size: 0.44, speed: 0.9, phase: 3.9 },
  { file: "D4_yellow", at: [0.62, -0.62], size: 0.42, speed: 1.2, phase: 1.7 },
  { file: "D6_A_red", at: [0.3, 0.9], size: 0.4, speed: 0.8, phase: 4.6 },
  { file: "chip_A_green", at: [-0.94, 0.4], size: 0.46, speed: 1, phase: 5.5 },
];

function FloatingProp({ prop, still }: { prop: Prop; still: boolean }) {
  const group = useRef<Group>(null!);
  const viewport = useThree((s) => s.viewport);
  const gltf = useLoader(GLTFLoader, `${DIR}${prop.file}.gltf`);

  // Modèle centré à l'origine et mis à l'échelle ; le contour est une copie dont tous les matériaux sont l'envers noir.
  const { body, hull, scale } = useMemo(() => {
    const body = gltf.scene.clone(true);
    const box = new Box3().setFromObject(body);
    const size = box.getSize(new Vector3());
    body.position.sub(box.getCenter(new Vector3()));
    const hull = body.clone(true);
    hull.traverse((o: Object3D) => {
      if ((o as Mesh).isMesh) (o as Mesh).material = OUTLINE;
    });
    return { body, hull, scale: prop.size / Math.max(size.x, size.y, size.z) };
  }, [gltf, prop.size]);

  useFrame(({ clock }) => {
    const t = still ? 0 : clock.elapsedTime;
    const g = group.current;
    g.position.set((prop.at[0] * viewport.width) / 2, (prop.at[1] * viewport.height) / 2 + Math.sin(t * prop.speed + prop.phase) * 0.08, 0);
    g.rotation.set(0.5 + Math.sin(t * 0.5 + prop.phase) * 0.25, t * prop.speed * 0.7 + prop.phase, 0);
  });

  return (
    <group ref={group} scale={scale}>
      <primitive object={body} />
      <group scale={1.06}>
        <primitive object={hull} />
      </group>
    </group>
  );
}

export default function LoginDecor() {
  const still = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return (
    // Mouvement réduit : une seule image fixe, pas de rendu continu.
    <Canvas orthographic frameloop={still ? "demand" : "always"} camera={{ zoom: 90, position: [0, 0, 10] }} dpr={[1, 2]} aria-hidden className="!absolute inset-0">
      <ambientLight intensity={1.1} />
      <directionalLight position={[-1, 2, 3]} intensity={1.4} />
      <Suspense fallback={null}>
        {PROPS.map((p, i) => (
          <FloatingProp key={i} prop={p} still={still} />
        ))}
      </Suspense>
    </Canvas>
  );
}
