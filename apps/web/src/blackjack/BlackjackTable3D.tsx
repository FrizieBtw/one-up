"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { CanvasTexture, MathUtils, SRGBColorSpace, type Group } from "three";
import { parseAvatarConfig, type BlackjackSnapshot, type CardSnapshot } from "@stepup/shared";
import { Avatar, lookFromId, type AvatarLook, type AvatarPose } from "@/avatar/Avatar";
import { useNav } from "@/lib/nav";

const CARD_W = 0.62;
const CARD_H = 0.86;
const TABLE_RADIUS = 3.4;
const DECK: [number, number, number] = [2.1, 0.12, -1.5];
const SUIT_GLYPH: Record<string, string> = { spades: "♠", hearts: "♥", diamonds: "♦", clubs: "♣" };

const textures = new Map<string, CanvasTexture>();

/** Texture d'une carte (ou du dos si `card` est absent), dessinée par code et mise en cache. */
function cardTexture(card?: CardSnapshot): CanvasTexture {
  const key = card ? card.rank + card.suit : "back";
  const cached = textures.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 224;
  const ctx = canvas.getContext("2d")!;
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#2a1b4d";
  ctx.fillStyle = card ? "#ffffff" : "#6c3bf5";
  ctx.beginPath();
  ctx.roundRect(4, 4, 152, 216, 18);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (card) {
    ctx.fillStyle = card.suit === "hearts" || card.suit === "diamonds" ? "#e8344a" : "#2a1b4d";
    // Valeur et couleur dans la moitié gauche : elles restent lisibles quand les cartes se chevauchent.
    ctx.font = "800 76px system-ui, sans-serif";
    ctx.fillText(card.rank, 50, 62, 76);
    ctx.font = "64px system-ui, sans-serif";
    ctx.fillText(SUIT_GLYPH[card.suit] ?? "?", 50, 132);
    ctx.globalAlpha = 0.18;
    ctx.font = "120px system-ui, sans-serif";
    ctx.fillText(SUIT_GLYPH[card.suit] ?? "?", 112, 160);
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = "#ffd23f";
    ctx.font = "800 96px system-ui, sans-serif";
    ctx.fillText("★", 80, 116);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  textures.set(key, texture);
  return texture;
}

/** Carte posée sur la table ; elle arrive depuis la pioche. `card` absent = face cachée. */
function CardMesh({ card, position, rotationY }: { card?: CardSnapshot; position: [number, number, number]; rotationY: number }) {
  const group = useRef<Group>(null!);
  const placed = useRef(false);
  useFrame((_, delta) => {
    const g = group.current;
    if (!placed.current) {
      g.position.set(...DECK);
      placed.current = true;
    }
    g.position.x = MathUtils.damp(g.position.x, position[0], 9, delta);
    g.position.y = MathUtils.damp(g.position.y, position[1], 9, delta);
    g.position.z = MathUtils.damp(g.position.z, position[2], 9, delta);
  });
  return (
    <group ref={group} rotation-y={rotationY}>
      {/* Légèrement relevée vers la caméra pour rester lisible */}
      <mesh rotation-x={-1.15}>
        <planeGeometry args={[CARD_W, CARD_H]} />
        <meshBasicMaterial map={cardTexture(card)} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Main étalée, centrée sur `center`, le long de l'axe donné par `rotationY`. */
function Hand({ cards, hiddenCount = 0, center, rotationY }: { cards: CardSnapshot[]; hiddenCount?: number; center: [number, number]; rotationY: number }) {
  const total = cards.length + hiddenCount;
  const spread = 0.3;
  return (
    <>
      {Array.from({ length: total }, (_, i) => {
        const offset = (i - (total - 1) / 2) * spread;
        const x = center[0] + Math.cos(rotationY) * offset;
        const z = center[1] - Math.sin(rotationY) * offset;
        // Chaque carte passe un peu au-dessus de la précédente.
        return <CardMesh key={i} card={cards[i]} position={[x, 0.2 + i * 0.012, z]} rotationY={rotationY} />;
      })}
    </>
  );
}

const DEALER_LOOK: AvatarLook = { skin: "#f2b98f", hair: "#2a1b4d", outfit: "#2a1b4d", hairStyle: 1, eyeStyle: 1 };

function Seat({ name, look, angle, cards, isTurn, won }: { name: string; look: AvatarLook; angle: number; cards: CardSnapshot[]; isTurn: boolean; won: boolean }) {
  const pose = useRef<AvatarPose>({ moving: false, emote: null });
  pose.current.emote = won ? "cheer" : null;
  const at = (radius: number): [number, number] => [Math.sin(angle) * radius, Math.cos(angle) * radius * 0.82 + 0.3];
  const [ax, az] = at(TABLE_RADIUS + 0.35);
  const [rx, rz] = at(TABLE_RADIUS + 0.35);
  return (
    <>
      {isTurn && (
        <mesh rotation-x={-Math.PI / 2} position={[rx, 0.03, rz]}>
          <ringGeometry args={[0.36, 0.5, 32]} />
          <meshBasicMaterial color="#ffd23f" toneMapped={false} />
        </mesh>
      )}
      <group position={[ax, 0, az]} rotation-y={angle + Math.PI}>
        <Avatar look={look} name={name} pose={pose} />
      </group>
      <Hand cards={cards} center={at(TABLE_RADIUS - 1.05)} rotationY={angle * 0.6} />
    </>
  );
}

/** Table de Blackjack Battle : croupier au fond, joueurs en arc de cercle devant la caméra. */
export default function BlackjackTable3D({ blackjack, identities }: { blackjack: BlackjackSnapshot; identities: Record<string, { id: string; avatar: string }> }) {
  const dealerPose = useRef<AvatarPose>({ moving: false, emote: null });
  // La séquence de lancement attend ce signal : scène chargée et contexte WebGL créé.
  useEffect(() => () => useNav.getState().setGameReady(false), []);
  const seats = Object.entries(blackjack.players);
  const arc = Math.min(1.25, 0.35 * seats.length);
  const looks = useMemo(() => new Map<string, AvatarLook>(), []);
  const lookOf = (sessionId: string) => {
    if (!looks.has(sessionId)) {
      const who = identities[sessionId];
      looks.set(sessionId, parseAvatarConfig(who?.avatar) ?? lookFromId(who?.id ?? sessionId));
    }
    return looks.get(sessionId)!;
  };

  return (
    <Canvas
      aria-hidden
      className="rise-in !pointer-events-none !fixed inset-0 z-0"
      camera={{ fov: 32, position: [0, 11, 12] }}
      onCreated={({ camera }) => {
        camera.lookAt(0, 0.3, 0.3);
        useNav.getState().setGameReady(true);
      }}
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true }}
    >
      <ambientLight intensity={1.6} />
      <directionalLight position={[3, 10, 6]} intensity={2} />

      {/* Table */}
      <mesh position-y={-0.15}>
        <cylinderGeometry args={[TABLE_RADIUS + 0.25, TABLE_RADIUS + 0.4, 0.4, 64]} />
        <meshStandardMaterial color="#4a22c4" roughness={0.6} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.06}>
        <circleGeometry args={[TABLE_RADIUS, 64]} />
        <meshStandardMaterial color="#0f9e98" roughness={0.95} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.065}>
        <ringGeometry args={[TABLE_RADIUS - 0.5, TABLE_RADIUS - 0.44, 64]} />
        <meshBasicMaterial color="#ffd23f" />
      </mesh>

      {/* Pioche */}
      <mesh position={DECK}>
        <boxGeometry args={[CARD_W, 0.16, CARD_H]} />
        <meshStandardMaterial color="#6c3bf5" roughness={0.5} />
      </mesh>

      {/* Croupier */}
      <group position={[0, 0, -TABLE_RADIUS - 0.25]}>
        <Avatar look={DEALER_LOOK} name="Croupier" pose={dealerPose} />
      </group>
      <Hand cards={blackjack.dealer} hiddenCount={blackjack.dealerHidden ? 1 : 0} center={[0, -1.7]} rotationY={0} />

      {seats.map(([sessionId, player], i) => (
        <Seat
          key={sessionId}
          name={player.name}
          look={lookOf(sessionId)}
          angle={seats.length === 1 ? 0 : MathUtils.lerp(-arc, arc, i / (seats.length - 1))}
          cards={player.cards}
          isTurn={blackjack.turn === sessionId}
          won={player.result === "win"}
        />
      ))}
    </Canvas>
  );
}
