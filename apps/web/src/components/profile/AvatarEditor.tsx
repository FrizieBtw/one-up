"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useRef, useState } from "react";
import type { Group } from "three";
import { AVATAR_OPTIONS, type AvatarConfig, type EmoteId } from "@stepup/shared";
import { Avatar, type AvatarPose } from "@/avatar/Avatar";
import { Button } from "../ui";

function Preview({ config, name, emote }: { config: AvatarConfig; name: string; emote: EmoteId | null }) {
  const turntable = useRef<Group>(null!);
  const pose = useRef<AvatarPose>({ moving: false, emote: null });
  pose.current.emote = emote;
  useFrame((_, delta) => {
    turntable.current.rotation.y += delta * 0.6;
  });
  return (
    <group ref={turntable} position-y={-0.55}>
      <Avatar look={config} name={name} pose={pose} />
    </group>
  );
}

/** Aperçu 3D animé : l'avatar tourne sur lui-même et peut faire une emote. */
export function AvatarPreview({ config, name, className = "" }: { config: AvatarConfig; name: string; className?: string }) {
  const [emote, setEmote] = useState<EmoteId | null>(null);
  return (
    <div className={`relative ${className}`}>
      <Canvas aria-hidden camera={{ fov: 30, position: [0, 0.2, 3.4] }} dpr={[1, 2]} gl={{ alpha: true, antialias: true }}>
        <ambientLight intensity={1.6} />
        <directionalLight position={[2, 4, 4]} intensity={2} />
        <Preview config={config} name={name} emote={emote} />
      </Canvas>
      <div className="absolute inset-x-0 bottom-1 flex justify-center gap-2">
        <Button className="!px-3 !py-0.5 !text-sm" variant="plain" onClick={() => setEmote(emote === "dance" ? null : "dance")}>
          {emote === "dance" ? "Arrêter" : "Danse"}
        </Button>
      </div>
    </div>
  );
}

const swatch = (selected: boolean) =>
  `size-9 rounded-full border-3 ${selected ? "border-ink ring-4 ring-violet" : "border-ink/40"} cursor-pointer`;

function ColorRow({ label, colors, value, onChange }: { label: string; colors: readonly string[]; value: string; onChange: (color: string) => void }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="font-bold">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {colors.map((color, i) => (
          <button key={color} type="button" aria-label={`${label} ${i + 1}`} aria-pressed={value === color} className={swatch(value === color)} style={{ backgroundColor: color }} onClick={() => onChange(color)} />
        ))}
      </div>
    </fieldset>
  );
}

function ChoiceRow<T extends number>({ label, options, names, value, onChange }: { label: string; options: readonly T[]; names: string[]; value: T; onChange: (value: T) => void }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="font-bold">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Button key={option} className="!px-4 !py-1 !text-base" variant={value === option ? "primary" : "plain"} aria-pressed={value === option} onClick={() => onChange(option)}>
            {names[option]}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}

export function AvatarEditor({ config, onChange }: { config: AvatarConfig; onChange: (config: AvatarConfig) => void }) {
  const set = <K extends keyof AvatarConfig>(key: K, value: AvatarConfig[K]) => onChange({ ...config, [key]: value });
  return (
    <div className="flex flex-col gap-4">
      <ColorRow label="Teint" colors={AVATAR_OPTIONS.skin} value={config.skin} onChange={(v) => set("skin", v as AvatarConfig["skin"])} />
      <ChoiceRow label="Coiffure" options={AVATAR_OPTIONS.hairStyle} names={["Calotte", "Mèche", "Couettes"]} value={config.hairStyle} onChange={(v) => set("hairStyle", v)} />
      <ColorRow label="Couleur des cheveux" colors={AVATAR_OPTIONS.hair} value={config.hair} onChange={(v) => set("hair", v as AvatarConfig["hair"])} />
      <ChoiceRow label="Yeux" options={AVATAR_OPTIONS.eyeStyle} names={["Ronds", "Allongés"]} value={config.eyeStyle} onChange={(v) => set("eyeStyle", v)} />
      <ColorRow label="Tenue" colors={AVATAR_OPTIONS.outfit} value={config.outfit} onChange={(v) => set("outfit", v as AvatarConfig["outfit"])} />
    </div>
  );
}
