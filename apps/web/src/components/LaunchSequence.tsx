"use client";

import { useEffect } from "react";
import { CONSOLE_ANCHOR, PORT_ABOVE_ANCHOR, PORT_IN_ANCHOR, anchor } from "@/cartridge/anchors";
import { playSfx } from "@/lib/audio";
import { useNav } from "@/lib/nav";
import { Button } from "./ui";

const APPROACH_MS = 900;
const INSERT_MS = 1000;

/**
 * Lancement de partie : la cartouche quitte le coin, la console apparaît, la cartouche s'insère.
 * La séquence ne démarre qu'une fois la partie confirmée par le serveur, et ne se termine que
 * lorsque la scène de jeu est réellement chargée (`gameReady`), que l'animation soit passée ou non.
 */
export function LaunchSequence({ title }: { title: string }) {
  const launch = useNav((s) => s.launch);
  const gameReady = useNav((s) => s.gameReady);
  const setLaunch = useNav((s) => s.setLaunch);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (launch === "approach") {
      const timer = setTimeout(() => setLaunch("insert"), reduced ? 0 : APPROACH_MS);
      return () => clearTimeout(timer);
    }
    if (launch === "insert") {
      const sound = setTimeout(() => playSfx("insert"), reduced ? 0 : 300);
      const timer = setTimeout(() => setLaunch("loading"), reduced ? 0 : INSERT_MS);
      return () => {
        clearTimeout(sound);
        clearTimeout(timer);
      };
    }
    if (launch === "loading" && gameReady) {
      playSfx("ready");
      setLaunch("idle");
    }
  }, [launch, gameReady, setLaunch]);

  if (launch === "idle") return null;
  const cartridgeSlot = "pointer-events-none fixed left-1/2 aspect-[1/1.25] h-[min(34dvh,300px)] -translate-x-1/2 -translate-y-1/2";

  return (
    <>
      <div className="fixed inset-0 z-[15] bg-ink" />
      {/* Ancres suivies par la scène 3D : cartouche au-dessus du port, cartouche insérée, console. */}
      <div ref={anchor(PORT_ABOVE_ANCHOR)} className={`${cartridgeSlot} top-[24%]`} aria-hidden />
      <div ref={anchor(PORT_IN_ANCHOR)} className={`${cartridgeSlot} top-[44%]`} aria-hidden />
      <div ref={anchor(CONSOLE_ANCHOR)} className="pointer-events-none fixed left-1/2 top-[62%] aspect-[2/1] w-[min(62vw,540px)] -translate-x-1/2 -translate-y-1/2" aria-hidden />

      <div className="fixed inset-x-0 bottom-8 z-30 flex flex-col items-center gap-3">
        <p role="status" className="font-display text-2xl font-bold text-white">
          {launch === "loading" ? "Chargement du jeu…" : `Insertion de ${title}…`}
        </p>
        {launch !== "loading" && (
          <Button variant="plain" onClick={() => setLaunch("loading")}>
            Passer l'animation
          </Button>
        )}
      </div>
    </>
  );
}
