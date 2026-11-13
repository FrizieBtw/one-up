import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { SHOP_ACCESSORY_PIECES, type AvatarConfig, type AvatarCosmetics } from "@stepup/shared";
import { HAIR_CELL, PALETTE_HEIGHT, PALETTE_WIDTH, SKIN_CELL, readGradients, renderPalette, type CellGradient } from "./palette";
import { ACCESSORIES, OUTFITS, type AccessoryEntry } from "./partsCatalogue";

// Assemblage d'un personnage à partir de pièces KayKit de fichiers différents, sur le squelette d'un seul fichier.
// Valable parce que les 23 os ont les mêmes noms et les mêmes matrices inverses dans tous les fichiers.
// Le visage se choisit en un seul bloc : la tête d'origine d'un personnage (visage, coiffure, barbe). La recomposition par pièces
// (splitHead.ts, capHead.ts) est conservée à côté, testée, mais n'est plus utilisée : elle laissait des vides (dessus du crâne, bas du visage).

const BASE = "/models/kaykit/characters/";
const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();

interface PixelData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
const pixelsOf = new WeakMap<THREE.Texture, PixelData>();
const gradientsOf = new WeakMap<THREE.Texture, CellGradient[]>();

/** Pixels d'une palette, lus une fois : après un premier rendu, l'image source n'est plus garantie lisible. */
function readPixels(map: THREE.Texture): PixelData {
  let p = pixelsOf.get(map);
  if (!p) {
    const image = map.image as CanvasImageSource & { width: number; height: number };
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(image, 0, 0);
    p = { width: image.width, height: image.height, data: ctx.getImageData(0, 0, image.width, image.height).data };
    pixelsOf.set(map, p);
  }
  return p;
}

function originalGradients(map: THREE.Texture): CellGradient[] {
  let g = gradientsOf.get(map);
  if (!g) {
    const { width, height, data } = readPixels(map);
    g = readGradients(width, height, (x, y) => {
      const o = (y * width + x) * 4;
      return [data[o]!, data[o + 1]!, data[o + 2]!];
    });
    gradientsOf.set(map, g);
  }
  return g;
}

const load = (file: string) => {
  let p = cache.get(file);
  if (!p)
    cache.set(
      file,
      (p = loader.loadAsync(BASE + file).then((g) => {
        g.scene.traverse((o) => {
          const map = ((o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined)?.map;
          if (map) originalGradients(map);
        });
        return g.scene;
      })),
    );
  return p;
};

/** Matériau dont la palette est reconstruite avec la peau et les cheveux demandés. */
function recoloredMaterial(source: THREE.MeshStandardMaterial, colors: Record<number, string>): THREE.MeshStandardMaterial {
  if (!source.map) return source.clone(); // matériau uni (verres, par exemple) : rien à recolorer
  const pixels = renderPalette(originalGradients(source.map), colors);
  const texture = new THREE.DataTexture(new Uint8Array(pixels.buffer), PALETTE_WIDTH, PALETTE_HEIGHT, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const m = source.clone();
  m.map = texture;
  return m;
}

/** Tous les maillages qui correspondent : un maillage glTF à plusieurs matériaux devient plusieurs maillages three. */
function findMeshes(root: THREE.Object3D, match: (name: string) => boolean): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && match(o.name)) found.push(o as THREE.Mesh);
  });
  if (!found.length) throw new Error("maillage introuvable");
  return found;
}
/** Nom d'une pièce de corps, avec le suffixe `_1`, `_2` des maillages à plusieurs matériaux (Paladin). */
const partName = (part: string) => (name: string) => new RegExp(`${part}(_\\d+)?$`).test(name);
const isHeadMesh = partName("Head");
const findMesh = (root: THREE.Object3D, match: (name: string) => boolean) => findMeshes(root, match)[0]!;

/** Pièces d'accessoires effectivement portées : celles de la configuration, plus celles des objets de boutique (qui prennent la place). */
export function accessoryPieces(config: AvatarConfig, cosmetics: AvatarCosmetics): string[] {
  const shop = cosmetics.accessory === "cap" || cosmetics.accessory === "glasses" ? SHOP_ACCESSORY_PIECES[cosmetics.accessory] : null;
  const slotOf = (id: string) => ACCESSORIES.find((a) => a.id === id)?.slot;
  return [...config.acc.filter((id) => !shop || slotOf(id) !== shop.slot), ...(shop ? [shop.id] : [])];
}

/** Construit le personnage : squelette du crâne choisi, pièces des autres fichiers liées à ce squelette. */
export async function assemble(config: AvatarConfig, cosmetics: AvatarCosmetics = {}): Promise<THREE.Group> {
  const colors: Record<number, string> = { [SKIN_CELL]: config.skin, [HAIR_CELL]: config.hairColor };
  const faceScene = await load(`${config.face}.glb`);
  const root = cloneSkinned(faceScene) as THREE.Group;
  const baseHead = findMeshes(root, isHeadMesh)[0] as THREE.SkinnedMesh;
  const skeleton = baseHead.skeleton;
  const parent = baseHead.parent!;
  const extras: THREE.Object3D[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) extras.push(o);
  });
  extras.forEach((o) => o.parent?.remove(o));

  const baseBones = new Map(skeleton.bones.map((b) => [b.name, b]));
  const bind = (src: THREE.SkinnedMesh) => {
    // Les poids de peau désignent les os par leur rang dans le squelette du fichier source. Chaque pièce garde donc son propre
    // ordre (os et matrices inverses du fichier source) mais pointe vers les os du personnage assemblé, qui portent l'animation.
    const own = new THREE.Skeleton(
      src.skeleton.bones.map((b) => baseBones.get(b.name)!),
      src.skeleton.boneInverses,
    );
    const mesh = new THREE.SkinnedMesh(src.geometry, recoloredMaterial(src.material as THREE.MeshStandardMaterial, colors));
    mesh.name = src.name;
    mesh.frustumCulled = false;
    parent.add(mesh);
    mesh.bind(own, src.bindMatrix);
  };

  // Tête d'origine entière (un maillage glTF à plusieurs matériaux devient plusieurs maillages).
  for (const m of findMeshes(faceScene, isHeadMesh)) bind(m as THREE.SkinnedMesh);

  const outfit = cosmetics.outfit ?? config.outfit;
  const legs = cosmetics.outfit ?? config.legs;
  const top = await load(OUTFITS.find((o) => o.id === outfit)!.file);
  for (const part of ["Body", "ArmLeft", "ArmRight"]) for (const m of findMeshes(top, partName(part))) bind(m as THREE.SkinnedMesh);
  const bottom = await load(OUTFITS.find((o) => o.id === legs)!.file);
  for (const part of ["LegLeft", "LegRight"]) for (const m of findMeshes(bottom, partName(part))) bind(m as THREE.SkinnedMesh);

  for (const id of accessoryPieces(config, cosmetics)) {
    const entry: AccessoryEntry = ACCESSORIES.find((a) => a.id === id)!;
    for (const src of findMeshes(await load(entry.file), (n) => n === entry.mesh || n.startsWith(entry.mesh + "_"))) {
      if (entry.bone) {
        const mesh = new THREE.Mesh(src.geometry, recoloredMaterial(src.material as THREE.MeshStandardMaterial, colors));
        mesh.position.copy(src.position);
        mesh.quaternion.copy(src.quaternion);
        mesh.scale.copy(src.scale);
        mesh.frustumCulled = false;
        (root.getObjectByName(entry.bone) ?? root).add(mesh);
      } else bind(src as THREE.SkinnedMesh);
    }
  }
  return root;
}
