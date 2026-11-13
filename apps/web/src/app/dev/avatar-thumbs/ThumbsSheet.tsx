"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { AVATAR_FACES, AVATAR_OUTFITS } from "@stepup/shared";

const SIZE = 192;
const part = (names: string[]) => (name: string) => names.some((n) => new RegExp(`${n}(_\d+)?$`).test(name));

/** Rend un personnage (géométrie au repos, sans squelette) sans ses accessoires : seules les pièces demandées sont gardées. */
async function render(renderer: THREE.WebGLRenderer, file: string, keep: (name: string) => boolean): Promise<string> {
  const gltf = await new GLTFLoader().loadAsync(`/models/kaykit/characters/${file}`);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc8b89a, 2.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(2, 3, 6);
  scene.add(sun);
  const box = new THREE.Box3();
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !keep(mesh.name)) return;
    const copy = new THREE.Mesh(mesh.geometry, mesh.material);
    scene.add(copy);
    mesh.geometry.computeBoundingBox();
    box.union(mesh.geometry.boundingBox!);
  });
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const half = (Math.max(size.x, size.y) * 1.12) / 2;
  const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 50);
  camera.position.set(center.x, center.y, center.z + 10);
  camera.lookAt(center);
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL("image/png");
}

/** Vignettes : `faces/<id>.png` (tête seule), `tops/<id>.png` (corps et bras) et `bottoms/<id>.png` (jambes), publiées dans `window.__thumbs`. */
export function ThumbsSheet() {
  const [status, setStatus] = useState("génération…");
  useEffect(() => {
    const canvas = document.createElement("canvas");
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(SIZE, SIZE, false);
    renderer.setClearColor(0x000000, 0);
    const result: Record<string, string> = {};
    (async () => {
      for (const id of AVATAR_FACES) result[`faces/${id}.png`] = await render(renderer, `${id}.glb`, part(["Head"]));
      for (const id of AVATAR_OUTFITS) {
        result[`tops/${id}.png`] = await render(renderer, `${id}.glb`, part(["Body", "ArmLeft", "ArmRight"]));
        result[`bottoms/${id}.png`] = await render(renderer, `${id}.glb`, part(["LegLeft", "LegRight"]));
      }
      (window as unknown as { __thumbs: Record<string, string> }).__thumbs = result;
      setStatus(`${Object.keys(result).length} vignettes`);
    })().catch((e) => setStatus(`ERREUR ${(e as Error).message}`));
    return () => renderer.dispose();
  }, []);
  return <main className="p-4 font-bold">{status}</main>;
}
