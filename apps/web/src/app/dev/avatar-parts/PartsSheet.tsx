"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HEADS } from "@/avatar/parts/catalogue";
import { PALETTE_COLS, PALETTE_ROWS, countRoles, splitHead, type PartRole, type PaletteSampler } from "@/avatar/parts/splitHead";

const ROLE_COLOR: Record<PartRole, number> = { skin: 0xf2b98f, ear: 0xd89a70, nose: 0xe8a07a, eye: 0x111111, brow: 0x2f6df2, hair: 0xd23a3a, beard: 0x2fbf4f, other: 0xb040d0 };
const BALD: PartRole[] = ["skin", "ear", "nose", "eye", "brow"];
const COLS = 4;
const W = 320;
const H = 330;

function paletteFromImage(image: CanvasImageSource & { width: number; height: number }): PaletteSampler {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(image, 0, 0);
  return (cell) => {
    const col = cell % PALETTE_COLS;
    const row = Math.floor(cell / PALETTE_COLS);
    const d = g.getImageData(Math.floor(((col + 0.5) * image.width) / PALETTE_COLS), Math.floor(((row + 0.5) * image.height) / PALETTE_ROWS), 1, 1).data;
    return { rgb: [d[0]!, d[1]!, d[2]!], luminance: (0.2126 * d[0]! + 0.7152 * d[1]! + 0.0722 * d[2]!) / 255 };
  };
}

/** Planche de contrôle : pour chaque tête, rôles en couleurs (ligne du haut) et version chauve (ligne du bas). 8 têtes par page : ?page=0, 1, 2… */
export function PartsSheet() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const page = Number(new URLSearchParams(window.location.search).get("page") ?? 0);
    const entries = HEADS.slice(page * 8, page * 8 + 8);
    const rows = Math.ceil(entries.length / COLS);
    const canvas = canvasRef.current!;
    canvas.width = COLS * W;
    canvas.height = rows * 2 * H;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setScissorTest(true);
    renderer.setClearColor(0xfff4dc, 1);
    renderer.setViewport(0, 0, canvas.width, canvas.height);
    renderer.setScissor(0, 0, canvas.width, canvas.height);
    renderer.clear();

    const loader = new GLTFLoader();
    const out: string[] = [];
    (async () => {
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!;
        try {
          const gltf = await loader.loadAsync(`/models/kaykit/characters/${entry.file}`);
          let head: THREE.SkinnedMesh | null = null;
          gltf.scene.traverse((o) => {
            if ((o as THREE.SkinnedMesh).isSkinnedMesh && /Head$/.test(o.name)) head = o as THREE.SkinnedMesh;
          });
          if (!head) throw new Error("aucun maillage Head");
          const mesh = head as THREE.SkinnedMesh;
          const geo = mesh.geometry;
          const map = (mesh.material as THREE.MeshStandardMaterial).map!;
          const result = splitHead(
            { positions: geo.attributes.position!.array, uvs: geo.attributes.uv!.array, indices: geo.index!.array },
            paletteFromImage(map.image as HTMLImageElement),
            entry.overrides,
          );
          const counts = countRoles(result);
          out.push(`${entry.id}: yeux ${counts.eye}, sourcils ${counts.brow}, oreilles ${counts.ear}, cheveux ${counts.hair}, barbe ${counts.beard}`);

          for (const variant of [0, 1] as const) {
            const P: number[] = [];
            const C: number[] = [];
            const pos = geo.attributes.position!;
            const idx = geo.index!.array;
            for (const c of result.components) {
              if (variant === 1 && !BALD.includes(c.role)) continue;
              const col = new THREE.Color(ROLE_COLOR[c.role]);
              for (const t of c.triangles) for (let k = 0; k < 3; k++) {
                const v = idx[3 * t + k]!;
                P.push(pos.getX(v), pos.getY(v), pos.getZ(v));
                C.push(col.r, col.g, col.b);
              }
            }
            const g = new THREE.BufferGeometry();
            g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
            g.setAttribute("color", new THREE.Float32BufferAttribute(C, 3));
            g.computeVertexNormals();
            const scene = new THREE.Scene();
            scene.add(new THREE.HemisphereLight(0xffffff, 0xc8b89a, 2.4));
            const sun = new THREE.DirectionalLight(0xffffff, 2.2);
            sun.position.set(2, 3, 6);
            scene.add(sun, new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, flatShading: true })));
            g.computeBoundingBox();
            const size = g.boundingBox!.getSize(new THREE.Vector3());
            const center = g.boundingBox!.getCenter(new THREE.Vector3());
            const cam = new THREE.PerspectiveCamera(30, W / H, 0.01, 100);
            const dist = (Math.max(size.y, size.x) / (2 * Math.tan(THREE.MathUtils.degToRad(15)))) * 1.25;
            cam.position.set(center.x + dist * 0.35, center.y + size.y * 0.05, center.z + dist);
            cam.lookAt(center);
            const x = (i % COLS) * W;
            const y = (rows * 2 - 1 - (Math.floor(i / COLS) * 2 + variant)) * H;
            renderer.setViewport(x, y, W, H);
            renderer.setScissor(x, y, W, H);
            renderer.render(scene, cam);
          }
        } catch (e) {
          out.push(`${entry.id}: ERREUR ${(e as Error).message}`);
        }
      }
      setLines(out);
      (window as unknown as { __done: boolean }).__done = true;
    })().catch((e) => setError((e as Error).message));
    return () => renderer.dispose();
  }, []);

  return (
    <main className="p-4">
      <canvas ref={canvasRef} className="block" />
      <ul className="mt-2 text-xs font-bold" aria-label="Rôles par tête">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
