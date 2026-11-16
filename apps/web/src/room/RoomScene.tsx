"use client";

import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import type { Room } from "@colyseus/sdk";
import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
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
  BLACKJACK_TABLE,
  blackjackSeat,
  BLACKJACK_FURNITURE_GONE_AT,
  blockedByBlackjack,
  ROOM_BLOCKS,
  ROOM_SPAWN,
  RUN_SPEED,
  clampDirection,
  parseAvatarConfig,
  parseCosmetics,
  stepLobbyPosition,
  groundHeight,
  startJump,
  stepVertical,
  type Body,
  type AvatarConfig,
  type AvatarCosmetics,
  type LobbyPlayerSnapshot,
} from "@stepup/shared";
import { Avatar, lookFromId, type AvatarPose } from "@/avatar/Avatar";
import { KAYKIT_SCALE } from "@/avatar/parts/KayKitAvatar";
import { SceneBoundary } from "@/components/SceneBoundary";
import { attachInput, isRunning, padJumpPressed, readMove } from "@/lib/input";
import { useChamber } from "@/lib/chamber";
import { BlackjackTable, tableSequence } from "./BlackjackTable";
import { Kit, type Vec3 } from "./Kit";
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
/** Décalage (vers la table) du joueur assis par rapport au centre du tabouret : le bassin tombe sur l'assise. */
const SIT_FORWARD = 0.14;
/** Distance (au centre du pouf) à laquelle on peut s'asseoir. */
const SEAT_REACH = 0.9;
const VIEW_HALF_HEIGHT = 4.1;
/** Temps que met la table de jeu à tout faire partir (voir LEAVE_* dans BlackjackTable : la table part à 2,3 s, plus son envol). */
const RETURN_AFTER_GAME_SECONDS = 3.6;
/** Demi-hauteur (unités du monde) de la vue de dessus à la table : table, poufs et croupier tiennent à l'écran. */
const TOP_VIEW_HALF_HEIGHT = 1.1;
const TOP_VIEW_HALF_WIDTH = 1; // poufs des extrémités (±2,25) : rognés
/** Inclinaison de la vue de dessus par rapport à la verticale (0 : à plat). */
const TOP_VIEW_TILT_DEGREES = 30;
/** Décalage du centre de la vue vers les joueurs. */
const TOP_VIEW_SHIFT = 0.35;
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
  const back = useRef<Mesh>(null!);
  const side = useRef<Mesh>(null!);
  // Vue à la troisième personne : la caméra peut passer derrière un mur, qui est alors masqué.
  useFrame(({ camera }) => {
    back.current.visible = camera.position.z > -HALF;
    side.current.visible = camera.position.x > -HALF;
  });
  return (
    <group>
      <mesh
        ref={back}
        position={[-WALL / 2, WALL_HEIGHT / 2, -HALF - WALL / 2]}
      >
        <boxGeometry args={[HALF * 2 + WALL, WALL_HEIGHT, WALL]} />
        <meshLambertMaterial color="#6a62b8" flatShading />
      </mesh>
      <mesh ref={side} position={[-HALF - WALL / 2, WALL_HEIGHT / 2, 0]}>
        <boxGeometry args={[WALL, WALL_HEIGHT, HALF * 2]} />
        <meshLambertMaterial color="#5b53a6" flatShading />
      </mesh>
    </group>
  );
}

/**
 * Un élément de la chambre qui s'envole (puis disparaît) quand la partie commence, après un délai au hasard, et revient à la fin.
 * `pivot` : point autour duquel il tourne en s'envolant (son centre).
 */
function Fly({
  gone,
  pivot,
  leaveAt,
  returnAt,
  children,
}: {
  gone: boolean;
  pivot: Vec3;
  /** Délai (s) avant de s'envoler au début de la partie, et avant de revenir à la fin. */
  leaveAt: number;
  returnAt: number;
  children: ReactNode;
}) {
  const outer = useRef<Group>(null!);
  // À l'arrivée dans la chambre les meubles sont déjà à leur place (ou déjà partis si une partie est en cours) : pas d'animation.
  const progress = useRef(gone ? 1 : 0);
  const elapsed = useRef(0);
  const changed = useRef(false);
  // Tant que l'état du salon n'est pas arrivé, on ne sait pas si une partie est en cours : les meubles ne bougent pas.
  const known = useChamber((st) => st.snapshot !== null);
  const wasKnown = useRef(false);
  // Au retour, les meubles attendent que tous les éléments de la table de jeu soient partis.
  const delay = gone ? leaveAt : returnAt + RETURN_AFTER_GAME_SECONDS;
  useFrame((_, dt) => {
    elapsed.current += dt;
    // Première image avec l'état connu : on se place sans animer.
    if (!known || !wasKnown.current) {
      progress.current = gone ? 1 : 0;
      changed.current = false;
    }
    wasKnown.current = known;
    // Délai compté depuis le dernier changement d'état.
    const target =
      !changed.current || elapsed.current > delay
        ? gone
          ? 1
          : 0
        : gone
          ? 0
          : 1;
    progress.current = MathUtils.damp(progress.current, target, 2.4, dt);
    const p = progress.current;
    const o = outer.current;
    o.visible = p < 0.995;
    o.position.set(pivot[0], pivot[1] + p * p * 9, pivot[2]);
    o.scale.setScalar(1 - p * 0.55);
  });
  // Le délai repart de zéro à chaque changement d'état (pas au montage).
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (!wasKnown.current) return;
    changed.current = true;
    elapsed.current = 0;
  }, [gone]);
  return (
    <group ref={outer} position={pivot}>
      <group position={[-pivot[0], -pivot[1], -pivot[2]]}>{children}</group>
    </group>
  );
}

function Furniture({ near, gone }: { near: RoomSpot | null; gone: boolean }) {
  const y = FLOOR_TOP;
  const consoleLit = near === "console";
  const desk = y + 1 * KAYKIT_SCALE; // dessus du bureau
  // Ordre au hasard, mais jamais le bureau avant ce qui est posé dessus : il part en dernier et revient en premier.
  const order = useMemo(
    () => ({
      monitor: [Math.random() * 0.9, 1.2 + Math.random() * 0.8],
      console: [Math.random() * 0.9, 1.2 + Math.random() * 0.8],
      joystick: [Math.random() * 0.9, 1.2 + Math.random() * 0.8],
      mirror: [Math.random() * 1.8, Math.random() * 1.8],
      desk: [1.5 + Math.random() * 0.3, Math.random() * 0.2],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nouvel ordre à chaque changement d'état
    [gone],
  );
  return (
    <group>
      {/* Poste de jeu : bureau, écran, console rétro */}
      <Fly
        gone={gone}
        pivot={[1.6, y + 0.3, -2.62]}
        leaveAt={order.desk[0]!}
        returnAt={order.desk[1]!}
      >
        <Kit file="desk" position={[1.6, y, -2.62]} />
      </Fly>
      <Fly
        gone={gone}
        pivot={[1.25, desk + 0.2, -2.85]}
        leaveAt={order.monitor[0]!}
        returnAt={order.monitor[1]!}
      >
        <Kit file="monitor" position={[1.25, desk, -2.85]} />
      </Fly>
      <Fly
        gone={gone}
        pivot={[2.0, desk + 0.1, -2.5]}
        leaveAt={order.console[0]!}
        returnAt={order.console[1]!}
      >
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
      </Fly>
      <Fly
        gone={gone}
        pivot={[1.65, desk + 0.1, -2.35]}
        leaveAt={order.joystick[0]!}
        returnAt={order.joystick[1]!}
      >
        <Kit
          file="retro_joystick"
          position={[1.65, desk, -2.35]}
          rotation={0.4}
          lit={consoleLit}
          litScale={1.12}
        />
      </Fly>

      {/* Miroir accroché au mur du fond (l'avatar ne peut pas s'y coller) */}
      <Fly
        gone={gone}
        pivot={[-1.0, 1.5, -HALF + 0.03]}
        leaveAt={order.mirror[0]!}
        returnAt={order.mirror[1]!}
      >
        <Kit
          file="pictureframe_large_A"
          position={[-1.0, 1.5, -HALF + 0.03]}
          scale={KAYKIT_SCALE * 2.2}
          lit={near === "mirror"}
        />
      </Fly>
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
  onNearSeat,
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
  /** Place de blackjack libre à portée (on peut s'y asseoir), ou null. */
  onNearSeat: (seat: number | null) => void;
}) {
  const group = useRef<Group>(null!);
  const nearSeatRef = useRef<number | null>(null);
  const wasSeated = useRef(false);
  /** Place occupée à l'image précédente (-1 : debout) : sert à se recaler sur la position du serveur au moment de se lever. */
  const lastSeat = useRef(-1);
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
  /** Verticale du joueur (hauteur des pieds et vitesse) : même simulation que le serveur, pour sauter sur les meubles bas. */
  const body = useRef<Body>({ y: 0, vy: 0 });
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

    // Partie de blackjack : le joueur est assis à sa place (position imposée par le serveur) et ne bouge plus.
    const seatIndex = server?.seat ?? -1;
    if (seatIndex >= 0) {
      const seat = blackjackSeat(seatIndex);
      g.position.x = seat.x + Math.sin(seat.facing) * SIT_FORWARD;
      g.position.z = seat.z + Math.cos(seat.facing) * SIT_FORWARD;
      g.position.y = FLOOR_TOP + (tableSequence.stool[seatIndex] ?? 0);
      g.rotation.y = seat.facing;
      wasSeated.current = true;
      lastSeat.current = seatIndex;
      g.visible = showPlayer;
      tableSequence.seated = true;
      tableSequence.promptSeat = seatIndex; // pour « Se lever » : la bulle flotte au-dessus de sa tête
      tableSequence.promptY = 1.5;
      Object.assign(pose.current, {
        forceSeat: true,
        hideName: true, // le pseudo est écrit sur la table
        chair: true,
        moving: false,
        wantsMove: false,
        running: false,
      });
      if (near.current) {
        near.current = null;
        onNear(null);
      }
      if (nearSeatRef.current !== null) {
        nearSeatRef.current = null;
        onNearSeat(null);
      }
      return;
    }
    g.visible = showPlayer;
    if (lastSeat.current >= 0) {
      // On vient de se lever : le serveur nous a posés derrière la place. On s'y recale tout de suite ; sinon le personnage reste
      // dans le pouf (un obstacle) et ne rejoint le serveur que par le rappel doux : déplacements bloqués puis saccadés.
      lastSeat.current = -1;
      if (server) {
        g.position.x = server.x;
        g.position.z = server.z;
        g.position.y = FLOOR_TOP;
        body.current.y = 0;
        body.current.vy = 0;
      }
    }
    // Debout après la partie ou entre deux manches : on joue d'abord le relevé (clip de chaise), puis on reprend la main.
    if (
      wasSeated.current &&
      pose.current.seat !== undefined &&
      pose.current.seat !== "none"
    ) {
      pose.current.forceSeat = false;
    } else {
      wasSeated.current = false;
      pose.current.forceSeat = undefined;
      pose.current.chair = false;
      pose.current.hideName = false;
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
    const bjOn0 =
      useChamber.getState().snapshot?.gameId === "blackjack" &&
      tableSequence.elapsed > 0;
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
      const bjOn =
        useChamber.getState().snapshot?.gameId === "blackjack" &&
        tableSequence.elapsed > 0;
      const feet = body.current.y;
      stepLobbyPosition(
        position,
        direction,
        delta,
        running,
        others,
        bjOn
          ? (x, z) => blockedByBlackjack(x, z, tableSequence.elapsed, feet)
          : undefined,
        // Les meubles de la chambre ont disparu pendant la partie : ils ne bloquent plus.
        !bjOn || tableSequence.elapsed < BLACKJACK_FURNITURE_GONE_AT,
        feet,
      );
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
      startJump(
        body.current,
        groundHeight(
          g.position.x,
          g.position.z,
          !bjOn0 || tableSequence.elapsed < BLACKJACK_FURNITURE_GONE_AT,
          bjOn0 ? tableSequence.elapsed : null,
        ),
      );
      room?.send("move", {
        x: direction.x,
        z: direction.z,
        run: running,
        jump: true,
      });
    }
    // Verticale : gravité, atterrissage au sol ou sur un meuble / la table ; assis, on est au sol.
    stepVertical(
      body.current,
      groundHeight(
        g.position.x,
        g.position.z,
        !bjOn0 || tableSequence.elapsed < BLACKJACK_FURNITURE_GONE_AT,
        bjOn0 ? tableSequence.elapsed : null,
      ),
      delta,
    );
    // Le serveur fait foi : un écart important (téléportation, relevé de la table) recale la hauteur.
    if (server && Math.abs(server.y - body.current.y) > 0.5)
      body.current.y = server.y;
    g.position.y = FLOOR_TOP + body.current.y;
    pose.current.physics = true;
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

    // Pendant une partie de blackjack les meubles ont disparu : on ne s'en approche plus, on cherche une place libre.
    const snap = useChamber.getState().snapshot;
    const inBlackjack =
      snap?.gameId === "blackjack" && snap.phase === "playing";
    let found: RoomSpot | null = null;
    let nearSeat: number | null = null;
    if (!inBlackjack) {
      for (const spot of ["console", "mirror"] as const) {
        // Distance à l'emprise du meuble (et non à un point fixe) : coller le meuble suffit, d'où qu'on l'approche.
        const [x0, x1, z0, z1] = ROOM_BLOCKS[BLOCK_OF[spot]]!;
        const gapX = Math.max(x0 - g.position.x, 0, g.position.x - x1);
        const gapZ = Math.max(z0 - g.position.z, 0, g.position.z - z1);
        if (Math.hypot(gapX, gapZ) < NEAR_DISTANCE) found = spot;
      }
    } else if (
      snap &&
      (snap.blackjack.round === 0 || snap.blackjack.stage === "roundEnd")
    ) {
      const taken = new Set(Object.values(snap.players).map((p) => p.seat));
      let best = SEAT_REACH;
      for (let i = 0; i < BLACKJACK_TABLE.seats; i++) {
        // Un pouf encore en train de tomber n'est pas utilisable ; les autres le sont dès qu'ils sont posés.
        if (taken.has(i) || (tableSequence.stool[i] ?? 1) > 0.3) continue;
        const seat = blackjackSeat(i);
        const d = Math.hypot(g.position.x - seat.x, g.position.z - seat.z);
        if (d < best) {
          best = d;
          nearSeat = i;
        }
      }
    }
    tableSequence.seated = false;
    tableSequence.promptSeat = nearSeat;
    tableSequence.promptY = 0.55;
    if (nearSeat !== nearSeatRef.current) {
      nearSeatRef.current = nearSeat;
      onNearSeat(nearSeat);
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
    pose.current.chair = live.seat >= 0;
    pose.current.hideName = live.seat >= 0; // le pseudo est écrit sur la table
    pose.current.physics = true;
    g.position.y =
      FLOOR_TOP +
      (live.seat >= 0
        ? (tableSequence.stool[live.seat] ?? 0)
        : MathUtils.damp(g.position.y - FLOOR_TOP, live.y, 18, delta));
    if (live.seat >= 0) {
      const seat = blackjackSeat(live.seat);
      g.rotation.y = seat.facing;
      g.position.x = seat.x + Math.sin(seat.facing) * SIT_FORWARD;
      g.position.z = seat.z + Math.cos(seat.facing) * SIT_FORWARD;
    }
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
  holo: Record<RoomSpot | "seat", RefObject<HTMLElement | null>>;
}) {
  const point = useRef(new Vector3());
  // Avancement de la transition vue isométrique (0) ↔ vue de dessus à la table (1).
  const blend = useRef(0);
  const tmp = useRef({ a: new Vector3(), b: new Vector3() });
  useFrame(({ camera, size }, delta) => {
    const o = camera as OrthographicCamera;
    blend.current = MathUtils.damp(
      blend.current,
      tableSequence.seated ? 1 : 0,
      3,
      delta,
    );
    if (Math.abs(blend.current - (tableSequence.seated ? 1 : 0)) < 0.001)
      blend.current = tableSequence.seated ? 1 : 0;
    const k = MathUtils.smoothstep(blend.current, 0, 1);
    // Vue isométrique de la chambre.
    const isoZoom = Math.min(
      size.height / (2 * VIEW_HALF_HEIGHT),
      size.width / (2 * VIEW_HALF_HEIGHT * 1.3),
    );
    // Vue de dessus à la table, croupier en haut de l'écran : centrée entre le croupier et le bord des poufs, légèrement
    // inclinée (la caméra recule côté joueurs et regarde vers le croupier).
    const turn = (BLACKJACK_TABLE.facingDegrees * Math.PI) / 180;
    const cx = BLACKJACK_TABLE.x + Math.sin(turn) * TOP_VIEW_SHIFT;
    const cz = BLACKJACK_TABLE.z + Math.cos(turn) * TOP_VIEW_SHIFT;
    const back = 20 * Math.tan((TOP_VIEW_TILT_DEGREES * Math.PI) / 180);
    const topZoom = Math.min(
      size.height / (2 * TOP_VIEW_HALF_HEIGHT),
      size.width / (2 * TOP_VIEW_HALF_WIDTH),
    );
    const { a, b } = tmp.current;
    o.position.set(
      MathUtils.lerp(9, cx + Math.sin(turn) * back, k),
      MathUtils.lerp(8.5, 20, k),
      MathUtils.lerp(9, cz + Math.cos(turn) * back, k),
    );
    o.up.set(-Math.sin(turn) * k, 1 - k, -Math.cos(turn) * k).normalize();
    a.set(0, 1.2, 0);
    b.set(cx, 0, cz);
    a.lerp(b, k);
    // Le zoom varie en proportion (interpolation géométrique) : la vitesse apparente reste régulière.
    o.zoom = isoZoom * Math.pow(topZoom / isoZoom, k);
    o.lookAt(a);
    // Décale l'image vers le bas (5 % de la hauteur) pour dégager l'en-tête.
    o.setViewOffset(
      size.width,
      size.height,
      0,
      -size.height * 0.05,
      size.width,
      size.height,
    );
    o.updateProjectionMatrix();
    o.updateMatrixWorld();
    for (const spot of ["console", "mirror"] as const) {
      const el = holo[spot].current;
      if (!el) continue;
      point.current.set(...HOLO[spot]).project(o);
      el.style.transform = `translate(${(point.current.x * 0.5 + 0.5) * size.width}px, ${(-point.current.y * 0.5 + 0.5) * size.height}px)`;
    }
    // Bulle de la table de blackjack : au-dessus du pouf visé (ou de sa propre place).
    const seatEl = holo.seat.current;
    if (seatEl && tableSequence.promptSeat !== null) {
      const seat = blackjackSeat(tableSequence.promptSeat);
      point.current
        .set(seat.x, FLOOR_TOP + tableSequence.promptY, seat.z)
        .project(o);
      seatEl.style.transform = `translate(${(point.current.x * 0.5 + 0.5) * size.width}px, ${(-point.current.y * 0.5 + 0.5) * size.height}px)`;
    }
  });
  return null;
}

export default function RoomScene({
  look,
  name,
  cosmetics,
  holo,
  litSeat,
  active,
  showPlayer,
  room,
  peers,
  near,
  interactTick,
  onNear,
  onNearSeat,
}: {
  look: AvatarConfig;
  name: string;
  cosmetics: AvatarCosmetics;
  holo: Record<RoomSpot | "seat", RefObject<HTMLElement | null>>;
  /** Pouf libre visé (cerné de blanc), ou null. */
  litSeat: number | null;
  active: boolean;
  showPlayer: boolean;
  /** Salon connecté (ou null : chambre solo) et sessions des autres joueurs. */
  room: Room | null;
  peers: string[];
  /** Meuble avec lequel on peut interagir (infobulle affichée) : son contour devient blanc. */
  near: RoomSpot | null;
  interactTick: number;
  onNear: (spot: RoomSpot | null) => void;
  onNearSeat: (seat: number | null) => void;
}) {
  // Partie de blackjack en cours : les meubles s'envolent, la table descend.
  const inGame = useChamber(
    (s) =>
      s.snapshot?.gameId === "blackjack" &&
      (s.snapshot.phase === "playing" || s.snapshot.phase === "results"),
  );
  return (
    <Canvas
      onCreated={({ gl }) => (gl.localClippingEnabled = true)}
      aria-hidden
      orthographic
      camera={{ position: [9, 8.5, 9], near: -60, far: 120, zoom: 60 }}
      dpr={[2, 3]}
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
          <Furniture near={near} gone={inGame} />
          <BlackjackTable show={inGame} litSeat={litSeat} />
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
        onNearSeat={onNearSeat}
      />
      {room &&
        peers.map((sessionId) => (
          <Remote key={sessionId} room={room} sessionId={sessionId} />
        ))}
    </Canvas>
  );
}
