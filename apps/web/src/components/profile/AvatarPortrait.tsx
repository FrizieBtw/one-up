"use client";

import { Canvas } from "@react-three/fiber";
import { useRef } from "react";
import type { AvatarConfig } from "@stepup/shared";
import { Avatar, type AvatarPose } from "@/avatar/Avatar";
import { useEquippedCosmetics } from "@/lib/economy";

/** Portrait fixe : tête et haut du buste, sans animation ni rotation (pastille de profil). */
export function AvatarPortrait({
  config,
  className = "",
}: {
  config: AvatarConfig;
  className?: string;
}) {
  const equipped = useEquippedCosmetics();
  const pose = useRef<AvatarPose>({
    moving: false,
    emote: null,
    calm: true,
    frozen: true,
  });
  return (
    <div className={className}>
      <Canvas
        aria-hidden
        camera={{ fov: 30, position: [0, 0.8, 1.5] }}
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true }}
        onCreated={({ camera }) => camera.lookAt(0, 0.8, 0)}
      >
        <ambientLight intensity={1.6} />
        <directionalLight position={[1, 3, 4]} intensity={2} />
        <Avatar look={config} name="" pose={pose} cosmetics={equipped} />
      </Canvas>
    </div>
  );
}
