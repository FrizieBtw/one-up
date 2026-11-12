import { CanvasTexture, SRGBColorSpace } from "three";
import type { GameDefinition } from "@stepup/shared";

const INK = "#2a1b4d";

interface CartridgeArt {
  body: string;
  from: string;
  to: string;
  emblem: (ctx: CanvasRenderingContext2D) => void;
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 ? r * 0.45 : r;
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    ctx.lineTo(x + Math.cos(a) * radius, y + Math.sin(a) * radius);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function playingCard(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, text: string, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.roundRect(-60, -85, 120, 170, 16);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = "800 84px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, 6);
  ctx.restore();
}

// Illustrations originales, dessinées par code : aucune ressource externe.
const ART: Record<string, CartridgeArt> = {
  blackjack: {
    body: "#6c3bf5",
    from: "#4a22c4",
    to: "#14c4bd",
    emblem: (ctx) => {
      playingCard(ctx, 200, 185, -0.22, "A", "#ff5c6c");
      playingCard(ctx, 312, 195, 0.18, "K", INK);
    },
  },
  kart: {
    body: "#14c4bd",
    from: "#ff8a1f",
    to: "#ffd23f",
    emblem: (ctx) => {
      // Drapeau à damier
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 6; col++) {
          ctx.fillStyle = (row + col) % 2 ? "#fff" : INK;
          ctx.fillRect(136 + col * 40, 90 + row * 40, 40, 40);
        }
      }
      ctx.strokeRect(136, 90, 240, 160);
      // Roue
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(256, 250, 62, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffd23f";
      ctx.beginPath();
      ctx.arc(256, 250, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    },
  },
  party: {
    body: "#ff8a1f",
    from: "#ff5c6c",
    to: "#6c3bf5",
    emblem: (ctx) => {
      ctx.fillStyle = "#ffd23f";
      star(ctx, 180, 170, 78);
      star(ctx, 350, 120, 44);
      // Dé
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.roundRect(290, 180, 110, 110, 20);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = INK;
      for (const [x, y] of [[318, 208], [345, 235], [372, 262]] as const) {
        ctx.beginPath();
        ctx.arc(x, y, 11, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  },
};

const FALLBACK: CartridgeArt = { body: "#ff5c6c", from: "#6c3bf5", to: "#ff5c6c", emblem: (ctx) => star(ctx, 256, 180, 90) };

export const cartridgeArt = (gameId: string): CartridgeArt => ART[gameId] ?? FALLBACK;

export const LABEL_ASPECT = 512 / 460;

/** Étiquette illustrée du jeu. Redessinée quand la police de titre est chargée. */
export function createLabelTexture(game: GameDefinition): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 460;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;

  const draw = () => {
    const ctx = canvas.getContext("2d")!;
    const art = cartridgeArt(game.id);
    const display = getComputedStyle(document.documentElement).getPropertyValue("--font-baloo") || "sans-serif";
    ctx.clearRect(0, 0, 512, 460);

    const gradient = ctx.createLinearGradient(0, 0, 512, 460);
    gradient.addColorStop(0, art.from);
    gradient.addColorStop(1, art.to);
    ctx.fillStyle = gradient;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 10;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.roundRect(8, 8, 496, 444, 44);
    ctx.fill();
    ctx.save();
    ctx.clip();
    // Rayons rétro
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = "#fff";
    for (let i = 0; i < 12; i += 2) {
      ctx.beginPath();
      ctx.moveTo(256, 200);
      ctx.arc(256, 200, 700, (i * Math.PI) / 6, ((i + 1) * Math.PI) / 6);
      ctx.fill();
    }
    ctx.restore();
    ctx.stroke();

    art.emblem(ctx);

    ctx.font = `800 62px ${display}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 12;
    ctx.strokeStyle = INK;
    ctx.fillStyle = "#fff";
    ctx.strokeText(game.title, 256, 385, 460);
    ctx.fillText(game.title, 256, 385, 460);

    if (game.status === "soon") {
      ctx.save();
      ctx.translate(408, 78);
      ctx.rotate(0.3);
      ctx.fillStyle = "#ffd23f";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.roundRect(-92, -26, 184, 52, 26);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.font = `800 30px ${display}`;
      ctx.fillText("BIENTÔT", 0, 3);
      ctx.restore();
    }
    texture.needsUpdate = true;
  };

  draw();
  void document.fonts.ready.then(draw);
  return texture;
}
