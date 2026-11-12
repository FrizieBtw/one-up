"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { ExtrudeGeometry, MathUtils, Shape, type Group } from "three";
import { GAMES, type GameDefinition } from "@stepup/shared";
import { useNav } from "@/lib/nav";
import { CENTER_ANCHOR, MINI_ANCHOR, anchorRect, cellAnchor } from "./anchors";
import { LABEL_ASPECT, cartridgeArt, createLabelTexture } from "./art";

const WIDTH = 1;
const HEIGHT = 1.25;
const DEPTH = 0.14;
const BEVEL = 0.025;
const FACE_Z = DEPTH / 2 + BEVEL + 0.002;
const INK = "#2a1b4d";

/** Silhouette originale : le coin supérieur droit forme deux marches (« step up »). */
function createBodyGeometry(): ExtrudeGeometry {
  const w = WIDTH / 2 - BEVEL;
  const h = HEIGHT / 2 - BEVEL;
  const shape = new Shape()
    .moveTo(-w, -h)
    .lineTo(w, -h)
    .lineTo(w, h - 0.26)
    .lineTo(w - 0.17, h - 0.26)
    .lineTo(w - 0.17, h - 0.13)
    .lineTo(w - 0.34, h - 0.13)
    .lineTo(w - 0.34, h)
    .lineTo(-w, h)
    .closePath();
  const geometry = new ExtrudeGeometry(shape, { depth: DEPTH, bevelSize: BEVEL, bevelThickness: BEVEL, bevelSegments: 3 });
  geometry.translate(0, 0, -DEPTH / 2);
  return geometry;
}

function Cartridge({ game, index, geometry, reducedMotion }: { game: GameDefinition; index: number; geometry: ExtrudeGeometry; reducedMotion: boolean }) {
  const group = useRef<Group>(null!);
  const motion = useRef({ anchorId: "", travelling: false, placed: false });
  const art = cartridgeArt(game.id);
  const label = useMemo(() => createLabelTexture(game), [game]);
  useEffect(() => () => label.dispose(), [label]);

  useFrame(({ size, viewport, clock }, delta) => {
    const nav = useNav.getState();
    const selected = nav.gameId === game.id;

    // Où doit se trouver cette cartouche dans l'état de navigation courant ?
    let anchorId = cellAnchor(game.id);
    let visible = nav.view === "home";
    let flipped = false;
    if (nav.view !== "home" && selected) {
      visible = true;
      flipped = nav.view === "cartridge" || nav.settingsOpen;
      anchorId = flipped ? CENTER_ANCHOR : MINI_ANCHOR;
    }

    const g = group.current;
    const m = motion.current;
    const rect = anchorRect(anchorId);
    const onCell = anchorId.startsWith("cell:");
    const hovered = onCell && nav.hovered === game.id;

    let x = g.position.x;
    let y = g.position.y;
    let scale = 0;
    if (rect && visible) {
      x = ((rect.left + rect.width / 2) / size.width - 0.5) * viewport.width;
      y = (0.5 - (rect.top + rect.height / 2) / size.height) * viewport.height;
      scale = ((rect.height / size.height) * viewport.height) / HEIGHT;
      if (onCell) scale *= hovered ? 0.98 : 0.9;
    }

    const time = clock.elapsedTime;
    const idle = onCell && !reducedMotion;
    const rotY = flipped ? Math.PI : hovered ? 0.4 : idle ? Math.sin(time * 0.8 + index * 1.7) * 0.08 : 0;
    const rotX = hovered ? -0.12 : 0;
    if (idle && scale > 0) y += Math.sin(time * 1.3 + index) * 0.008 * scale;

    if (anchorId !== m.anchorId) {
      m.anchorId = anchorId;
      m.travelling = m.placed;
    }
    const lambda = reducedMotion ? 1000 : 7;
    if (!m.placed || !m.travelling) {
      // Posée sur son ancre : suit le DOM sans retard (défilement, redimensionnement).
      g.position.set(x, y, 0);
      if (rect) m.placed = true;
    } else {
      g.position.x = MathUtils.damp(g.position.x, x, lambda, delta);
      g.position.y = MathUtils.damp(g.position.y, y, lambda, delta);
      if (Math.hypot(g.position.x - x, g.position.y - y) < 0.002) m.travelling = false;
    }
    g.scale.setScalar(MathUtils.damp(g.scale.x, scale, lambda, delta));
    g.rotation.y = MathUtils.damp(g.rotation.y, rotY, lambda, delta);
    g.rotation.x = MathUtils.damp(g.rotation.x, rotX, lambda, delta);
    g.visible = g.scale.x > 0.001;
  });

  const labelWidth = 0.84;
  return (
    <group ref={group} scale={0}>
      <mesh geometry={geometry}>
        <meshStandardMaterial color={art.body} roughness={0.42} metalness={0.05} />
      </mesh>
      {/* Face avant : étiquette illustrée et stries de préhension */}
      <mesh position={[0, -0.17, FACE_Z]}>
        <planeGeometry args={[labelWidth, labelWidth / LABEL_ASPECT]} />
        <meshBasicMaterial map={label} transparent toneMapped={false} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[-0.2, 0.52 - i * 0.055, FACE_Z]}>
          <planeGeometry args={[0.42, 0.022]} />
          <meshBasicMaterial color={INK} transparent opacity={0.35} />
        </mesh>
      ))}
      {/* Dos : plaque claire qui accueille l'interface (panneau DOM aligné dessus) et vis */}
      <group rotation-y={Math.PI}>
        <mesh position={[0, -0.13, FACE_Z]}>
          <planeGeometry args={[0.88, 0.9]} />
          <meshBasicMaterial color="#fff4dc" toneMapped={false} />
        </mesh>
        {[0, 0.2, 0.4].map((sx) => (
          <mesh key={sx} position={[sx, 0.5, FACE_Z]}>
            <circleGeometry args={[0.03, 16]} />
            <meshBasicMaterial color={INK} transparent opacity={0.45} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** Canvas plein écran, non interactif : les clics passent par les ancres DOM. */
export default function CartridgeScene() {
  const geometry = useMemo(createBodyGeometry, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const reducedMotion = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  return (
    <Canvas
      aria-hidden
      className="!pointer-events-none !fixed inset-0 z-20"
      camera={{ fov: 20, position: [0, 0, 10] }}
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true }}
    >
      <ambientLight intensity={1.6} />
      <directionalLight position={[3, 5, 8]} intensity={2.2} />
      {GAMES.map((game, index) => (
        <Cartridge key={game.id} game={game} index={index} geometry={geometry} reducedMotion={reducedMotion} />
      ))}
    </Canvas>
  );
}
