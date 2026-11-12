"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/session";
import { useNav } from "@/lib/nav";
import { Button, Card } from "../ui";

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
    <Card className="flex flex-wrap items-center gap-4 bg-sun">
      <p className="grow font-bold">Bienvenue ! Personnalisez votre avatar pour vous reconnaître dans les salons. C'est facultatif.</p>
      <Button variant="primary" onClick={() => useNav.getState().openProfile()}>
        Personnaliser
      </Button>
      <Button
        variant="plain"
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
      </Button>
    </Card>
  );
}
