"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { APP_NAME, getGame } from "@stepup/shared";
import { BIG_CARTRIDGE_CLASS, CENTER_ANCHOR, anchor } from "@/cartridge/anchors";
import { useAudio } from "@/lib/audio";
import { useNav } from "@/lib/nav";
import { logout, useSession } from "@/lib/session";
import { AuthPanel } from "./AuthPanel";
import { CartridgeBack } from "./CartridgeBack";
import { CartridgeGrid } from "./CartridgeGrid";
import { HomePanels } from "./HomePanels";
import { LobbyScreen } from "./LobbyScreen";
import { Badge, Button } from "./ui";

// WebGL : rendu côté client uniquement.
const CartridgeScene = dynamic(() => import("@/cartridge/CartridgeScene"), { ssr: false });

/** Coquille unique de l'application : accueil, cartouche retournée et lobby partagent la même scène 3D. */
export function StepUpApp() {
  const session = useSession();
  const view = useNav((s) => s.view);
  const code = useNav((s) => s.code);
  const selectedGame = useNav((s) => (s.view === "cartridge" && s.gameId ? getGame(s.gameId) : undefined));

  useEffect(() => {
    const { syncFromUrl, back } = useNav.getState();
    syncFromUrl();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && back();
    window.addEventListener("popstate", syncFromUrl);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("popstate", syncFromUrl);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const signedIn = session.loaded && session.name !== null;
  const audio = useAudio();

  return (
    <>
      {signedIn && <CartridgeScene />}
      <div ref={anchor(CENTER_ANCHOR)} className={`${BIG_CARTRIDGE_CLASS} pointer-events-none`} aria-hidden />

      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-5 py-8">
        <header className={`flex flex-wrap items-center gap-4 ${view === "lobby" ? "pr-28" : ""}`}>
          <h1 className="grow text-5xl text-violet [text-shadow:0_4px_0_var(--color-sun)]">{APP_NAME}</h1>
          {session.loaded && (
            <div className="flex items-center gap-2 text-sm font-bold">
              <button type="button" className="rounded-full border-2 border-ink bg-white px-3 py-0.5" aria-pressed={audio.muted} onClick={() => audio.setMuted(!audio.muted)}>
                {audio.muted ? "Son coupé" : "Son activé"}
              </button>
              <input
                type="range"
                aria-label="Volume des effets sonores"
                className="w-20 accent-violet"
                min={0}
                max={1}
                step={0.1}
                disabled={audio.muted}
                value={audio.sfxVolume}
                onChange={(e) => audio.setSfxVolume(Number(e.target.value))}
              />
            </div>
          )}
          {session.name && (
            <div className="flex items-center gap-3">
              <span className="font-bold">{session.name}</span>
              <Badge className={session.kind === "guest" ? "bg-sun" : "bg-turquoise"}>{session.kind === "guest" ? "Invité" : "Compte"}</Badge>
              {view !== "lobby" && (
                <Button variant="plain" onClick={() => void logout()}>
                  Déconnexion
                </Button>
              )}
            </div>
          )}
        </header>

        {!session.loaded ? (
          <p aria-busy="true">Chargement…</p>
        ) : !session.name ? (
          <AuthPanel />
        ) : view === "lobby" && code ? (
          <LobbyScreen key={code} code={code} />
        ) : (
          <CartridgeGrid />
        )}
      </main>

      {signedIn && selectedGame && (
        <CartridgeBack title={selectedGame.title} onClose={() => useNav.setState({ view: "home", gameId: null })}>
          <HomePanels game={selectedGame} />
        </CartridgeBack>
      )}
    </>
  );
}
