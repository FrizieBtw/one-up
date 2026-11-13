// Lecture d'un GLB dans Node, pour les tests et les scripts : jamais importé par l'application.
// Extrait le maillage `Head` (géométrie fusionnée) et un échantillonneur de palette (PNG décodé avec pngjs).
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { PALETTE_COLS, PALETTE_ROWS, type HeadMeshData, type PaletteSampler } from "./splitHead";

interface Gltf {
  nodes?: { name?: string; mesh?: number; skin?: number; children?: number[] }[];
  skins?: { joints: number[] }[];
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }[];
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
  meshes: { name: string; primitives: { attributes: Record<string, number>; indices: number; material?: number }[] }[];
  materials?: { pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }[];
  textures?: { source: number }[];
  images?: { bufferView: number }[];
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const READERS: Record<number, [keyof DataView, number]> = { 5126: ["getFloat32", 4], 5123: ["getUint16", 2], 5125: ["getUint32", 4], 5121: ["getUint8", 1] };

function parseGlb(file: string): { json: Gltf; bin: Buffer } {
  const buf = readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} n'est pas un GLB`);
  const jsonLength = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString("utf8")) as Gltf;
  const binStart = 20 + jsonLength;
  const binLength = buf.readUInt32LE(binStart);
  return { json, bin: buf.subarray(binStart + 8, binStart + 8 + binLength) };
}

function readAccessor(json: Gltf, bin: Buffer, index: number): number[] {
  const a = json.accessors[index]!;
  const view = json.bufferViews[a.bufferView]!;
  const [method, size] = READERS[a.componentType]!;
  const n = COMPONENTS[a.type]!;
  const stride = view.byteStride ?? size * n;
  const base = bin.byteOffset + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const dv = new DataView(bin.buffer, bin.byteOffset - bin.byteOffset + 0, bin.buffer.byteLength);
  const out: number[] = [];
  for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) out.push((dv[method] as (o: number, le: boolean) => number).call(dv, base + i * stride + k * size, true));
  return out;
}

export interface LoadedHead {
  mesh: HeadMeshData;
  palette: PaletteSampler;
  meshName: string;
  triangleCount: number;
}

export interface MeshInfo {
  name: string;
  /** Habillé sur le squelette (cape, vêtement) ou rigide, accroché à un os (chapeau, lunettes). */
  skinned: boolean;
  /** Os le plus proche au-dessus du maillage dans la hiérarchie (accessoires rigides). */
  bone: string | null;
  triangles: number;
}

/** Inventaire des maillages d'un personnage : nom, type, os d'accroche, nombre de triangles. */
export function listMeshes(file: string): MeshInfo[] {
  const { json, bin } = parseGlb(file);
  const nodes = json.nodes ?? [];
  const parentOf = new Map<number, number>();
  nodes.forEach((n, i) => n.children?.forEach((c) => parentOf.set(c, i)));
  const joints = new Set(json.skins?.flatMap((s) => s.joints) ?? []);
  const out: MeshInfo[] = [];
  nodes.forEach((node, i) => {
    if (node.mesh === undefined) return;
    const mesh = json.meshes[node.mesh]!;
    let bone: string | null = null;
    for (let p = parentOf.get(i); p !== undefined; p = parentOf.get(p)) {
      if (joints.has(p)) {
        bone = nodes[p]!.name ?? null;
        break;
      }
    }
    const triangles = mesh.primitives.reduce((s, prim) => s + json.accessors[prim.indices]!.count / 3, 0);
    out.push({ name: node.name ?? mesh.name, skinned: node.skin !== undefined, bone, triangles });
  });
  void bin;
  return out;
}

/** Charge le maillage dont le nom se termine par `Head` (ou `meshSuffix`) d'un personnage KayKit. */
export function loadHead(file: string, meshSuffix = "Head"): LoadedHead {
  return loadMesh(file, (name) => name.endsWith(meshSuffix));
}

/** Charge le premier maillage dont le nom satisfait `match` : géométrie fusionnée et échantillonneur de palette. */
export function loadMesh(file: string, match: (name: string) => boolean): LoadedHead {
  const { json, bin } = parseGlb(file);
  const mesh = json.meshes.find((m) => match(m.name));
  if (!mesh) throw new Error(`${file} : aucun maillage correspondant`);

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const prim of mesh.primitives) {
    const base = positions.length / 3;
    positions.push(...readAccessor(json, bin, prim.attributes.POSITION!));
    uvs.push(...readAccessor(json, bin, prim.attributes.TEXCOORD_0!));
    indices.push(...readAccessor(json, bin, prim.indices).map((i) => i + base));
  }

  const textureIndex = json.materials?.[mesh.primitives[0]!.material ?? 0]?.pbrMetallicRoughness?.baseColorTexture?.index;
  const image = textureIndex === undefined ? undefined : json.images?.[json.textures![textureIndex]!.source];
  if (!image) throw new Error(`${file} : pas de texture de palette`);
  const view = json.bufferViews[image.bufferView]!;
  const png = PNG.sync.read(Buffer.from(bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)));

  const palette: PaletteSampler = (cell) => {
    const col = cell % PALETTE_COLS;
    const row = Math.floor(cell / PALETTE_COLS);
    const x = Math.floor(((col + 0.5) * png.width) / PALETTE_COLS);
    const y = Math.floor(((row + 0.5) * png.height) / PALETTE_ROWS);
    const o = (y * png.width + x) * 4;
    const rgb: [number, number, number] = [png.data[o]!, png.data[o + 1]!, png.data[o + 2]!];
    return { rgb, luminance: (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 };
  };

  return { mesh: { positions, uvs, indices }, palette, meshName: mesh.name, triangleCount: indices.length / 3 };
}
