"use client";

import { useState, type FormEvent } from "react";
import { loginAsGuest, supabase } from "@/lib/session";
import { Button, Card, Input } from "./ui";

export function AuthPanel() {
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<string | null>) => {
    setBusy(true);
    setInfo(null);
    setError(await action());
    setBusy(false);
  };

  const guest = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name"));
    void run(() => loginAsGuest(name));
  };

  const account = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    const username = String(form.get("username")).trim();
    void run(async () => {
      if (!supabase) return null;
      // Pseudo renseigné = inscription, sinon connexion.
      const { data, error } = username
        ? await supabase.auth.signUp({ email, password, options: { data: { username } } })
        : await supabase.auth.signInWithPassword({ email, password });
      if (error) return error.message;
      if (username && !data.session) setInfo("Compte créé : confirmez votre e-mail pour vous connecter.");
      return null;
    });
  };

  const oauth = (provider: "google" | "discord") =>
    run(async () => {
      const { error } = await supabase!.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin } });
      return error?.message ?? null;
    });

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <h2 className="text-2xl">Jouer en invité</h2>
        <p className="mt-1 text-sm text-ink/70">Un pseudo suffit. La progression n'est pas conservée.</p>
        <form onSubmit={guest} className="mt-4 flex flex-col gap-3">
          <label className="text-sm font-bold" htmlFor="guest-name">
            Pseudo
          </label>
          <Input id="guest-name" name="name" required minLength={3} maxLength={16} placeholder="Ex. Pixel_Pat" autoComplete="nickname" />
          <Button type="submit" variant="accent" disabled={busy}>
            Entrer
          </Button>
        </form>
      </Card>

      <Card>
        <h2 className="text-2xl">Compte {supabase ? "" : "(indisponible)"}</h2>
        {supabase ? (
          <>
            <form onSubmit={account} className="mt-4 flex flex-col gap-3">
              <label className="text-sm font-bold" htmlFor="acc-email">
                E-mail
              </label>
              <Input id="acc-email" name="email" type="email" required autoComplete="email" />
              <label className="text-sm font-bold" htmlFor="acc-password">
                Mot de passe
              </label>
              <Input id="acc-password" name="password" type="password" required minLength={8} autoComplete="current-password" />
              <label className="text-sm font-bold" htmlFor="acc-username">
                Pseudo (seulement pour créer un compte)
              </label>
              <Input id="acc-username" name="username" minLength={3} maxLength={16} autoComplete="nickname" />
              <Button type="submit" disabled={busy}>
                Se connecter / S'inscrire
              </Button>
            </form>
            <div className="mt-3 flex gap-3">
              <Button variant="plain" disabled={busy} onClick={() => oauth("google")}>
                Google
              </Button>
              <Button variant="plain" disabled={busy} onClick={() => oauth("discord")}>
                Discord
              </Button>
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm text-ink/70">
            Les comptes (e-mail, Google, Discord) nécessitent Supabase. Renseignez <code>NEXT_PUBLIC_SUPABASE_URL</code> et{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> dans <code>apps/web/.env.local</code>.
          </p>
        )}
      </Card>

      <p role="alert" className="font-bold text-coral md:col-span-2">
        {error}
      </p>
      {info && <p className="font-bold md:col-span-2">{info}</p>}
    </div>
  );
}
