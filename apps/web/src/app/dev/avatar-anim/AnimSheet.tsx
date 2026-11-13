"use client";

import { Canvas } from "@react-three/fiber";
import { useRef } from "react";
import type { EmoteId } from "@stepup/shared";
import { Avatar, lookFromId, type AvatarPose } from "@/avatar/Avatar";

const STATES: { label: string; moving: boolean; emote: EmoteId | null }[] = [
  { label: "repos", moving: false, emote: null },
  { label: "marche", moving: true, emote: null },
  { label: "salut", moving: false, emote: "wave" },
  { label: "bravo", moving: false, emote: "cheer" },
  { label: "danse", moving: false, emote: "dance" },
  { label: "rire", moving: false, emote: "laugh" },
  { label: "toupie", moving: false, emote: "spin" },
  { label: "révérence", moving: false, emote: "bow" },
];

function One({ index }: { index: number }) {
  const s = STATES[index]!;
  const pose = useRef<AvatarPose>({ moving: s.moving, emote: s.emote });
  return (
    <group position={[(index - 3.5) * 1.1, 0, 0]}>
      <Avatar look={lookFromId(`anim-${index}`)} name={s.label} pose={pose} />
    </group>
  );
}

export function AnimSheet() {
  return (
    <main style={{ width: "100vw", height: "100vh" }}>
      <Canvas camera={{ position: [0, 0.9, 6], fov: 35 }} gl={{ preserveDrawingBuffer: true }}>
        <color attach="background" args={["#fff4dc"]} />
        <hemisphereLight args={["#ffffff", "#c8b89a", 2.2]} />
        <directionalLight position={[2, 3, 5]} intensity={2.2} />
        {STATES.map((_, i) => (
          <One key={i} index={i} />
        ))}
      </Canvas>
    </main>
  );
}
