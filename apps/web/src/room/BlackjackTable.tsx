"use client";

import { useFrame, useLoader, useThree } from "@react-three/fiber";
import {
  Fragment,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Box3,
  Shape,
  CanvasTexture,
  SRGBColorSpace,
  DoubleSide,
  MathUtils,
  Vector3,
  type Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  BLACKJACK_CHIPS,
  BLACKJACK_TABLE,
  blackjackSeat,
  type CardSnapshot,
} from "@stepup/shared";
import { Avatar, type AvatarLook, type AvatarPose } from "@/avatar/Avatar";
import { KAYKIT_SCALE } from "@/avatar/parts/KayKitAvatar";
import { useChamber } from "@/lib/chamber";
import { Kit } from "./Kit";
import { CHIP_STYLE, chipsList, parseChips } from "./chips";
import { useBetPreview, useDealt } from "./dealt";

// Table de blackjack posée dans la chambre pendant une partie : elle descend du plafond quand les meubles se sont envolés.
// Demi-lune faite par code (bois et feutre vert), tournée en diagonale : places vers le bas de l'écran, croupier dans le coin.

const DIR = "/models/kaykit/blackjack/";
/** Hauteur du sol de la chambre. */
const FLOOR_TOP = 0.3;
/** Les modèles de cartes KayKit font 4,3 × 6 : réduits à ~0,19 × 0,27 sur la table. */
const CARD_SCALE = 0.031;
/** Longueur d'une carte posée sur la table (le modèle KayKit mesure 6 unités). */
const CARD_LENGTH = 6 * CARD_SCALE;
const CARD_WIDTH = 4.3 * CARD_SCALE;
const CARDS_DIR = `${DIR}cards/`;
const RANK_FILE: Record<string, string> = {
  A: "ace",
  "2": "two",
  "3": "three",
  "4": "four",
  "5": "five",
  "6": "six",
  "7": "seven",
  "8": "eight",
  "9": "nine",
  "10": "ten",
  J: "jack",
  Q: "queen",
  K: "king",
};
const SUITS = ["clubs", "diamonds", "hearts", "spades"] as const;
const cardFile = (card?: CardSnapshot) =>
  card ? `card_${card.suit}_${RANK_FILE[card.rank] ?? "ace"}` : "card_base";
const ALL_CARD_FILES = [
  "card_base",
  ...SUITS.flatMap((suit) =>
    Object.values(RANK_FILE).map((rank) => `card_${suit}_${rank}`),
  ),
];

/** Une carte KayKit posée à plat : face visible vers le haut, ou face cachée (dos vers le haut) si `card` est absent. */
function KayCard({ card }: { card?: CardSnapshot }) {
  const gltf = useLoader(GLTFLoader, `${CARDS_DIR}${cardFile(card)}.gltf`);
  const maxAnisotropy = useThree((st) => st.gl.capabilities.getMaxAnisotropy());
  const body = useMemo(() => {
    const clone = gltf.scene.clone(true);
    // Cartes vues de biais et de loin : filtrage trilinéaire et anisotrope maximal, sinon les illustrations deviennent floues.
    clone.traverse((o) => {
      const material = (o as Mesh).material as MeshStandardMaterial | undefined;
      const map = material?.map;
      if (!map) return;
      map.anisotropy = maxAnisotropy;
      map.minFilter = LinearMipmapLinearFilter;
      map.magFilter = LinearFilter;
      map.generateMipmaps = true;
      map.needsUpdate = true;
      // Sans éclairage ni étalonnage tonal : les couleurs de l'illustration restent franches (le shading les délavait).
      (o as Mesh).material = new MeshBasicMaterial({
        map,
        side: material.side,
        transparent: material.transparent,
        alphaTest: material.alphaTest,
        toneMapped: false,
      });
    });
    return clone;
  }, [gltf, maxAnisotropy]);
  // Le modèle est dressé (face vers +z) : -90° la couche face vers le haut, +90° montre le dos.
  return (
    <group rotation-x={card ? -Math.PI / 2 : Math.PI / 2} scale={CARD_SCALE}>
      <primitive object={body} />
    </group>
  );
}
// Croupier : moustache de soldat de plomb, lunettes rondes, tenue de la Magicienne.
const DEALER_LOOK: AvatarLook = {
  v: 3,
  skin: "#f2b98f",
  hairColor: "#2a1b4d",
  face: "ToySoldier",
  outfit: "MagicalGirl",
  legs: "MagicalGirl",
  acc: ["Lorekeeper_Glasses"],
};
const TABLE_RADIUS = 1.5;

function Felt({
  radius,
  y,
  half,
}: {
  radius: number;
  y: number;
  half?: boolean;
}) {
  return (
    <mesh position={[0, y, 0]} rotation-x={-Math.PI / 2}>
      <circleGeometry
        args={[radius, 48, half ? Math.PI : 0, half ? Math.PI : Math.PI * 2]}
      />
      <meshStandardMaterial color="#1f7a4d" side={DoubleSide} />
    </mesh>
  );
}

/** Demi-lune, plateau et pied en bois, feutre vert (côté plat vers le mur, croupier derrière). */
function TableA() {
  return (
    <group>
      <mesh position={[0, 0.45, 0]}>
        <cylinderGeometry
          args={[
            TABLE_RADIUS,
            TABLE_RADIUS,
            0.12,
            48,
            1,
            false,
            -Math.PI / 2,
            Math.PI,
          ]}
        />
        <meshStandardMaterial color="#8a5a3a" />
      </mesh>
      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry
          args={[
            TABLE_RADIUS - 0.25,
            TABLE_RADIUS - 0.25,
            0.4,
            32,
            1,
            false,
            -Math.PI / 2,
            Math.PI,
          ]}
        />
        <meshStandardMaterial color="#5c3a22" />
      </mesh>
      <Felt radius={TABLE_RADIUS - 0.12} y={0.515} half />
    </group>
  );
}

/** Pseudo écrit à plat sur le bord en bois de la table, devant la place, lisible depuis la place. */
function SeatName({
  name,
  at,
  facing,
  y,
}: {
  name: string;
  at: [number, number];
  facing: number;
  y: number;
}) {
  const { texture, aspect } = useMemo(() => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    const font = "800 56px system-ui, sans-serif";
    ctx.font = font;
    canvas.width = Math.ceil(ctx.measureText(name).width) + 24;
    canvas.height = 80;
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 10;
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(42, 27, 77, 0.9)";
    ctx.strokeText(name, canvas.width / 2, canvas.height / 2 + 3);
    ctx.fillStyle = "#fff";
    ctx.fillText(name, canvas.width / 2, canvas.height / 2 + 3);
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 8;
    return { texture: t, aspect: canvas.width / canvas.height };
  }, [name]);
  useEffect(() => () => texture.dispose(), [texture]);
  // La bande de bois fait ~0,12 : texte de 0,1 de haut, réduit si le pseudo dépasse la largeur d'une place (~0,5).
  const height = Math.min(0.1, 0.5 / aspect);
  return (
    <group position={[at[0], y, at[1]]} rotation-y={facing + Math.PI}>
      <mesh rotation-x={-Math.PI / 2} renderOrder={2}>
        <planeGeometry args={[height * aspect, height]} />
        <meshBasicMaterial map={texture} transparent depthWrite={false} />
      </mesh>
    </group>
  );
}

const TABLE_TURN = (BLACKJACK_TABLE.facingDegrees * Math.PI) / 180;
const DEALER_FACING = TABLE_TURN + Math.PI;
/** Le sabot, à côté des cartes du croupier (x, z), du côté de sa main gauche : d'où partent les cartes distribuées. */
/** Écart entre deux cartes côte à côte du croupier, et place de la première (latéralement, vers la droite du croupier = gauche de l'écran). */
const ROW_PITCH = CARD_WIDTH * 1.2;
const ROW_START = -0.12;
// Le sabot est la « carte » juste avant la première : collé à la rangée, côte à côte.
const DECK_SIDE = ROW_START - ROW_PITCH;
const DECK_AT: [number, number] = [
  BLACKJACK_TABLE.x +
    Math.sin(TABLE_TURN) * 0.25 +
    Math.cos(DEALER_FACING) * DECK_SIDE,
  BLACKJACK_TABLE.z +
    Math.cos(TABLE_TURN) * 0.25 -
    Math.sin(DEALER_FACING) * DECK_SIDE,
];
const DECK_TOP = 0.52 + 0.01 + 9 * 0.009;
/** Demi-écart latéral entre les deux mains d'un joueur qui a séparé. */
const SPLIT_SPACING = 0.11;
/** Distance (au centre de la table) des cartes d'un joueur et de ses jetons : cartes un peu vers le centre, jetons entre elles et le pseudo (au bord). */
const HAND_R = 1.08;
const CHIP_R = 1.3;
/**
 * Départ de la table à la fin de la partie, un élément après l'autre (secondes après l'arrêt) : le croupier, les cartes, les poufs
 * l'un après l'autre, enfin la table.
 */
const LEAVE_DEALER = 0;
const LEAVE_CARDS = 0.5;
const LEAVE_STOOLS = 1;
const LEAVE_STOOL_STEP = 0.15;
const LEAVE_TABLE = 2.3;
const DEAL_SECONDS = 0.65;
/** Écart entre deux cartes distribuées (s). */
const DEAL_STEP = 0.8;
/** Le croupier commence son geste un peu avant que la carte ne parte (s). */
/** La carte cachée se retourne à ce moment du geste (s). */
const REVEAL_FLIP_SECONDS = 0.45;
const DEAL_LEAD = 0.45; // la main est vers l'avant à cet instant (voir KayKitAvatar : pivot fini à 0,4 s)
/** Durée pendant laquelle il fait face au sabot pour prendre la carte, avant de se tourner vers sa destination (s). */
const DEAL_PICK_SECONDS = 0.2;
/** Durée pendant laquelle le geste (PickUp / Throw) est maintenu avant de revenir au repos (s). */
const DEAL_GESTURE = 0.8;
/** Part de l'angle vers la cible dont le croupier se tourne pour distribuer. */
const DEAL_TURN_SHARE = 0.6;
/** Pivot supplémentaire vers sa droite quand il pose ou retourne ses propres cartes (rad, ~20°). */
const DEAL_OWN_TURN = 0.35;

/** Une carte distribuée : elle part du sabot, file vers sa place en décrivant un arc, puis suit sa place si elle bouge. */
function DealtCard({
  target,
  rotY,
  delay,
  onDeal,
  startAt,
  startRot = 0,
  children,
}: {
  target: [number, number, number];
  rotY: number;
  delay: number;
  /** Appelé quand le croupier doit commencer son geste (juste avant le départ de la carte). */
  onDeal?: () => void;
  /** Carte déjà sur la table (séparation) : elle part de cette place et glisse jusqu'à la sienne, sans repasser par le croupier. */
  startAt?: [number, number, number];
  startRot?: number;
  children: ReactNode;
}) {
  const group = useRef<Group>(null!);
  const time = useRef(startAt ? 1000 : 0);
  const dealt = useRef(Boolean(startAt));
  // Point de départ du vol : la main du croupier au moment où la carte part.
  const launch = useRef<[number, number, number]>([
    DECK_AT[0],
    DECK_TOP,
    DECK_AT[1],
  ]);
  const goal = useRef({ target, rotY });
  goal.current = { target, rotY };
  // Compte, côté interface, les cartes arrivées à leur place (et retire la carte si elle disparaît avant, ou à la fin).
  const landed = useRef(false);
  useEffect(
    () => () => {
      if (landed.current)
        useDealt.setState((d) => ({ landed: Math.max(0, d.landed - 1) }));
    },
    [],
  );
  useFrame((_, delta) => {
    const g = group.current;
    // Le temps ne court qu'une fois les cartes arrivées sur la table (le groupe des cartes descend du ciel au début).
    // ... et le croupier doit être relevé : c'est de sa main que la carte part.
    if (
      tableSequence.elapsed > T_CARDS + 0.6 &&
      tableSequence.dealerReady &&
      tableSequence.handReady
    )
      time.current += delta;
    if (
      !dealt.current &&
      time.current >= delay - DEAL_LEAD &&
      time.current > 0
    ) {
      dealt.current = true;
      onDeal?.();
    }
    const p = MathUtils.clamp((time.current - delay) / DEAL_SECONDS, 0, 1);
    if (p >= 1 && !landed.current) {
      landed.current = true;
      useDealt.setState((d) => ({ landed: d.landed + 1 }));
    }
    const held = dealt.current && time.current < delay;
    g.visible = dealt.current;
    const { target: to, rotY: ry } = goal.current;
    if (held) {
      // Prise dans le sabot : la carte apparaît dans la main gauche du croupier et la suit.
      const h = tableSequence.hand;
      launch.current = [h.x, h.y, h.z];
      g.position.set(h.x, h.y, h.z);
      g.rotation.y = DEALER_FACING + Math.PI;
    } else if (p < 1) {
      const e = 1 - Math.pow(1 - p, 3);
      const [fx, fy, fz] = launch.current;
      // La carte quitte la main, se pose aussitôt sur le feutre (le premier tiers du trajet) et glisse jusqu'à sa place en ralentissant.
      const drop = 1 - Math.pow(1 - Math.min(1, p * 3), 2);
      g.position.set(
        MathUtils.lerp(fx, to[0], e),
        MathUtils.lerp(fy, to[1], drop),
        MathUtils.lerp(fz, to[2], e),
      );
      // Rotation par le plus court chemin.
      const from = DEALER_FACING + Math.PI;
      const d = Math.atan2(Math.sin(ry - from), Math.cos(ry - from));
      g.rotation.y = from + d * e;
    } else {
      const k = 1 - Math.exp(-10 * delta);
      g.position.x += (to[0] - g.position.x) * k;
      g.position.y += (to[1] - g.position.y) * k;
      g.position.z += (to[2] - g.position.z) * k;
      const d = Math.atan2(
        Math.sin(ry - g.rotation.y),
        Math.cos(ry - g.rotation.y),
      );
      g.rotation.y += d * k;
    }
  });
  return (
    <group
      ref={group}
      visible={Boolean(startAt)}
      position={startAt}
      rotation-y={startRot}
    >
      {children}
    </group>
  );
}

/** Flèche blanche, à plat, pointe vers l'arrière : sa pointe est en y positif (le plan est ensuite couché sur la table). */
const ARROW_SHAPE = (() => {
  const shape = new Shape();
  shape.moveTo(0, 0.1); // pointe
  shape.lineTo(0.075, 0.015);
  shape.lineTo(0.03, 0.015);
  shape.lineTo(0.03, -0.1);
  shape.lineTo(-0.03, -0.1);
  shape.lineTo(-0.03, 0.015);
  shape.lineTo(-0.075, 0.015);
  shape.closePath();
  return shape;
})();

/** Flèche 2D blanche posée sur la table, devant la main dont le croupier attend la décision ; elle pointe vers cette main et avance un peu à chaque battement. */
function TurnArrow({
  at,
  topY,
  shift,
  facing,
  cards,
}: {
  at: [number, number];
  topY: number;
  /** Décalage latéral de la main visée (deux mains après une séparation). */
  shift: number;
  facing: number;
  /** Nombre de cartes de la main visée : la cascade avance vers le centre, la flèche recule devant elle. */
  cards: number;
}) {
  const group = useRef<Group>(null!);
  // Côté centre de la table : la flèche est posée là et pointe vers la main (vers le joueur).
  const toCenter = [Math.sin(facing), Math.cos(facing)] as const;
  const side = [Math.cos(facing), -Math.sin(facing)] as const;
  useFrame(({ clock }) => {
    const push =
      0.34 +
      Math.max(0, cards - 2) * CARD_LENGTH * 0.4 -
      (Math.sin(clock.elapsedTime * 5) * 0.5 + 0.5) * 0.05;
    group.current.position.set(
      at[0] + toCenter[0] * push + side[0] * shift,
      topY + 0.006,
      at[1] + toCenter[1] * push + side[1] * shift,
    );
  });
  return (
    <group ref={group} rotation-y={facing}>
      <mesh rotation-x={-Math.PI / 2} renderOrder={3}>
        <shapeGeometry args={[ARROW_SHAPE]} />
        <meshBasicMaterial
          color="#ffffff"
          side={DoubleSide}
          toneMapped={false}
          polygonOffset
          polygonOffsetFactor={-2}
        />
      </mesh>
    </group>
  );
}

/** Taille des jetons KayKit (diamètre 3 unités) sur la table : un peu plus larges qu'une demi-carte. */
const CHIP_SCALE = 0.034;
const CHIP_HEIGHT = 0.3 * CHIP_SCALE;
/** Jetons posés devant la main, côté centre de la table : une pile par valeur (jusqu'à 8 jetons), côte à côte. */
function ChipStack({
  at,
  topY,
  facing,
  chips,
}: {
  at: [number, number];
  topY: number;
  facing: number;
  chips: string;
}) {
  const stacks = parseChips(chips);
  const toCenter = [Math.sin(facing), Math.cos(facing)] as const;
  const side = [Math.cos(facing), -Math.sin(facing)] as const;
  return (
    <group>
      {stacks.map(([value, count], s) => {
        // Piles alignées latéralement et centrées sur la main.
        const lateral = (s - (stacks.length - 1) / 2) * 0.11;
        const x = at[0] + side[0] * lateral;
        const z = at[1] + side[1] * lateral;
        return Array.from({ length: Math.min(8, count) }, (_, i) => (
          <Kit
            key={`${value}-${i}`}
            file={CHIP_STYLE[value]!.file}
            dir={`${DIR}chips/`}
            position={[
              x + Math.sin(i * 2.3 + s) * 0.004,
              topY + CHIP_HEIGHT / 2 + i * CHIP_HEIGHT,
              z + Math.cos(i * 1.9 + s) * 0.004,
            ]}
            rotation={i * 0.9}
            scale={CHIP_SCALE}
          />
        ));
      })}
    </group>
  );
}

/** Sabot : pile de cartes face cachée à côté du croupier, légèrement désordonnée. */
function Deck({
  at,
  facing,
  topY,
}: {
  at: [number, number];
  facing: number;
  topY: number;
}) {
  const wobble = [
    0.03, -0.05, 0.04, -0.02, 0.05, -0.04, 0.02, -0.03, 0.04, -0.01,
  ];
  return (
    <>
      {wobble.map((tilt, i) => (
        <group
          key={i}
          position={[
            at[0] + Math.sin(i * 2.1) * 0.012,
            topY + 0.01 + i * 0.009,
            at[1] + Math.cos(i * 1.7) * 0.012,
          ]}
          rotation-y={facing + Math.PI + tilt}
        >
          <KayCard />
        </group>
      ))}
    </>
  );
}

function Hand({
  cards,
  hidden = 0,
  at,
  facing,
  topY,
  row = false,
  round,
  rank,
  players,
  dealTo,
  onDeal,
  shift = 0,
  immediate = false,
  splitFrom = false,
}: {
  cards: CardSnapshot[];
  hidden?: number;
  at: [number, number];
  facing: number;
  topY: number;
  /** Numéro de manche : une nouvelle manche redistribue toutes les cartes depuis le sabot. */
  round: number;
  /** Rang du joueur dans l'ordre des places (0 : premier servi), ou -1 pour le croupier. */
  rank: number;
  /** Nombre de joueurs assis, hors croupier. */
  players: number;
  /** Place du joueur servi par cette main, ou null pour le croupier. */
  dealTo: number | null;
  /** Le croupier commence à distribuer une carte à cette place (null : à lui-même). */
  onDeal: (seat: number | null) => void;
  /** Cartes côte à côte (croupier) au lieu d'empilées en cascade (joueurs). */
  row?: boolean;
  /** Décalage latéral de la main (deux mains côte à côte après une séparation). */
  shift?: number;
  /** Cartes distribuées tout de suite, l'une après l'autre (seconde main d'une séparation), hors distribution initiale. */
  immediate?: boolean;
  /** Seconde main d'une séparation : sa première carte était la seconde carte de la première main (elle glisse, sans nouvelle distribution). */
  splitFrom?: boolean;
}) {
  const total = cards.length + hidden;
  // Les cartes s'empilent en cascade, dans le sens de leur longueur : chaque nouvelle carte se pose par-dessus la précédente,
  // un peu plus loin du joueur (la première, celle du dessous, est la plus proche de lui), et laisse voir l'indice de celle d'en dessous. Léger décalage et angle d'une carte à l'autre.
  const upX = Math.sin(facing);
  const upZ = Math.cos(facing);
  const sideX = Math.cos(facing);
  const sideZ = -Math.sin(facing);
  const step = CARD_LENGTH * 0.4;
  // Place qu'occupait la seconde carte de la main avant la séparation (sans décalage latéral).
  const slideFrom: [number, number, number] = [
    at[0] + upX * (0.5 * step) + sideX * 0.012,
    topY + 0.01 + 0.006,
    at[1] + upZ * (0.5 * step) + sideZ * 0.012,
  ];
  return (
    <>
      {Array.from({ length: total }, (_, i) => {
        // Croupier : cartes droites (non tournées), alignées côte à côte le long du côté plat de la table.
        // Joueur : la première carte reste en place (position de la main de départ à 2 cartes), les suivantes s'ajoutent plus loin
        // sans déplacer les précédentes.
        const along = row ? 0 : (i - 0.5) * step;
        // Croupier : la première carte est la plus proche du sabot (à sa main gauche), les suivantes sont dévoilées vers la gauche de l'écran.
        const side = row
          ? ROW_START + i * ROW_PITCH
          : (i % 2 === 0 ? -1 : 1) * 0.012 + shift;
        const tilt = row ? 0 : (i % 2 === 0 ? 1 : -1) * 0.05;
        return (
          <DealtCard
            // La seconde carte de la première main (tirée après la séparation) est une nouvelle carte : nouvelle clé, elle est distribuée.
            key={`${round}${immediate && i === 1 ? "s" : ""}-${i}`}
            startAt={splitFrom && i === 0 ? slideFrom : undefined}
            startRot={facing + Math.PI - 0.05}
            target={[
              at[0] + upX * along + sideX * side,
              topY + 0.01 + i * 0.006,
              at[1] + upZ * along + sideZ * side,
            ]}
            rotY={facing + Math.PI + tilt}
            // Règle de la distribution : une carte à chaque joueur (dans l'ordre des places), une au croupier (face visible),
            // puis une seconde carte à chaque joueur, enfin la seconde du croupier (face cachée). Les cartes suivantes (tirées) partent tout de suite.
            delay={
              DEAL_LEAD +
              (immediate
                ? (i + (shift > 0 ? 1 : 0)) * DEAL_STEP
                : i < 2
                  ? (i * (players + 1) + (rank < 0 ? players : rank)) *
                    DEAL_STEP
                  : 0)
            }
            onDeal={() => onDeal(dealTo)}
          >
            <KayCard card={cards[i]} />
          </DealtCard>
        );
      })}
    </>
  );
}

/**
 * Arrivée de la table : d'abord la table, puis les tabourets l'un après l'autre, puis les cartes, enfin le croupier qui tombe
 * (secondes après le départ de la partie ; les meubles de la chambre s'envolent pendant les 2 premières secondes).
 */
const T_TABLE = 2.4;
const T_STOOLS = 3.5;
const T_STOOL_STEP = 0.12;
const T_CARDS = 4.7;
const T_DEALER = 5.1;
const DROP_HEIGHT = 10;
/** Après l'impact : Death_A (0,8 s) puis une courte pause au sol, avant Sit_Floor_StandUp (1,13 s). */
const DEATH_SECONDS = 1.3;
const GET_UP_SECONDS = 1.2;

/** Hauteur au-dessus de sa place de chaque tabouret (0 : posé) : les joueurs assis y descendent avec lui. */
export const tableSequence = {
  stool: Array.from({ length: BLACKJACK_TABLE.seats }, () => DROP_HEIGHT),
  /** Secondes depuis le départ de la partie (0 hors partie) : sert aux collisions avec la table. */
  elapsed: 0,
  /** Place où flotte la bulle « Appuyez sur E » (pouf libre à portée, ou sa propre place pour se lever) et sa hauteur. */
  /** Le joueur local est assis à la table : la caméra passe en vue de dessus. */
  seated: false,
  /** Main gauche du croupier (repère de la table) : la carte distribuée y apparaît avant de partir. */
  hand: { x: 0, y: 0.9, z: 0 },
  /** Le croupier est tombé, s'est relevé et peut distribuer. */
  dealerReady: false,
  /** Position de la main du croupier mesurée et crédible. */
  handReady: false,
  promptSeat: null as number | null,
  promptY: 0.55,
};

export function BlackjackTable({
  show,
  litSeat,
}: {
  show: boolean;
  litSeat: number | null;
}) {
  const tableRef = useRef<Group>(null!);
  const stoolRefs = useRef<(Group | null)[]>([]);
  const cardsRef = useRef<Group>(null!);
  const dealerRef = useRef<Group>(null!);
  const tableP = useRef(0);
  const stoolP = useRef<number[]>(
    Array.from({ length: BLACKJACK_TABLE.seats }, () => 0),
  );
  const cardsP = useRef(0);
  const dealer = useRef({ y: DROP_HEIGHT, v: 0, risen: 0 });
  const elapsed = useRef(0);
  /** Secondes écoulées depuis l'arrêt de la partie (0 pendant la partie). */
  const leave = useRef(0);
  /** La table a été montrée : seul un jeu réellement joué la fait repartir (pas à l'arrivée dans la chambre). */
  const wasShown = useRef(false);
  const liveSnapshot = useChamber((s) => s.snapshot);
  // À l'arrêt, le salon remet la table à zéro tout de suite : on garde la dernière image de la partie le temps que tout s'envole.
  const lastSnapshot = useRef(liveSnapshot);
  if (show) lastSnapshot.current = liveSnapshot;
  const snapshot = show ? liveSnapshot : lastSnapshot.current;
  const dealerPose = useRef<AvatarPose>({
    moving: false,
    emote: null,
    calm: true,
    hideName: true,
  });
  const bj = snapshot?.blackjack;
  // La flèche n'apparaît qu'une fois toutes les cartes distribuées.
  const landedCards = useDealt((d) => d.landed);
  const previewChips = useBetPreview((d) => d.chips);
  const mySession = useChamber((s) => s.room?.sessionId);
  const expectedCards = bj
    ? Object.values(bj.players).reduce(
        (n, p) => n + p.cards.length + p.cards2.length,
        0,
      ) +
      bj.dealer.length +
      (bj.dealerHidden ? 1 : 0)
    : 0;
  const topY = 0.52;
  // Gestes du croupier : prend une carte (pour lui) ou l'envoie à un joueur, en se tournant vers lui.
  const dealerTurnRef = useRef<Group>(null!);
  const gesture = useRef({
    kind: null as "pick" | "throw" | "reveal" | null,
    yaw: TABLE_TURN,
    deckYaw: TABLE_TURN,
    start: 0,
    until: 0,
    tick: 0,
  });
  // Retournement de la carte cachée : le croupier lève la main, et la carte ne se retourne qu'au milieu du geste.
  const dealerHidden = bj?.dealerHidden ?? false;
  const [shownHidden, setShownHidden] = useState(dealerHidden);
  const revealing = shownHidden && !dealerHidden;
  const startGestureRef = useRef<
    (seat: number | null, reveal?: boolean) => void
  >(() => {});
  useEffect(() => {
    if (dealerHidden) {
      setShownHidden(true);
      return;
    }
    if (!shownHidden) return;
    startGestureRef.current(null, true);
    const id = setTimeout(
      () => setShownHidden(false),
      REVEAL_FLIP_SECONDS * 1000,
    );
    return () => clearTimeout(id);
  }, [dealerHidden, shownHidden]);
  const startGesture = (seat: number | null, reveal = false) => {
    const g = gesture.current;
    const px = BLACKJACK_TABLE.x - Math.sin(TABLE_TURN) * 0.2;
    const pz = BLACKJACK_TABLE.z - Math.cos(TABLE_TURN) * 0.2;
    // Il se tourne d'abord vers le sabot pour prendre la carte, puis vers sa destination (un joueur, ou sa propre rangée).
    const yawToward = (x: number, z: number) => {
      const toward = Math.atan2(x - px, z - pz);
      const diff = Math.atan2(
        Math.sin(toward - TABLE_TURN),
        Math.cos(toward - TABLE_TURN),
      );
      return TABLE_TURN + diff * DEAL_TURN_SHARE;
    };
    const target =
      seat === null
        ? {
            x: BLACKJACK_TABLE.x + Math.sin(TABLE_TURN) * 0.25,
            z: BLACKJACK_TABLE.z + Math.cos(TABLE_TURN) * 0.25,
          }
        : blackjackSeat(seat);
    g.kind = reveal ? "reveal" : seat === null ? "pick" : "throw";
    // Retourner sa carte : pas de sabot, il reste face à sa rangée.
    // Pour ses propres cartes (les poser ou en retourner une), il pivote légèrement vers sa droite (yaw négatif = vers sa droite).
    const own =
      seat === null ? yawToward(target.x, target.z) - DEAL_OWN_TURN : null;
    g.deckYaw = reveal ? own! : yawToward(DECK_AT[0], DECK_AT[1]);
    g.yaw = own ?? yawToward(target.x, target.z);
    g.start = performance.now();
    g.until = g.start + DEAL_GESTURE * 1000;
    g.tick++;
  };
  startGestureRef.current = startGesture;
  // Les 53 modèles de cartes se chargent en arrière-plan dès le début de la partie.
  useEffect(() => {
    if (show)
      for (const name of ALL_CARD_FILES)
        useLoader.preload(GLTFLoader, `${CARDS_DIR}${name}.gltf`);
  }, [show]);

  useFrame((_, delta) => {
    elapsed.current = show ? elapsed.current + delta : 0;
    if (show) wasShown.current = true;
    leave.current = show ? 0 : leave.current + delta;
    const away = leave.current;
    // Encore présent pendant le départ (jusqu'à `limit` secondes après l'arrêt) : faux si la table n'a jamais été montrée.
    const stay = (limit: number) => !show && wasShown.current && away < limit;
    if (!show && away > LEAVE_TABLE + 4) wasShown.current = false;
    const t = elapsed.current;
    tableSequence.elapsed = show ? t : 0;
    const gs = gesture.current;
    if (gs.kind && performance.now() > gs.until) gs.kind = null;
    // Main gauche du croupier dans le repère de la table (le groupe racine est posé à FLOOR_TOP).
    const hw = dealerPose.current.handWorld;
    if (hw) {
      tableSequence.hand.x = hw.x;
      tableSequence.hand.y = hw.y - FLOOR_TOP;
      tableSequence.hand.z = hw.z;
    }
    // La main n'est utilisable que mesurée et revenue au niveau de la table (pas encore en l'air ni à sa valeur par défaut).
    tableSequence.handReady =
      Boolean(hw) && tableSequence.dealerReady && hw!.y - FLOOR_TOP < 2;
    dealerPose.current.cardAction = gs.kind;
    dealerPose.current.cardTick = gs.tick;
    // Le croupier se tourne vers sa cible pendant le geste, puis revient face aux joueurs.
    const wantYaw = gs.kind
      ? performance.now() - gs.start < DEAL_PICK_SECONDS * 1000
        ? gs.deckYaw
        : gs.yaw
      : TABLE_TURN;
    const dy = Math.atan2(
      Math.sin(wantYaw - dealerTurnRef.current.rotation.y),
      Math.cos(wantYaw - dealerTurnRef.current.rotation.y),
    );
    dealerTurnRef.current.rotation.y += dy * (1 - Math.exp(-12 * delta));
    // Les éléments arrivent l'un après l'autre ; à la fin de la partie ils repartent tous tout de suite.
    tableP.current = MathUtils.damp(
      tableP.current,
      (show ? t > T_TABLE : stay(LEAVE_TABLE)) ? 1 : 0,
      show ? 2.2 : 3,
      delta,
    );
    tableRef.current.visible = tableP.current > 0.003;
    tableRef.current.position.y = (1 - tableP.current) * DROP_HEIGHT;

    for (let i = 0; i < BLACKJACK_TABLE.seats; i++) {
      stoolP.current[i] = MathUtils.damp(
        stoolP.current[i]!,
        (
          show
            ? t > T_STOOLS + i * T_STOOL_STEP
            : stay(LEAVE_STOOLS + i * LEAVE_STOOL_STEP)
        )
          ? 1
          : 0,
        show ? 3.2 : 4,
        delta,
      );
      const offset = (1 - stoolP.current[i]!) * DROP_HEIGHT;
      tableSequence.stool[i] = offset;
      const ref = stoolRefs.current[i];
      if (ref) {
        ref.position.y = offset;
        ref.visible = stoolP.current[i]! > 0.003;
      }
    }

    cardsP.current = MathUtils.damp(
      cardsP.current,
      (show ? t > T_CARDS : stay(LEAVE_CARDS)) ? 1 : 0,
      show ? 4 : 5,
      delta,
    );
    cardsRef.current.visible = cardsP.current > 0.003;
    cardsRef.current.position.y = (1 - cardsP.current) * DROP_HEIGHT;

    // Croupier : il tombe d'en haut (chute accélérée, pose de saut), s'effondre à l'impact (Death_A), puis se relève (Sit_Floor_StandUp).
    const d = dealer.current;
    if (show && t > T_DEALER) {
      if (d.y > 0) {
        d.v += 24 * delta;
        d.y = Math.max(0, d.y - d.v * delta);
      } else d.risen += delta;
    } else if (show) {
      d.y = DROP_HEIGHT;
      d.v = 0;
      d.risen = 0;
    } else if (away >= LEAVE_DEALER && d.y < DROP_HEIGHT) {
      // Fin de partie : le croupier remonte (accélération), puis disparaît.
      d.v += 24 * delta;
      d.y = Math.min(DROP_HEIGHT, d.y + d.v * delta);
      d.risen = 0;
    }
    const leaving = !show && d.y < DROP_HEIGHT;
    const falling = (show && t > T_DEALER && d.y > 0) || leaving;
    const landed = show && t > T_DEALER && d.y <= 0;
    dealerPose.current.fall = falling;
    dealerPose.current.death = landed && d.risen < DEATH_SECONDS;
    dealerPose.current.getUp =
      landed &&
      d.risen >= DEATH_SECONDS &&
      d.risen < DEATH_SECONDS + GET_UP_SECONDS;
    tableSequence.dealerReady =
      landed && d.risen >= DEATH_SECONDS + GET_UP_SECONDS;
    dealerRef.current.visible = (show && t > T_DEALER) || leaving;
    dealerRef.current.position.y = d.y;
  });

  const { x: cx, z: cz, facingDegrees } = BLACKJACK_TABLE;
  const turn = (facingDegrees * Math.PI) / 180;
  // Direction du centre de la table vers les joueurs.
  const dirX = Math.sin(turn);
  const dirZ = Math.cos(turn);
  // Joueurs assis, dans l'ordre des places (c'est l'ordre de service : à gauche du croupier d'abord).
  const seated = (bj ? Object.entries(bj.players) : [])
    .map(
      ([sessionId, player]) =>
        [sessionId, player, snapshot?.players[sessionId]?.seat ?? -1] as const,
    )
    .filter(([, , seat]) => seat >= 0)
    .sort((a, b) => b[2] - a[2]);
  // Cartes du croupier : alignées sur le côté droit (plat) de la table, côté croupier.
  const dealerFacing = turn + Math.PI;
  return (
    <group position-y={FLOOR_TOP}>
      <group ref={tableRef} visible={false}>
        <group position={[cx, 0, cz]} rotation-y={turn}>
          <TableA />
        </group>
      </group>

      {/* Croupier : derrière le côté plat, dans le coin du fond, face aux joueurs */}
      <group ref={dealerRef} visible={false}>
        <group
          ref={dealerTurnRef}
          position={[cx - dirX * 0.2, 0, cz - dirZ * 0.2]}
          rotation-y={turn}
        >
          <Avatar look={DEALER_LOOK} name="Croupier" pose={dealerPose} />
        </group>
      </group>

      {/* Tabourets : un par place, de dos au bord de la table */}
      {Array.from({ length: BLACKJACK_TABLE.seats }, (_, i) => {
        const seat = blackjackSeat(i);
        return (
          <group
            key={i}
            ref={(el) => {
              stoolRefs.current[i] = el;
            }}
            visible={false}
          >
            <Kit
              file="footstool_red"
              dir={DIR}
              position={[seat.x, 0, seat.z]}
              rotation={seat.facing + Math.PI}
              scale={KAYKIT_SCALE * 1.15}
              lit={litSeat === i}
              litScale={1.12}
            />
          </group>
        );
      })}

      {/* Cartes du croupier, puis de chaque joueur devant sa place */}
      <group ref={cardsRef} visible={false}>
        <Suspense fallback={null}>
          <Deck at={DECK_AT} facing={dealerFacing} topY={topY} />
          {bj && (
            <Hand
              cards={revealing ? bj.dealer.slice(0, -1) : [...bj.dealer]}
              hidden={bj.dealerHidden || revealing ? 1 : 0}
              at={[cx + dirX * 0.25, cz + dirZ * 0.25]}
              facing={dealerFacing}
              topY={topY}
              row
              round={bj.dealNo}
              rank={-1}
              players={seated.length}
              dealTo={null}
              onDeal={startGesture}
            />
          )}
          {seated.map(([sessionId, player, seatIndex], rank) => {
            const seat = blackjackSeat(seatIndex);
            const dx = seat.x - cx;
            const dz = seat.z - cz;
            const len = Math.hypot(dx, dz) || 1;
            return (
              <Fragment key={sessionId}>
                <Hand
                  cards={[...player.cards]}
                  at={[cx + (dx / len) * HAND_R, cz + (dz / len) * HAND_R]}
                  facing={seat.facing}
                  topY={topY}
                  round={bj?.dealNo ?? 0}
                  rank={rank}
                  players={seated.length}
                  dealTo={seatIndex}
                  onDeal={startGesture}
                  shift={player.cards2.length > 0 ? -SPLIT_SPACING : 0}
                  immediate={player.cards2.length > 0}
                />
                {player.cards2.length > 0 && (
                  // Seconde main (séparation) : à côté de la première.
                  <Hand
                    cards={[...player.cards2]}
                    at={[cx + (dx / len) * HAND_R, cz + (dz / len) * HAND_R]}
                    facing={seat.facing}
                    topY={topY}
                    round={(bj?.dealNo ?? 0) + 0.5}
                    rank={rank}
                    players={seated.length}
                    dealTo={seatIndex}
                    onDeal={startGesture}
                    shift={SPLIT_SPACING}
                    immediate
                    splitFrom
                  />
                )}
                {(player.bet + player.bet2 > 0 ||
                  (sessionId === mySession && previewChips.length > 0)) && (
                  <ChipStack
                    at={[cx + (dx / len) * CHIP_R, cz + (dz / len) * CHIP_R]}
                    topY={topY}
                    facing={seat.facing}
                    chips={
                      // Jetons exacts de la mise ; à défaut (serveur plus ancien), découpe de la mise en jetons.
                      (player.bet + player.bet2 === 0
                        ? previewChips.join(",")
                        : [player.chips, player.chips2]
                            .filter(Boolean)
                            .join(",")) ||
                      chipsList(player.bet + player.bet2, BLACKJACK_CHIPS)
                    }
                  />
                )}
                {bj?.stage === "playing" &&
                  bj.turn === sessionId &&
                  landedCards >= expectedCards && (
                    <TurnArrow
                      at={[cx + (dx / len) * HAND_R, cz + (dz / len) * HAND_R]}
                      topY={topY}
                      facing={seat.facing}
                      cards={
                        player.hand === 1
                          ? player.cards2.length
                          : player.cards.length
                      }
                      shift={
                        player.cards2.length > 0
                          ? player.hand === 1
                            ? SPLIT_SPACING
                            : -SPLIT_SPACING
                          : 0
                      }
                    />
                  )}
                <SeatName
                  name={snapshot?.players[sessionId]?.name ?? ""}
                  at={[cx + (dx / len) * 1.44, cz + (dz / len) * 1.44]}
                  facing={seat.facing}
                  y={0.514}
                />
              </Fragment>
            );
          })}
        </Suspense>
      </group>
    </group>
  );
}
