"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Identity } from "@stepup/shared";
import { GAME_SERVER_URL, SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

/** null tant que Supabase n'est pas configuré : seul l'accès invité est alors proposé. */
export const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

interface GuestSession {
  token: string;
  identity: Identity;
}

const useGuest = create(
  persist<{
    guest: GuestSession | null;
    setGuest: (guest: GuestSession | null) => void;
  }>((set) => ({ guest: null, setGuest: (guest) => set({ guest }) }), {
    name: "stepup-guest",
  }),
);

export async function loginAsGuest(name: string): Promise<string | null> {
  const res = await fetch(`${GAME_SERVER_URL}/auth/guest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  }).catch(() => null);
  if (!res) return "Serveur de jeu injoignable.";
  if (res.status === 429)
    return "Trop de tentatives, réessayez dans une minute.";
  if (!res.ok)
    return "Pseudo invalide : 3 à 16 caractères (lettres, chiffres, espace, - et _).";
  useGuest.getState().setGuest(await res.json());
  return null;
}

/** Renvoyé par `deleteMyAccount` : il faut se reconnecter avant de supprimer le compte. */
export const REAUTH_REQUIRED = "REAUTH_REQUIRED";
/** Posé avant la reconnexion via un fournisseur (la page se recharge) : au retour, la suppression est proposée directement. */
export const DELETE_PENDING_KEY = "stepup-delete-pending";

/** Supprime définitivement le compte connecté (le serveur de jeu détient la clé d'administration). Renvoie un message d'erreur, ou null. */
export async function deleteMyAccount(): Promise<string | null> {
  const token = await getAuthToken();
  if (!token) return "Tu n'es pas connecté.";
  const res = await fetch(`${GAME_SERVER_URL}/account`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!res) return "Serveur de jeu injoignable.";
  if (res.status === 403) return REAUTH_REQUIRED;
  return res.ok ? null : "La suppression a échoué, réessaie.";
}

export async function logout() {
  useGuest.getState().setGuest(null);
  await supabase?.auth.signOut();
}

/** Jeton présenté au serveur de jeu : compte Supabase en priorité, sinon invité. */
export async function getAuthToken(): Promise<string | null> {
  const session = (await supabase?.auth.getSession())?.data.session;
  return session?.access_token ?? useGuest.getState().guest?.token ?? null;
}

export interface SessionView {
  /** false pendant l'hydratation : ne rien afficher qui dépende de l'identité. */
  loaded: boolean;
  name: string | null;
  kind: Identity["kind"] | null;
  /** Identifiant du compte (comptes uniquement). */
  userId: string | null;
  /** Identifiant vu par le serveur de jeu (compte ou invité) : il tire l'apparence par défaut, la même pour tous les joueurs. */
  identityId: string | null;
}

export function useSession(): SessionView {
  const guest = useGuest((s) => s.guest);
  const [loaded, setLoaded] = useState(false);
  const [account, setAccount] = useState<{ id: string; name: string } | null>(
    null,
  );

  useEffect(() => {
    if (!supabase) return setLoaded(true);
    const client = supabase;
    const sync = async (userId: string | undefined) => {
      if (!userId) return setAccount(null);
      const { data } = await client
        .from("profiles")
        .select("username")
        .eq("id", userId)
        .single();
      setAccount(data?.username ? { id: userId, name: data.username } : null);
    };
    client.auth
      .getSession()
      .then(({ data }) =>
        sync(data.session?.user.id).finally(() => setLoaded(true)),
      );
    const { data } = client.auth.onAuthStateChange(
      (_event, session) => void sync(session?.user.id),
    );
    return () => data.subscription.unsubscribe();
  }, []);

  if (account)
    return {
      loaded,
      name: account.name,
      kind: "user",
      userId: account.id,
      identityId: account.id,
    };
  return {
    loaded,
    name: guest?.identity.name ?? null,
    kind: guest ? "guest" : null,
    userId: null,
    identityId: guest?.identity.id ?? null,
  };
}
