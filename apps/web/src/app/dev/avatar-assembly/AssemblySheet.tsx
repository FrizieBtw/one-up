"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { avatarFromSeed, type AvatarConfig } from "@stepup/shared";
import { assemble } from "@/avatar/parts/assemble";

const cfg = (label: string, c: Partial<AvatarConfig>): AvatarConfig & { label: string } => ({ ...avatarFromSeed(label), ...c, label });
const LOOKS = [
  cfg("Voleur", { skin: "#f2b98f", hairColor: "#6b3a1e", face: "Rogue", outfit: "Rogue", legs: "Rogue" }),
  cfg("Visage de sorcière aux cheveux bleus, tenue de mage", { skin: "#8a5a3c", hairColor: "#2f6df2", face: "Witch", outfit: "Mage", legs: "Knight", acc: ["Mage_Hat"] }),
  cfg("Pilote, haut de pilote et bas de fermier", { skin: "#c98a5e", hairColor: "#c8501e", face: "Driver", outfit: "Driver", legs: "Farmer_A", acc: ["Driver_Sunglasses"] }),
  cfg("Héroïne foncée, cape", { skin: "#5a3720", hairColor: "#f4f0ff", face: "Protagonist_B", outfit: "Protagonist_B", legs: "Protagonist_B", acc: ["Paladin_Cape"] }),
  cfg("Érudit vert", { skin: "#8fc46a", hairColor: "#f4f0ff", face: "Lorekeeper", outfit: "Lorekeeper", legs: "Lorekeeper", acc: ["Protagonist_A_Glasses", "Hiker_Backpack"] }),
  cfg("Magicienne rose en clown", { skin: "#ffd9b8", hairColor: "#ff5c6c", face: "MagicalGirl", outfit: "Clown", legs: "Clown", acc: ["Clown_Hat"] }),
  cfg("Ingénieur barbu", { skin: "#f2b98f", hairColor: "#c8501e", face: "Engineer", outfit: "Engineer", legs: "Engineer" }),
  cfg("Randonneur", { skin: "#ffd9b8", hairColor: "#6b3a1e", face: "Hiker", outfit: "Hiker", legs: "Hiker" }),
];
const COLS = 4;
const W = 260;
const H = 380;

/** Planche d'essai : chaque case assemble des pièces de fichiers différents, avec peau et cheveux recolorés. */
export function AssemblySheet() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const rows = Math.ceil(LOOKS.length / COLS);
    canvas.width = COLS * W;
    canvas.height = rows * H;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setScissorTest(true);
    renderer.setClearColor(0xfff4dc, 1);
    renderer.setViewport(0, 0, canvas.width, canvas.height);
    renderer.setScissor(0, 0, canvas.width, canvas.height);
    renderer.clear();
    const out: string[] = [];
    const only = new URLSearchParams(window.location.search).get("only");
    (async () => {
      // Une seule scène et une seule caméra, comme dans un salon : c'est l'usage réel de l'assemblage.
      const scene = new THREE.Scene();
      const sun = new THREE.DirectionalLight(0xffffff, 2.2);
      sun.position.set(2, 3, 8);
      scene.add(new THREE.HemisphereLight(0xffffff, 0xc8b89a, 2.2), sun);
      const SPACING = 2.6;
      const ROW_GAP = 3.4;
      for (let i = 0; i < LOOKS.length; i++) {
        if (only !== null && !only.split(",").includes(String(i))) continue;
        const look = LOOKS[i]!;
        try {
          const model = await assemble(look);
          model.position.set((i % COLS) * SPACING, -Math.floor(i / COLS) * ROW_GAP, 0);
          scene.add(model);
          out.push(`${i}: ${look.label}`);
        } catch (e) {
          out.push(`${i}: ERREUR ${(e as Error).message}`);
        }
      }
      const cam = new THREE.PerspectiveCamera(28, canvas.width / canvas.height, 0.1, 100);
      const cx = ((COLS - 1) * SPACING) / 2;
      const cy = (-(rows - 1) * ROW_GAP) / 2 + 1.1;
      cam.position.set(cx, cy, 19);
      cam.lookAt(cx, cy, 0);
      renderer.setScissorTest(false);
      for (let f = 0; f < 3; f++) {
        await new Promise((r) => requestAnimationFrame(r));
        renderer.render(scene, cam);
      }
      setLines(out);
      (window as unknown as { __done: boolean }).__done = true;
    })();
    return () => renderer.dispose();
  }, []);

  return (
    <main className="p-4">
      <canvas ref={canvasRef} className="block" />
      <ul className="mt-2 text-xs font-bold" aria-label="Assemblages">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </main>
  );
}
