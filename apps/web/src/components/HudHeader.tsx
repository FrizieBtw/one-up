"use client";

import { useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { levelProgress, type AvatarConfig } from "@stepup/shared";
import { lookFromId } from "@/avatar/Avatar";
import { useEconomy } from "@/lib/economy";
import { useNav } from "@/lib/nav";
import { useSession } from "@/lib/session";
import { pfpBackground, useMyColor } from "@/lib/playerColor";
import { loadMyProfile } from "@/lib/social";
import { HudPanel } from "./hud";
import { DoorIcon, SettingsIcon, ShopIcon, TokensIcon } from "./icons";
import { LogoLockup } from "./Logo";

const AvatarPortrait = dynamic(
  () => import("./profile/AvatarPortrait").then((m) => m.AvatarPortrait),
  { ssr: false },
);

function Tab({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-hud text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${active ? "bg-hud-accent text-white" : "text-black"}`}
    >
      {children}
    </button>
  );
}

/** En-tête OneUP : logo, onglets Chambre / Boutique / Paramètres, encart de profil (pseudo, niveau, jetons). */
export function HudHeader() {
  const session = useSession();
  const current = useNav((s) => s.view);
  const previous = useNav((s) => s.previousView);
  const settingsOpen = current === "settings";
  const view = settingsOpen ? previous : current;
  const onSettings = () => useNav.getState().openSettings();
  const profileTab = useNav((s) => s.profileTab);
  const balance = useEconomy((s) => s.balance);
  const [xp, setXp] = useState<number | null>(null);
  const [avatar, setAvatar] = useState<AvatarConfig | null>(null);
  const myColor = useMyColor((s) => s.color);

  // Le niveau se relit à chaque changement d'écran : une partie jouée a pu faire gagner de l'expérience.
  useEffect(() => {
    if (!session.userId) {
      setAvatar(null);
      return setXp(null);
    }
    let live = true;
    loadMyProfile(session.userId).then(
      (p) => {
        if (!live) return;
        setXp(p.xp);
        useMyColor.getState().set(p.color);
        setAvatar(p.avatar ?? (lookFromId(session.userId!) as AvatarConfig));
      },
      () => live && setXp(null),
    );
    return () => {
      live = false;
    };
  }, [session.userId, view]);

  const logo = (
    <HudPanel className="flex items-center px-4 py-1.5">
      <LogoLockup compact />
    </HudPanel>
  );

  // Dans un salon, la cartouche réduite occupe le coin et quitter le salon n'est pas anodin : logo et paramètres seulement.
  if (view === "lobby")
    return (
      <header className="fixed top-4 left-4 z-10 flex items-center gap-3 pr-28">
        {logo}
        <HudPanel className="rounded-full p-[3px]">
          <Tab active={settingsOpen} onClick={onSettings}>
            <SettingsIcon /> Paramètres
          </Tab>
        </HudPanel>
      </header>
    );

  const isUser = session.kind === "user";
  const active = settingsOpen
    ? "settings"
    : view === "profile" && profileTab === "shop"
      ? "shop"
      : view === "room"
        ? "room"
        : null;
  const name = session.name ?? "";
  const level = xp === null ? null : levelProgress(xp).level;

  const identity = (
    <>
      <span
        className="grid size-[46px] shrink-0 place-items-center rounded-full font-hud text-lg font-semibold text-hud-ink"
        style={{ background: pfpBackground(name, myColor) }}
        aria-hidden
      >
        {avatar ? (
          <span className="relative block size-full overflow-hidden rounded-full">
            <AvatarPortrait config={avatar} className="size-full" />
          </span>
        ) : (
          name.slice(0, 1).toUpperCase()
        )}
      </span>
      <span className="block text-left">
        <span className="flex items-center gap-1 font-hud text-[15px] leading-tight font-semibold text-hud-ink">
          {name}
          <span className="rounded-lg bg-[#eceaff] px-1.5 py-px text-xs font-medium text-hud-accent">
            {isUser ? (level === null ? "…" : `Niv. ${level}`) : "Invité"}
          </span>
        </span>
        {isUser && (
          <span className="mt-0.5 flex items-center gap-1.5 text-[#e0a100]">
            <TokensIcon />
            <span className="font-hud text-sm leading-none font-medium text-hud-ink">
              {balance === null ? "…" : balance.toLocaleString("fr-FR")}
            </span>
          </span>
        )}
      </span>
    </>
  );

  return (
    <header className="fixed inset-x-4 top-4 z-10 grid grid-cols-[1fr_auto_1fr] items-start gap-3">
      <div className="justify-self-start">{logo}</div>
      <HudPanel className="rounded-full p-[3px]">
        <nav aria-label="Navigation" className="flex gap-0.5">
          <Tab
            active={active === "room"}
            onClick={() => useNav.getState().goHome()}
          >
            <DoorIcon /> Chambre
          </Tab>
          <Tab
            active={active === "shop"}
            disabled={!isUser}
            title={isUser ? undefined : "Réservé aux comptes"}
            onClick={() => useNav.getState().openProfile("shop")}
          >
            <ShopIcon /> Boutique
          </Tab>
          <Tab active={active === "settings"} onClick={onSettings}>
            <SettingsIcon /> Paramètres
          </Tab>
        </nav>
      </HudPanel>
      <div className="justify-self-end">
        {isUser ? (
          <button
            type="button"
            aria-label="Mon profil"
            onClick={() => useNav.getState().openProfile()}
            className="rounded-hud outline-2 outline-transparent hover:outline-hud-line"
          >
            <HudPanel className="flex items-center gap-2.5 py-1.5 pr-3.5 pl-1.5">
              {identity}
            </HudPanel>
          </button>
        ) : (
          <HudPanel className="flex items-center gap-2.5 py-1.5 pr-3.5 pl-1.5">
            {identity}
          </HudPanel>
        )}
      </div>
    </header>
  );
}
