"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { PRESENCE_PING_SECONDS } from "@stepup/shared";
import { getGame } from "@stepup/shared";
import { joinChamber, resumeChamber } from "@/lib/chamber";
import { useNav } from "@/lib/nav";
import { useEconomy } from "@/lib/economy";
import { pingPresence } from "@/lib/social";
import { padBackPressed } from "@/lib/input";
import { DELETE_PENDING_KEY, useSession } from "@/lib/session";
import { ConsoleScreen } from "./ConsoleScreen";
import { HudHeader } from "./HudHeader";
import { LobbyScreen } from "./LobbyScreen";
import { LoginScreen } from "./LoginScreen";
import { RoomScreen } from "./RoomScreen";
import { AvatarInvite } from "./profile/AvatarInvite";
import { ProfileScreen } from "./profile/ProfileScreen";
import { SettingsPanel } from "./SettingsPanel";

/** Coquille unique de l'application : accueil, cartouche retournée et lobby partagent la même scène 3D. */
export function StepUpApp() {
  const session = useSession();
  const current = useNav((s) => s.view);
  // Paramètres, profil, boutique et console sont des fenêtres de même rang : une seule est affichée, la chambre reste derrière.
  const view = current;
  const profileTab = useNav((s) => s.profileTab);
  const code = useNav((s) => s.code);
  const selectedGame = useNav((s) =>
    s.view === "cartridge" && s.gameId ? getGame(s.gameId) : undefined,
  );

  useEffect(() => {
    const { syncFromUrl, back } = useNav.getState();
    syncFromUrl();
    // Retour d'une reconnexion demandée avant la suppression du compte : on rouvre les Paramètres.
    try {
      if (sessionStorage.getItem(DELETE_PENDING_KEY) === "1")
        useNav.getState().openSettings();
    } catch {}
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && back();
    window.addEventListener("popstate", syncFromUrl);
    // Exclu du salon par l'hôte : retour à sa propre chambre.
    const onKicked = () => useNav.getState().goHome();
    const onJoin = (e: Event) =>
      void joinChamber((e as CustomEvent<string>).detail);
    window.addEventListener("stepup:join", onJoin);
    window.addEventListener("stepup:kicked", onKicked);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("popstate", syncFromUrl);
      window.removeEventListener("stepup:kicked", onKicked);
      window.removeEventListener("stepup:join", onJoin);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // Manette : B ferme la fenêtre ouverte (console, profil, boutique, paramètres), comme Échap.
  useEffect(() => {
    const timer = setInterval(() => {
      if (!padBackPressed()) return;
      const { view: now, back } = useNav.getState();
      if (now === "home" || now === "profile" || now === "settings") back();
    }, 60);
    return () => clearInterval(timer);
  }, []);

  const signedIn = session.loaded && session.name !== null;

  // Après un rechargement de page : retour dans la chambre où l'on était.
  useEffect(() => {
    if (signedIn) void resumeChamber();
  }, [signedIn]);

  // Solde et objets du compte : chargés à la connexion, vidés à la déconnexion.
  useEffect(() => {
    if (session.userId) void useEconomy.getState().refresh(session.userId);
    else useEconomy.getState().reset();
  }, [session.userId]);

  // Un compte signale régulièrement qu'il est en ligne (les amis le voient selon ses réglages de confidentialité).
  useEffect(() => {
    if (session.kind !== "user") return;
    pingPresence();
    const timer = setInterval(pingPresence, PRESENCE_PING_SECONDS * 1000);
    return () => clearInterval(timer);
  }, [session.kind]);

  // Pas connecté : écran de connexion plein écran, sans l'en-tête de l'application.
  if (session.loaded && !session.name) return <LoginScreen />;

  return (
    <>
      {signedIn &&
        (view === "room" ||
          view === "home" ||
          view === "profile" ||
          view === "settings") && (
          <RoomScreen
            active={current === "room"}
            showPlayer={!(view === "profile" && profileTab === "avatar")}
          />
        )}

      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-5 pt-24 pb-8">
        <HudHeader />

        {!session.loaded ? (
          <p aria-busy="true">Chargement…</p>
        ) : view === "lobby" && code ? (
          <LobbyScreen />
        ) : view === "profile" ? (
          session.userId ? (
            <ProfileScreen
              userId={session.userId}
              onHome={() => useNav.getState().goHome()}
            />
          ) : (
            <p role="alert" className="font-bold">
              Le profil est réservé aux comptes. Les invités n'ont pas de
              progression enregistrée.
            </p>
          )
        ) : view === "settings" ? (
          <SettingsPanel onClose={() => useNav.getState().closeSettings()} />
        ) : view === "home" ? (
          <ConsoleScreen />
        ) : (
          <div className="relative z-10">
            {session.userId && <AvatarInvite userId={session.userId} />}
          </div>
        )}
      </main>
    </>
  );
}
