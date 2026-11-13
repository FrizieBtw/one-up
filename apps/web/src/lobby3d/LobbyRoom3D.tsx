"use client";

import type { Room } from "@colyseus/sdk";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { MathUtils, type Group } from "three";
import {
  EMOTE_DURATION_MS,
  LOBBY_RADIUS,
  parseAvatarConfig,
  parseCosmetics,
  stepLobbyPosition,
  type ClientMessage,
  type EmoteId,
  type LobbyPlayerSnapshot,
  type ServerMessages,
} from "@stepup/shared";
import { Avatar, lookFromId, type AvatarPose } from "@/avatar/Avatar";
import { attachInput, readGamepadPresses, readMove } from "@/lib/input";
import { availableEmotes, useEconomy } from "@/lib/economy";
import { useNav } from "@/lib/nav";

const MOVE_SEND_INTERVAL_MS = 50;

/** Emotes en cours, par session. Alimenté par les messages serveur, lu à chaque image. */
type EmoteMap = Map<string, { id: EmoteId; until: number }>;

type LivePlayers = { get(sessionId: string): LobbyPlayerSnapshot | undefined };

function AvatarEntity({ room, sessionId, isLocal, connected, emotes }: { room: Room; sessionId: string; isLocal: boolean; connected: boolean; emotes: EmoteMap }) {
  const group = useRef<Group>(null!);
  const pose = useRef<AvatarPose>({ moving: false, emote: null });
  const local = useRef({ placed: false, sentX: 0, sentZ: 0, sentAt: 0 });
  // Identité et nom ne changent pas pendant la vie d'une session.
  const initial = (room.state.players as LivePlayers).get(sessionId);
  const look = useMemo(() => parseAvatarConfig(initial?.avatar) ?? lookFromId(initial?.id ?? sessionId), [initial?.avatar, initial?.id, sessionId]);

  const cosmetics = useMemo(() => parseCosmetics(initial?.cosmetics), [initial?.cosmetics]);

  useFrame((_, delta) => {
    const player = (room.state.players as LivePlayers).get(sessionId);
    if (!player) return;
    const g = group.current;
    const state = local.current;
    if (!state.placed) {
      g.position.set(player.x, 0, player.z);
      state.placed = true;
    }

    let dirX = player.dx;
    let dirZ = player.dz;
    if (isLocal) {
      // Prédiction locale : même fonction de déplacement que le serveur, puis rappel doux vers sa position.
      const blocked = useNav.getState().settingsOpen;
      const move = blocked ? { x: 0, z: 0 } : readMove();
      dirX = move.x;
      dirZ = move.z;
      const position = { x: g.position.x, z: g.position.z };
      stepLobbyPosition(position, move, delta);
      const moving = dirX !== 0 || dirZ !== 0;
      const pull = Math.min(1, delta * (moving ? 1.5 : 8));
      g.position.x = MathUtils.lerp(position.x, player.x, pull);
      g.position.z = MathUtils.lerp(position.z, player.z, pull);

      // On n'envoie que les changements de direction, à cadence bornée (l'arrêt part tout de suite).
      const now = performance.now();
      const changed = Math.abs(move.x - state.sentX) > 0.02 || Math.abs(move.z - state.sentZ) > 0.02;
      if (changed && (!moving || now - state.sentAt >= MOVE_SEND_INTERVAL_MS)) {
        room.send("move", { x: move.x, z: move.z } satisfies ClientMessage<"move">);
        state.sentX = move.x;
        state.sentZ = move.z;
        state.sentAt = now;
      }
    } else {
      // Autres joueurs : interpolation vers la position serveur.
      g.position.x = MathUtils.damp(g.position.x, player.x, 12, delta);
      g.position.z = MathUtils.damp(g.position.z, player.z, 12, delta);
    }

    const moving = dirX !== 0 || dirZ !== 0;
    if (moving) {
      const target = Math.atan2(dirX, dirZ);
      const diff = Math.atan2(Math.sin(target - g.rotation.y), Math.cos(target - g.rotation.y));
      g.rotation.y += diff * Math.min(1, delta * 12);
    }
    const emote = emotes.get(sessionId);
    pose.current.moving = moving;
    pose.current.emote = emote && emote.until > performance.now() ? emote.id : null;
  });

  return (
    <group ref={group}>
      <Avatar look={look} name={initial?.name} pose={pose} faded={!connected} cosmetics={cosmetics} />
    </group>
  );
}

const PILLAR_COLORS = ["#6c3bf5", "#14c4bd", "#ff8a1f", "#ff5c6c", "#ffd23f", "#3fa7ff"];

/** Salle sociale stylisée : une scène ronde aux couleurs de StepUp. */
function RoomDecor() {
  const outer = LOBBY_RADIUS + 0.7;
  return (
    <group>
      <mesh position-y={-0.2}>
        <cylinderGeometry args={[outer, outer + 0.25, 0.4, 64]} />
        <meshStandardMaterial color="#4a22c4" roughness={0.7} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.001}>
        <circleGeometry args={[outer - 0.15, 64]} />
        <meshStandardMaterial color="#ffe9b8" roughness={0.9} />
      </mesh>
      {[LOBBY_RADIUS * 0.85, LOBBY_RADIUS * 0.57, LOBBY_RADIUS * 0.29].map((radius, i) => (
        <mesh key={radius} rotation-x={-Math.PI / 2} position-y={0.004 + i * 0.001}>
          <ringGeometry args={[radius - 0.09, radius, 64]} />
          <meshBasicMaterial color={["#14c4bd", "#ff8a1f", "#6c3bf5"][i]} />
        </mesh>
      ))}
      {PILLAR_COLORS.map((color, i) => {
        const angle = (i / PILLAR_COLORS.length) * Math.PI * 2 + Math.PI / 6;
        const x = Math.cos(angle) * (outer - 0.1);
        const z = Math.sin(angle) * (outer - 0.1);
        return (
          <group key={color} position={[x, 0, z]}>
            <mesh position-y={0.45}>
              <cylinderGeometry args={[0.2, 0.26, 0.9, 20]} />
              <meshStandardMaterial color={color} roughness={0.5} />
            </mesh>
            <mesh position-y={1.12}>
              <sphereGeometry args={[0.27, 20, 16]} />
              <meshStandardMaterial color="#fff4dc" roughness={0.4} emissive={color} emissiveIntensity={0.25} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** Raccourcis d'emotes : touches 1 à 4, ou boutons de façade de la manette. */
function useEmoteShortcuts(room: Room) {
  useEffect(() => {
    const send = (index: number) => {
      const emote = availableEmotes(useEconomy.getState())[index];
      if (emote) room.send("emote", { id: emote.id } satisfies ClientMessage<"emote">);
    };
    const detach = attachInput((code) => {
      const digit = /^(?:Digit|Numpad)([1-6])$/.exec(code);
      if (digit) send(Number(digit[1]) - 1);
    });
    const poll = setInterval(() => readGamepadPresses().forEach((button) => button < 4 && send(button)), 50);
    return () => {
      detach();
      clearInterval(poll);
    };
  }, [room]);
}

/** `players` : sessions présentes et leur état de connexion (le reste est lu en direct dans l'état du salon). */
export default function LobbyRoom3D({ room, players }: { room: Room; players: { sessionId: string; connected: boolean }[] }) {
  const emotes = useMemo<EmoteMap>(() => new Map(), []);
  useEmoteShortcuts(room);
  useEffect(
    () =>
      room.onMessage("emote", ({ sessionId, id }: ServerMessages["emote"]) => {
        emotes.set(sessionId, { id, until: performance.now() + EMOTE_DURATION_MS });
      }),
    [room, emotes],
  );

  return (
    <Canvas
      aria-hidden
      className="rise-in !pointer-events-none !fixed inset-0 z-0"
      camera={{ fov: 32, position: [0, 13, 17] }}
      onCreated={({ camera }) => camera.lookAt(0, 0.4, 0.4)}
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true }}
    >
      <ambientLight intensity={1.5} />
      <directionalLight position={[4, 10, 6]} intensity={2} />
      <RoomDecor />
      {players.map(({ sessionId, connected }) => (
        <AvatarEntity key={sessionId} room={room} sessionId={sessionId} isLocal={sessionId === room.sessionId} connected={connected} emotes={emotes} />
      ))}
    </Canvas>
  );
}
