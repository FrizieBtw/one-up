"use client";

import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import type { Room } from "@colyseus/sdk";
import { Suspense, useEffect, useMemo, useRef, type RefObject } from "react";
import {
  BackSide,
  MathUtils,
  type OrthographicCamera,
  MeshBasicMaterial,
  Vector3,
  type Group,
  type Mesh,
  type Object3D,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  LOBBY_SPEED,
  ROOM_BLOCKS,
  ROOM_SPAWN,
  RUN_SPEED,
  clampDirection,
  parseAvatarConfig,
  parseCosmetics,
  stepLobbyPosition,
  type AvatarConfig,
  type AvatarCosmetics,
  type LobbyPlayerSnapshot,
} from "@stepup/shared";
import { Avatar, lookFromId, type AvatarPose } from "@/avatar/Avatar";
import { KAYKIT_SCALE } from "@/avatar/parts/KayKitAvatar";
import { SceneBoundary } from "@/components/SceneBoundary";
import { attachInput, isRunning, padJumpPressed, readMove } from "@/lib/input";
import { useChamber } from "@/lib/chamber";
import { useKeybinds } from "@/lib/keybinds";

// Chambre isométrique vue en diagonale : sol en damier, deux murs, meubles KayKit Furniture Bits cernés d'un contour noir.
// Les meubles ont la même échelle que les personnages KayKit (KAYKIT_SCALE) : les proportions restent justes.

export type RoomSpot = "console" | "mirror";

const HALF = 3; // la pièce fait 6 × 6, de -3 à 3
const FLOOR_TOP = 0.3;
const WALL_HEIGHT = 3.4;
const WALL = 0.3;
/** Où le joueur se place pour utiliser chaque meuble (x, z). */
const STAND: Record<RoomSpot, [number, number]> = {
  console: [2.5, -1.9],
  mirror: [-1.0, -1.9],
};
/** Écart maximal entre le joueur et l'emprise du meuble (le contact est à AVATAR_RADIUS = 0,25). */
const NEAR_DISTANCE = 0.58;
const BLOCK_OF: Record<RoomSpot, number> = { console: 0, mirror: 1 };
/** Points 3D où flottent les hologrammes. */
const HOLO: Record<RoomSpot, [number, number, number]> = {
  console: [2.0, 1.2, -2.5],
  mirror: [-1.0, 2.2, -2.8],
};
/** Facteurs écran → monde : la caméra est à ~34° d'élévation (sin ≈ 0,55), donc la verticale de l'écran raccourcit les distances. La verticale garde la vitesse nominale ; le latéral est ralenti d'autant. */
const SCREEN_X = 0.75;
const SCREEN_Z = 1;
const MOVE_SEND_INTERVAL_MS = 50;
/** Durée de l'animation d'arrivée (Spawn_Ground). */
const SPAWN_MS = 1350;
const VIEW_HALF_HEIGHT = 4.1;
const FURNITURE = "/models/kaykit/furniture/";
const OUTLINE = new MeshBasicMaterial({ color: "#0f0d22", side: BackSide });
/** Contour blanc du meuble avec lequel on peut interagir (infobulle affichée). */
const OUTLINE_LIT = new MeshBasicMaterial({ color: "#ffffff", side: BackSide });

type Vec3 = [number, number, number];

/** Un meuble KayKit : modèle + contour (copie agrandie dont on ne voit que l'envers). L'origine des modèles est au pied, au centre. */
function Kit({
  file,
  position,
  rotation = 0,
  scale = KAYKIT_SCALE,
  lit = false,
  litScale = 1.07,
}: {
  file: string;
  position: Vec3;
  rotation?: number;
  scale?: number;
  lit?: boolean;
  /** Épaisseur du contour blanc (1 = pas de contour). */
  litScale?: number;
}) {
  const gltf = useLoader(GLTFLoader, `${FURNITURE}${file}.gltf`);
  const { body, hull } = useMemo(() => {
    const body = gltf.scene.clone(true);
    const hull = body.clone(true);
    hull.traverse((o: Object3D) => {
      if ((o as Mesh).isMesh)
        (o as Mesh).material = lit ? OUTLINE_LIT : OUTLINE;
    });
    return { body, hull };
  }, [gltf, lit]);
  return (
    <group position={position} rotation-y={rotation} scale={scale}>
      <primitive object={body} />
      <group scale={lit ? litScale : 1.05}>
        <primitive object={hull} />
      </group>
    </group>
  );
}

function Floor() {
  const tiles = [];
  for (let i = 0; i < 6; i++)
    for (let j = 0; j < 6; j++)
      tiles.push(
        <mesh key={`${i}-${j}`} position={[i - 2.5, FLOOR_TOP / 2, j - 2.5]}>
          <boxGeometry args={[1, FLOOR_TOP, 1]} />
          <meshLambertMaterial
            color={(i + j) % 2 ? "#4a4390" : "#453f88"}
            flatShading
          />
        </mesh>,
      );
  return <group>{tiles}</group>;
}

/** Murs posés sur le sol et jointifs au coin : pas de jour entre le sol et les murs, ni entre les deux murs. */
function Walls() {
  return (
    <group>
      <mesh position={[-WALL / 2, WALL_HEIGHT / 2, -HALF - WALL / 2]}>
        <boxGeometry args={[HALF * 2 + WALL, WALL_HEIGHT, WALL]} />
        <meshLambertMaterial color="#6a62b8" flatShading />
      </mesh>
      <mesh position={[-HALF - WALL / 2, WALL_HEIGHT / 2, 0]}>
        <boxGeometry args={[WALL, WALL_HEIGHT, HALF * 2]} />
        <meshLambertMaterial color="#5b53a6" flatShading />
      </mesh>
    </group>
  );
}

function Furniture({ near }: { near: RoomSpot | null }) {
  const y = FLOOR_TOP;
  const consoleLit = near === "console";
  const desk = y + 1 * KAYKIT_SCALE; // dessus du bureau
  return (
    <group>
      {/* Poste de jeu : bureau, écran, console rétro */}
      <Kit file="desk" position={[1.6, y, -2.62]} />
      <Kit file="monitor" position={[1.25, desk, -2.85]} />
      <group position={[2.0, desk, -2.5]} rotation-y={-0.3}>
        <Kit
          file="retro_console"
          position={[0, 0, 0]}
          lit={consoleLit}
          litScale={1.12}
        />
        {/* Cartouche enfichée dans la fente du dessus */}
        <Kit
          file="retro_cartridge"
          position={[0, 0.37 * KAYKIT_SCALE, -0.04]}
          lit={consoleLit}
          litScale={1.12}
        />
      </group>
      <Kit
        file="retro_joystick"
        position={[1.65, desk, -2.35]}
        rotation={0.4}
        lit={consoleLit}
        litScale={1.12}
      />

      {/* Miroir accroché au mur du fond (l'avatar ne peut pas s'y coller) */}
      <Kit
        file="pictureframe_large_A"
        position={[-1.0, 1.5, -HALF + 0.03]}
        scale={KAYKIT_SCALE * 2.2}
        lit={near === "mirror"}
      />
    </group>
  );
}

type LivePlayers = { get(sessionId: string): LobbyPlayerSnapshot | undefined };

function Player({
  look,
  name,
  cosmetics,
  active,
  showPlayer,
  room,
  interactTick,
  onNear,
}: {
  look: AvatarConfig;
  name: string;
  cosmetics: AvatarCosmetics;
  active: boolean;
  showPlayer: boolean;
  room: Room | null;
  /** Incrémenté à chaque appui sur « Interagir » près d'un meuble : le personnage fait son geste. */
  interactTick: number;
  onNear: (spot: RoomSpot | null) => void;
}) {
  const group = useRef<Group>(null!);
  const pose = useRef<AvatarPose>({ moving: false, emote: null });
  const near = useRef<RoomSpot | null>(null);
  const holdPull = useRef(0);
  const sent = useRef({
    x: 0,
    z: 0,
    run: false,
    at: 0,
    placed: false,
    seated: false,
  });

  // Clavier (ZQSD ou WASD, flèches) : la touche physique compte, donc l'agencement du clavier importe peu.
  const jumpRequest = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const jumpUntil = useRef(0);
  const interactUntil = useRef(0);
  const spawnUntil = useRef(0);
  // Chambre rejointe : le personnage sort du sol.
  useEffect(
    () =>
      useChamber.subscribe((s, prev) => {
        if (s.joinSeq !== prev.joinSeq)
          spawnUntil.current = performance.now() + SPAWN_MS;
      }),
    [],
  );
  const facing = useRef<number | null>(null);
  const nearRef = useRef<RoomSpot | null>(null);
  useEffect(() => {
    if (interactTick === 0 || !nearRef.current) return;
    interactUntil.current = performance.now() + 900;
    // Il se tourne vers le meuble.
    const [x0, x1, z0, z1] = ROOM_BLOCKS[BLOCK_OF[nearRef.current]]!;
    const g = group.current;
    facing.current = Math.atan2(
      (x0 + x1) / 2 - g.position.x,
      (z0 + z1) / 2 - g.position.z,
    );
  }, [interactTick]);
  useEffect(
    () =>
      attachInput((code) => {
        if (code === useKeybinds.getState().keys.jump && activeRef.current)
          jumpRequest.current = true;
      }),
    [],
  );
  // Nouveau salon : on se recale sur la position donnée par le serveur.
  useEffect(() => {
    sent.current.placed = false;
  }, [room]);

  useFrame((_, delta) => {
    const g = group.current;
    const server = room
      ? (room.state?.players as LivePlayers | undefined)?.get(room.sessionId)
      : undefined;
    if (server && !sent.current.placed) {
      sent.current.placed = true;
      if (performance.now() < spawnUntil.current) {
        // Salon rejoint : on apparaît où le serveur nous place.
        g.position.x = server.x;
        g.position.z = server.z;
      } else {
        // Salon créé depuis la chambre : on reste où l'on est, et le serveur adopte cette position.
        room?.send("spawnAt", { x: g.position.x, z: g.position.z });
        holdPull.current = performance.now() + 600; // le serveur n'a pas encore pris notre position : pas de rappel vers son apparition aléatoire
        sent.current.seated = false;
      }
    }
    // Assis ou non : le salon le sait, les autres voient la descente et le relevé.
    const sitting =
      pose.current.seat === "down" || pose.current.seat === "idle";
    if (room && server && sitting !== sent.current.seated) {
      sent.current.seated = sitting;
      room.send("sit", { sit: sitting });
    }

    // Clavier ou joystick, relatifs à l'écran. La caméra regarde en diagonale : « droite » à l'écran est (1, -1) dans le monde, « bas » est (1, 1).
    const spawning = performance.now() < spawnUntil.current;
    const interacting = performance.now() < interactUntil.current;
    const raw =
      active && !interacting && !spawning ? readMove() : { x: 0, z: 0 }; // un écran ouvert par-dessus ou un geste en cours : l'avatar ne bouge plus
    // Assis ou en train de se relever : il ne marche pas tant qu'il n'est pas debout. Vouloir bouger le fait se lever.
    const seated =
      pose.current.seat !== undefined && pose.current.seat !== "none";
    pose.current.wantsMove = raw.x !== 0 || raw.z !== 0;
    const pad = seated ? { x: 0, z: 0 } : raw;
    // En vue isométrique, une même distance paraît plus courte en montant ou descendant qu'en allant de côté (la caméra est inclinée) :
    // on compense pour que la vitesse À L'ÉCRAN soit la même dans toutes les directions.
    const sx = pad.x * SCREEN_X;
    const sz = pad.z * SCREEN_Z;
    const dx = (sx + sz) / Math.SQRT2;
    const dz = (sz - sx) / Math.SQRT2;
    const direction = clampDirection(dx, dz); // norme 1 = vitesse nominale
    const moving = direction.x !== 0 || direction.z !== 0;
    // Maj : on court, deux fois plus vite (le clip de course suit).
    const running = moving && isRunning();
    if (moving) {
      // Même simulation que le serveur (limites, meubles contournés) : les deux concordent.
      const position = { x: g.position.x, z: g.position.z };
      const players = room?.state?.players as
        | (LivePlayers & {
            forEach(cb: (p: LobbyPlayerSnapshot, id: string) => void): void;
          })
        | undefined;
      const others: { x: number; z: number }[] = [];
      players?.forEach(
        (p, id) => id !== room?.sessionId && others.push({ x: p.x, z: p.z }),
      );
      stepLobbyPosition(position, direction, delta, running, others);
      g.position.x = position.x;
      g.position.z = position.z;
      const heading = Math.atan2(direction.x, direction.z);
      const diff = Math.atan2(
        Math.sin(heading - g.rotation.y),
        Math.cos(heading - g.rotation.y),
      );
      g.rotation.y += diff * Math.min(1, delta * 12);
    }
    // Saut : la touche lance l'animation (0,65 s) et prévient le salon pour que les autres la voient.
    const nowMs = performance.now();
    const wantsJump =
      jumpRequest.current || (activeRef.current && padJumpPressed());
    jumpRequest.current = false;
    if (wantsJump && seated)
      pose.current.wantsMove = true; // sauter depuis le sol : on commence par se lever
    else if (wantsJump && nowMs > jumpUntil.current) {
      jumpUntil.current = nowMs + 650;
      room?.send("move", {
        x: direction.x,
        z: direction.z,
        run: running,
        jump: true,
      });
    }
    pose.current.jumping = nowMs < jumpUntil.current;
    pose.current.interacting = interacting;
    pose.current.spawning = spawning;
    if (interacting && facing.current !== null)
      g.rotation.y +=
        Math.atan2(
          Math.sin(facing.current - g.rotation.y),
          Math.cos(facing.current - g.rotation.y),
        ) * Math.min(1, delta * 10);
    pose.current.moving = moving;
    pose.current.running = running;
    pose.current.speed =
      (running ? RUN_SPEED : LOBBY_SPEED) *
      Math.hypot(direction.x, direction.z); // vitesse réelle : les pas suivent

    if (room) {
      // On n'envoie que les changements de direction, à cadence bornée (l'arrêt part tout de suite).
      const now = performance.now();
      const last = sent.current;
      const changed =
        Math.abs(direction.x - last.x) > 0.02 ||
        Math.abs(direction.z - last.z) > 0.02 ||
        running !== last.run;
      if (changed && (!moving || now - last.at >= MOVE_SEND_INTERVAL_MS)) {
        room.send("move", { x: direction.x, z: direction.z, run: running });
        Object.assign(last, {
          x: direction.x,
          z: direction.z,
          run: running,
          at: now,
        });
      }
      // Rappel doux vers la position du serveur (autorité).
      if (server && performance.now() > holdPull.current) {
        const pull = Math.min(1, delta * (moving ? 1.5 : 8));
        g.position.x = MathUtils.lerp(g.position.x, server.x, pull);
        g.position.z = MathUtils.lerp(g.position.z, server.z, pull);
      }
    }

    let found: RoomSpot | null = null;
    for (const spot of ["console", "mirror"] as const) {
      // Distance à l'emprise du meuble (et non à un point fixe) : coller le meuble suffit, d'où qu'on l'approche.
      const [x0, x1, z0, z1] = ROOM_BLOCKS[BLOCK_OF[spot]]!;
      const gapX = Math.max(x0 - g.position.x, 0, g.position.x - x1);
      const gapZ = Math.max(z0 - g.position.z, 0, g.position.z - z1);
      if (Math.hypot(gapX, gapZ) < NEAR_DISTANCE) found = spot;
    }
    if (found !== near.current) {
      near.current = found;
      nearRef.current = found;
      onNear(found);
    }
  });

  return (
    <group
      ref={group}
      position={[ROOM_SPAWN.x, FLOOR_TOP, ROOM_SPAWN.z]}
      visible={showPlayer}
    >
      <Avatar
        look={look}
        name={name}
        pose={pose}
        cosmetics={cosmetics}
        clipY={FLOOR_TOP}
      />
    </group>
  );
}

/** Un autre joueur de la chambre : position et direction viennent du serveur (lues à chaque image, sans rendu React). */
function Remote({ room, sessionId }: { room: Room; sessionId: string }) {
  const group = useRef<Group>(null!);
  const pose = useRef<AvatarPose>({ moving: false, emote: null });
  const spawnUntil = useRef(performance.now() + SPAWN_MS);
  const initial = (room.state.players as LivePlayers).get(sessionId);
  const look = useMemo(
    () =>
      parseAvatarConfig(initial?.avatar) ??
      lookFromId(initial?.id ?? sessionId),
    [initial?.avatar, initial?.id, sessionId],
  );
  const cosmetics = useMemo(
    () => parseCosmetics(initial?.cosmetics),
    [initial?.cosmetics],
  );

  useFrame((_, delta) => {
    const live = (room.state.players as LivePlayers).get(sessionId);
    const g = group.current;
    if (!live || !g) return;
    g.position.x = MathUtils.damp(g.position.x, live.x, 12, delta);
    g.position.z = MathUtils.damp(g.position.z, live.z, 12, delta);
    const moving = live.dx !== 0 || live.dz !== 0;
    if (moving) {
      const heading = Math.atan2(live.dx, live.dz);
      g.rotation.y +=
        Math.atan2(
          Math.sin(heading - g.rotation.y),
          Math.cos(heading - g.rotation.y),
        ) * Math.min(1, delta * 12);
    }
    pose.current.jumping = live.jump;
    pose.current.forceSeat = live.sit;
    pose.current.spawning = performance.now() < spawnUntil.current;
    pose.current.moving = moving;
    pose.current.running = live.run;
    pose.current.speed =
      (live.run ? RUN_SPEED : LOBBY_SPEED) * Math.hypot(live.dx, live.dz);
  });

  return (
    <group
      ref={group}
      position={[
        initial?.x ?? ROOM_SPAWN.x,
        FLOOR_TOP,
        initial?.z ?? ROOM_SPAWN.z,
      ]}
    >
      <Avatar
        look={look}
        name={initial?.name}
        pose={pose}
        faded={initial?.connected === false}
        cosmetics={cosmetics}
        clipY={FLOOR_TOP}
      />
    </group>
  );
}

/** Cadre l'orthographique sur la pièce et colle les hologrammes (éléments DOM) à leur point 3D. */
function Rig({
  holo,
}: {
  holo: Record<RoomSpot, RefObject<HTMLElement | null>>;
}) {
  const point = useRef(new Vector3());
  useFrame(({ camera, size }) => {
    camera.zoom = Math.min(
      size.height / (2 * VIEW_HALF_HEIGHT),
      size.width / (2 * VIEW_HALF_HEIGHT * 1.3),
    );
    camera.lookAt(0, 1.2, 0);
    // Décale l'image vers le bas (5 % de la hauteur) pour dégager l'en-tête.
    (camera as OrthographicCamera).setViewOffset(
      size.width,
      size.height,
      0,
      -size.height * 0.05,
      size.width,
      size.height,
    );
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    for (const spot of ["console", "mirror"] as const) {
      const el = holo[spot].current;
      if (!el) continue;
      point.current.set(...HOLO[spot]).project(camera);
      el.style.transform = `translate(${(point.current.x * 0.5 + 0.5) * size.width}px, ${(-point.current.y * 0.5 + 0.5) * size.height}px)`;
    }
  });
  return null;
}

export default function RoomScene({
  look,
  name,
  cosmetics,
  holo,
  active,
  showPlayer,
  room,
  peers,
  near,
  interactTick,
  onNear,
}: {
  look: AvatarConfig;
  name: string;
  cosmetics: AvatarCosmetics;
  holo: Record<RoomSpot, RefObject<HTMLElement | null>>;
  active: boolean;
  showPlayer: boolean;
  /** Salon connecté (ou null : chambre solo) et sessions des autres joueurs. */
  room: Room | null;
  peers: string[];
  /** Meuble avec lequel on peut interagir (infobulle affichée) : son contour devient blanc. */
  near: RoomSpot | null;
  interactTick: number;
  onNear: (spot: RoomSpot | null) => void;
}) {
  return (
    <Canvas
      onCreated={({ gl }) => (gl.localClippingEnabled = true)}
      aria-hidden
      orthographic
      camera={{ position: [9, 8.5, 9], near: -60, far: 120, zoom: 60 }}
      dpr={[1, 2]}
      gl={{ antialias: true }}
      className="!fixed inset-0 z-0"
    >
      <ambientLight intensity={1.6} />
      <directionalLight position={[3, 6, 4]} intensity={1.6} />
      <Rig holo={holo} />
      <Floor />
      <Walls />
      <SceneBoundary>
        <Suspense fallback={null}>
          <Furniture near={near} />
        </Suspense>
      </SceneBoundary>
      <Player
        interactTick={interactTick}
        look={look}
        name={name}
        cosmetics={cosmetics}
        active={active}
        showPlayer={showPlayer}
        room={room}
        onNear={onNear}
      />
      {room &&
        peers.map((sessionId) => (
          <Remote key={sessionId} room={room} sessionId={sessionId} />
        ))}
    </Canvas>
  );
}
