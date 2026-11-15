"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { headThumb } from "@/avatar/parts/assemble";
import { MathUtils, type Group } from "three";
import {
  AVATAR_FACES,
  FREE_BOTTOMS,
  FREE_FACES,
  FREE_HAIR,
  FREE_TOPS,
  FREE_SKINS,
  AVATAR_OPTIONS,
  AVATAR_OUTFITS,
  type AvatarConfig,
  type AvatarCosmetics,
  type EmoteId,
} from "@stepup/shared";
import { HEADS } from "@/avatar/parts/catalogue";
import { OUTFITS } from "@/avatar/parts/partsCatalogue";
import { Avatar, type AvatarPose } from "@/avatar/Avatar";
import {
  setItemEquipped,
  useEconomy,
  useEquippedCosmetics,
} from "@/lib/economy";
import { useNav } from "@/lib/nav";
import { ShopIcon } from "../icons";
import { HudButton, HudPanel } from "../hud";

function Preview({
  config,
  name,
  emote,
  cosmetics,
  angle,
}: {
  config: AvatarConfig;
  name: string;
  emote: EmoteId | null;
  cosmetics: AvatarCosmetics;
  angle: { current: number };
}) {
  const turntable = useRef<Group>(null!);
  const pose = useRef<AvatarPose>({ moving: false, emote: null, calm: true });
  pose.current.emote = emote;
  useFrame((_, delta) => {
    turntable.current.rotation.y = MathUtils.damp(
      turntable.current.rotation.y,
      angle.current,
      14,
      delta,
    );
  });
  return (
    <group ref={turntable} position-y={-0.55}>
      <Avatar look={config} name={name} pose={pose} cosmetics={cosmetics} />
    </group>
  );
}

/** Double flèche arrondie : la poignée de rotation. */
function RotateIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 11a8 6 0 0 1 14-3.5" />
      <path d="M18.5 3.5v4h-4" />
      <path d="M20 13a8 6 0 0 1-14 3.5" />
      <path d="M5.5 20.5v-4h4" />
    </svg>
  );
}

/** Aperçu 3D : l'avatar reste au repos ; le joueur le fait pivoter en glissant (la poignée sous le personnage ou le personnage lui-même) ou avec les flèches du clavier. */
export function AvatarPreview({
  config,
  name,
  className = "",
  cosmetics,
  emote = null,
}: {
  config: AvatarConfig;
  name: string;
  className?: string;
  /** Objets de boutique à montrer ; par défaut ceux que le compte a équipés. */
  cosmetics?: AvatarCosmetics;
  /** Emote jouée en continu (essayage d'une emote de boutique). */
  emote?: EmoteId | null;
}) {
  const equipped = useEquippedCosmetics();
  const angle = useRef(0);
  const drag = useRef<number | null>(null);
  const grab = (e: PointerEvent<HTMLElement>) => {
    drag.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    if (drag.current === null) return;
    angle.current += (e.clientX - drag.current) * 0.012;
    drag.current = e.clientX;
  };
  const release = () => (drag.current = null);
  return (
    <div className={`relative ${className}`}>
      <div
        className="size-full cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={grab}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={release}
      >
        <Canvas
          aria-hidden
          camera={{ fov: 34, position: [0, 0.3, 3.8] }}
          dpr={[1, 2]}
          gl={{ alpha: true, antialias: true }}
        >
          <ambientLight intensity={1.6} />
          <directionalLight position={[2, 4, 4]} intensity={2} />
          <Preview
            config={config}
            name={name}
            emote={emote}
            cosmetics={cosmetics ?? equipped}
            angle={angle}
          />
        </Canvas>
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-[77%] flex justify-center">
        <div
          role="slider"
          tabIndex={0}
          aria-label="Faire pivoter le personnage"
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={Math.round(
            ((((angle.current * 180) / Math.PI) % 360) + 360) % 360,
          )}
          className="pointer-events-auto grid size-9 cursor-grab touch-none place-items-center rounded-full bg-white text-hud-ink shadow-[0_2px_8px_rgba(15,13,34,0.25)] select-none active:cursor-grabbing"
          onPointerDown={grab}
          onPointerMove={move}
          onPointerUp={release}
          onPointerCancel={release}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") angle.current -= 0.3;
            else if (e.key === "ArrowRight") angle.current += 0.3;
          }}
        >
          <RotateIcon />
        </div>
      </div>
    </div>
  );
}

const THUMBS = "/models/kaykit/thumbs";
const headLabel = (id: string) => HEADS.find((h) => h.id === id)?.label ?? id;
const outfitLabel = (id: string) =>
  OUTFITS.find((o) => o.id === id)?.label ?? id;

interface TileOption {
  id: string;
  label: string;
  image: string;
}

const faceOptions: TileOption[] = AVATAR_FACES.map((id) => ({
  id,
  label: headLabel(id),
  image: `${THUMBS}/faces/${id}.png`,
}));
const topOptions: TileOption[] = AVATAR_OUTFITS.map((id) => ({
  id,
  label: outfitLabel(id),
  image: `${THUMBS}/tops/${id}.png`,
}));
const bottomOptions: TileOption[] = AVATAR_OUTFITS.map((id) => ({
  id,
  label: outfitLabel(id),
  image: `${THUMBS}/bottoms/${id}.png`,
}));

/** Tuiles de choix sur deux colonnes : une seule est sélectionnée. */
function Tiles({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: TileOption[];
  onChange: (id: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid grid-cols-4 gap-1.5"
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={option.id === value}
          aria-label={option.label}
          onClick={() => onChange(option.id)}
          className={`flex flex-col items-center gap-1 rounded-xl border-2 px-1 py-2 font-hud text-[11px] leading-tight font-semibold text-black ${option.id === value ? "border-hud-accent bg-hud-soft" : "border-transparent bg-hud-field"}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- vignettes statiques de petite taille */}
          <img
            src={option.image}
            alt=""
            width={56}
            height={56}
            loading="lazy"
            className="size-14 object-contain"
          />
        </button>
      ))}
    </div>
  );
}

function Swatches({
  label,
  colors,
  allowed,
  value,
  onChange,
}: {
  label: string;
  colors: readonly string[];
  /** Couleurs proposées (la couleur actuelle l'est toujours) ; le numéro affiché reste celui de la liste complète. */
  allowed: readonly string[];
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 block font-hud text-xs font-semibold text-black">
        {label}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {colors.map((color, i) =>
          allowed.includes(color) || color === value ? (
            <button
              key={color}
              type="button"
              aria-label={`${label} ${i + 1}`}
              aria-pressed={value === color}
              onClick={() => onChange(color)}
              className={`size-[22px] rounded-full border-[2.5px] border-white ${value === color ? "shadow-[0_0_0_2.5px_#6f5be0]" : "shadow-[0_0_0_1.5px_#cfcbe8]"}`}
              style={{ backgroundColor: color }}
            />
          ) : null,
        )}
      </div>
    </fieldset>
  );
}

type Category = "face" | "top" | "bottom" | "accessory";
const CATEGORIES: [Category, string][] = [
  ["face", "Tête"],
  ["top", "Haut"],
  ["bottom", "Bas"],
  ["accessory", "Accessoires"],
];

/**
 * Studio d'avatar devant le miroir de la chambre : catégories à gauche, options à droite, Annuler / Valider en bas,
 * personnage au centre. Teint, cheveux et barbe sont sous Tête.
 */
export function AvatarStudio({
  config,
  onChange,
  name,
  cosmetics,
  tryName,
  status,
  onCancel,
  onConfirm,
}: {
  config: AvatarConfig;
  onChange: (config: AvatarConfig) => void;
  name: string;
  cosmetics?: AvatarCosmetics;
  /** Objet de boutique essayé (« Essayer au miroir »), porté sans être équipé. */
  tryName?: string;
  status: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [category, setCategory] = useState<Category>("face");
  // Têtes proposées : les gratuites, plus celle déjà portée (un avatar existant ne perd pas la sienne).
  const shownFaces: string[] = [
    ...FREE_FACES,
    ...(FREE_FACES.includes(config.face as never) ? [] : [config.face]),
  ];
  // Vignettes des têtes à la couleur de peau et de cheveux choisie (la vignette statique sert en attendant).
  const [headImages, setHeadImages] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    void (async () => {
      for (const id of shownFaces) {
        try {
          const url = await headThumb(id, config.skin, config.hairColor);
          if (!alive) return;
          setHeadImages((m) => ({ ...m, [id]: url }));
        } catch {
          return; // pas de WebGL : on garde les vignettes statiques
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [config.skin, config.hairColor, shownFaces.join()]);
  const { shop, inventory, refresh } = useEconomy();
  const set = <K extends keyof AvatarConfig>(key: K, value: AvatarConfig[K]) =>
    onChange({ ...config, [key]: value });
  const accessories = inventory.flatMap((o) => {
    const item = shop.find((i) => i.id === o.itemId);
    return item?.category === "accessory" ? [{ ...o, item }] : [];
  });
  const title = CATEGORIES.find(([id]) => id === category)![1];

  return (
    <>
      <div className="fixed top-[88px] bottom-[84px] left-1/2 z-10 w-[min(380px,60vw)] -translate-x-1/2">
        <AvatarPreview
          config={config}
          name={name}
          cosmetics={cosmetics}
          className="h-full w-full"
        />
      </div>

      <HudPanel className="fixed top-[88px] right-[370px] z-20 w-32 p-1.5">
        <div
          role="tablist"
          aria-label="Catégories"
          aria-orientation="vertical"
          className="flex flex-col"
        >
          {CATEGORIES.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={category === id}
              onClick={() => setCategory(id)}
              className={`w-full rounded-[11px] px-3 py-2 text-left font-hud text-[13px] font-semibold ${category === id ? "bg-hud-accent text-white" : "text-black"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </HudPanel>

      <HudPanel className="fixed top-[88px] right-4 z-20 max-h-[calc(100dvh-188px)] w-[340px] overflow-y-auto p-2.5">
        <h2 className="mb-2 font-hud! text-sm font-semibold text-black">
          {title}
        </h2>
        {category === "face" && (
          <>
            <Tiles
              label="Visage"
              value={config.face}
              options={faceOptions
                .filter((o) => shownFaces.includes(o.id))
                .map((o) => ({
                  ...o,
                  image: headImages[o.id] ?? o.image,
                }))}
              onChange={(id) => set("face", id as AvatarConfig["face"])}
            />
            <div className="my-3 h-px bg-[#e9e7f5]" />
            <Swatches
              label="Teint"
              colors={AVATAR_OPTIONS.skin}
              allowed={FREE_SKINS}
              value={config.skin}
              onChange={(v) => set("skin", v as AvatarConfig["skin"])}
            />
            <div className="my-3 h-px bg-[#e9e7f5]" />
            <Swatches
              label="Cheveux & barbe"
              colors={AVATAR_OPTIONS.hair}
              allowed={FREE_HAIR}
              value={config.hairColor}
              onChange={(v) => set("hairColor", v as AvatarConfig["hairColor"])}
            />
          </>
        )}
        {category === "top" && (
          <Tiles
            label="Haut"
            value={config.outfit}
            options={[
              ...FREE_TOPS,
              ...(FREE_TOPS.includes(config.outfit as never)
                ? []
                : [config.outfit]),
            ].map((id) => topOptions.find((o) => o.id === id)!)}
            onChange={(id) => set("outfit", id as AvatarConfig["outfit"])}
          />
        )}
        {category === "bottom" && (
          <Tiles
            label="Bas"
            value={config.legs}
            options={[
              ...FREE_BOTTOMS,
              ...(FREE_BOTTOMS.includes(config.legs as never)
                ? []
                : [config.legs]),
            ].map((id) => bottomOptions.find((o) => o.id === id)!)}
            onChange={(id) => set("legs", id as AvatarConfig["legs"])}
          />
        )}
        {category === "accessory" &&
          (accessories.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-2 py-6 text-center">
              <span className="grid size-12 place-items-center rounded-full bg-hud-soft text-hud-accent">
                <ShopIcon className="size-6" />
              </span>
              <p className="font-hud text-sm font-semibold text-black">
                Aucun accessoire
              </p>
              <p className="text-xs text-hud-muted">
                Chapeaux, lunettes, capes… Trouve-en à la boutique pour
                personnaliser ton look.
              </p>
              <HudButton
                className="mt-1 px-4 py-2 text-[13px]"
                onClick={() => useNav.getState().openProfile("shop")}
              >
                Aller à la boutique
              </HudButton>
            </div>
          ) : (
            <ul className="grid grid-cols-4 gap-1.5">
              {accessories.map(({ item, equipped }) => (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-pressed={equipped}
                    onClick={() =>
                      void setItemEquipped(item.id, !equipped).then(() =>
                        refresh(),
                      )
                    }
                    className={`w-full rounded-xl border-2 px-1 py-2.5 font-hud text-[11px] font-semibold text-black ${equipped ? "border-hud-accent bg-hud-soft" : "border-transparent bg-hud-field"}`}
                  >
                    {item.name}
                  </button>
                </li>
              ))}
            </ul>
          ))}
      </HudPanel>

      {tryName && (
        <HudPanel className="fixed bottom-[84px] left-1/2 z-20 -translate-x-1/2 rounded-full px-3.5 py-1 text-xs">
          Essai : {tryName}
        </HudPanel>
      )}

      <HudPanel className="fixed bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 px-2.5 py-2">
        <HudButton variant="outline" className="w-32 py-2" onClick={onCancel}>
          Annuler
        </HudButton>
        <HudButton className="w-32 py-2" onClick={onConfirm}>
          Valider
        </HudButton>
      </HudPanel>
      {status && (
        <HudPanel
          role="status"
          className="fixed top-1/2 left-1/2 z-30 -translate-x-1/2 px-5 py-3 font-semibold"
        >
          {status}
        </HudPanel>
      )}
    </>
  );
}
