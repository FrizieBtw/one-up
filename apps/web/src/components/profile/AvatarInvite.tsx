"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/session";
import { useNav } from "@/lib/nav";
import { HudButton, HudPanel } from "../hud";

const SKIP_KEY = "stepup-avatar-invite-skipped";

/**
 * Proposition facultative de personnaliser son avatar, affichée tant que le compte n'en a pas.
 * « Plus tard » la masque sur cet appareil ; l'étape n'est jamais obligatoire.
 */
export function AvatarInvite({ userId }: { userId: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let skipped = false;
    try {
      skipped = localStorage.getItem(SKIP_KEY) === userId;
    } catch {
      // stockage indisponible : on affiche la proposition
    }
    if (skipped || !supabase) return;
    void supabase
      .from("avatar_configurations")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data, error }) => setVisible(!error && data === null));
  }, [userId]);

  if (!visible) return null;
  return (
    <HudPanel className="flex flex-wrap items-center gap-3 p-4">
      <p className="grow text-sm text-black">
        Bienvenue ! Personnalisez votre avatar pour vous reconnaître dans les
        salons. C'est facultatif.
      </p>
      <HudButton onClick={() => useNav.getState().openProfile("avatar")}>
        Personnaliser
      </HudButton>
      <HudButton
        variant="soft"
        onClick={() => {
          try {
            localStorage.setItem(SKIP_KEY, userId);
          } catch {
            // sans stockage, la proposition reviendra au prochain chargement
          }
          setVisible(false);
        }}
      >
        Plus tard
      </HudButton>
    </HudPanel>
  );
}
