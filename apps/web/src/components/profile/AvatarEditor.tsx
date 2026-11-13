"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import type { Group } from "three";
import { AVATAR_FACES, AVATAR_OPTIONS, AVATAR_OUTFITS, type AvatarConfig, type AvatarCosmetics, type EmoteId } from "@stepup/shared";
import { HEADS } from "@/avatar/parts/catalogue";
import { OUTFITS } from "@/avatar/parts/partsCatalogue";
import { Avatar, type AvatarPose } from "@/avatar/Avatar";
import { useEquippedCosmetics } from "@/lib/economy";
import { Button } from "../ui";

function Preview({ config, name, emote, cosmetics }: { config: AvatarConfig; name: string; emote: EmoteId | null; cosmetics: AvatarCosmetics }) {
  const turntable = useRef<Group>(null!);
  const pose = useRef<AvatarPose>({ moving: false, emote: null });
  pose.current.emote = emote;
  const reducedMotion = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  useFrame((_, delta) => {
    if (!reducedMotion) turntable.current.rotation.y += delta * 0.6;
  });
  return (
    <group ref={turntable} position-y={-0.55}>
      <Avatar look={config} name={name} pose={pose} cosmetics={cosmetics} />
    </group>
  );
}

/** Aperçu 3D animé : l'avatar tourne sur lui-même et peut faire une emote. */
export function AvatarPreview({
  config,
  name,
  className = "",
  cosmetics,
  emote: forcedEmote = null,
}: {
  config: AvatarConfig;
  name: string;
  className?: string;
  /** Objets de boutique à montrer ; par défaut ceux que le compte a équipés. */
  cosmetics?: AvatarCosmetics;
  /** Emote jouée en continu (essayage d'une emote de boutique). */
  emote?: EmoteId | null;
}) {
  const [danceEmote, setEmote] = useState<EmoteId | null>(null);
  const equipped = useEquippedCosmetics();
  const emote = forcedEmote ?? danceEmote;
  return (
    <div className={`relative ${className}`}>
      <Canvas aria-hidden camera={{ fov: 34, position: [0, 0.3, 3.8] }} dpr={[1, 2]} gl={{ alpha: true, antialias: true }}>
        <ambientLight intensity={1.6} />
        <directionalLight position={[2, 4, 4]} intensity={2} />
        <Preview config={config} name={name} emote={emote} cosmetics={cosmetics ?? equipped} />
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

const THUMBS = "/models/kaykit/thumbs";
const headLabel = (id: string) => HEADS.find((h) => h.id === id)?.label ?? id;
const outfitLabel = (id: string) => OUTFITS.find((o) => o.id === id)?.label ?? id;

interface GridOption {
  id: string;
  label: string;
  image: string;
}

/** Grille de choix : chaque élément est montré en vignette, un seul est sélectionné. */
function PieceGrid({ label, value, options, onChange }: { label: string; value: string; options: GridOption[]; onChange: (id: string) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-1.5">
      <span className="font-bold">{label}</span>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {options.map((option) => {
          const selected = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={option.label}
              onClick={() => onChange(option.id)}
              className={`flex cursor-pointer flex-col items-center gap-0.5 rounded-xl border-3 bg-white p-1 text-center text-xs font-bold leading-tight ${selected ? "border-ink ring-4 ring-violet" : "border-ink/30 hover:border-ink/60"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- vignettes statiques de petite taille */}
              <img src={option.image} alt="" width={64} height={64} loading="lazy" className="size-16 object-contain" />
              <span className="line-clamp-2">{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const faceOptions: GridOption[] = AVATAR_FACES.map((id) => ({ id, label: headLabel(id), image: `${THUMBS}/faces/${id}.png` }));
const topOptions: GridOption[] = AVATAR_OUTFITS.map((id) => ({ id, label: outfitLabel(id), image: `${THUMBS}/tops/${id}.png` }));
const bottomOptions: GridOption[] = AVATAR_OUTFITS.map((id) => ({ id, label: outfitLabel(id), image: `${THUMBS}/bottoms/${id}.png` }));

export function AvatarEditor({ config, onChange }: { config: AvatarConfig; onChange: (config: AvatarConfig) => void }) {
  const set = <K extends keyof AvatarConfig>(key: K, value: AvatarConfig[K]) => onChange({ ...config, [key]: value });
  return (
    <div className="flex flex-col gap-4">
      <ColorRow label="Teint" colors={AVATAR_OPTIONS.skin} value={config.skin} onChange={(v) => set("skin", v as AvatarConfig["skin"])} />
      <ColorRow label="Couleur des cheveux" colors={AVATAR_OPTIONS.hair} value={config.hairColor} onChange={(v) => set("hairColor", v as AvatarConfig["hairColor"])} />
      <PieceGrid label="Visage" value={config.face} options={faceOptions} onChange={(id) => set("face", id as AvatarConfig["face"])} />
      <PieceGrid label="Haut" value={config.outfit} options={topOptions} onChange={(id) => set("outfit", id as AvatarConfig["outfit"])} />
      <PieceGrid label="Bas" value={config.legs} options={bottomOptions} onChange={(id) => set("legs", id as AvatarConfig["legs"])} />
    </div>
  );
}
