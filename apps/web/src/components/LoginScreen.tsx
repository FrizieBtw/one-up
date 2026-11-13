"use client";

import dynamic from "next/dynamic";
import { useState, type FormEvent } from "react";
import { playerNameSchema } from "@stepup/shared";
import { loginAsGuest, supabase } from "@/lib/session";
import { HudButton, HudField, HudPanel, HudSegmented, type FieldState } from "./hud";
import { LogoLockup } from "./Logo";
import { DiscordMark, GoogleMark } from "./login/brandMarks";

// WebGL : rendu côté client uniquement.
const LoginDecor = dynamic(() => import("./login/LoginDecor"), { ssr: false });

type Mode = "in" | "up" | "guest";

const NAME_HINT = "3 à 16 caractères : lettres, chiffres, espace, - et _.";

/** Retour d'indication pour un pseudo : le format se vérifie ici, l'unicité reste à la charge du serveur. */
function nameFeedback(value: string): { state: FieldState; hint: string } {
  if (!value) return { state: undefined, hint: NAME_HINT };
  const parsed = playerNameSchema.safeParse(value);
  return parsed.success ? { state: "ok", hint: "Format valide." } : { state: "bad", hint: NAME_HINT };
}

/** Écran de connexion et d'inscription : carte blanche centrée sur le décor 3D pastel. */
export function LoginScreen() {
  const [mode, setMode] = useState<Mode>(supabase ? "in" : "guest");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [username, setUsername] = useState("");
  const [guestName, setGuestName] = useState("");
  const [password, setPassword] = useState("");

  const run = async (action: () => Promise<string | null>) => {
    setBusy(true);
    setInfo(null);
    setError(await action());
    setBusy(false);
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setInfo(null);
  };

  const guest = (e: FormEvent) => {
    e.preventDefault();
    if (!playerNameSchema.safeParse(guestName).success) return setError(NAME_HINT);
    void run(() => loginAsGuest(guestName));
  };

  const signIn = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const login = String(form.get("login")).trim();
    void run(async () => {
      if (!supabase) return null;
      // Seule l'adresse e-mail identifie un compte pour l'instant ; la connexion par pseudo demande un appel serveur dédié.
      if (!login) return "Entre ton adresse e-mail.";
      if (!login.includes("@")) return "La connexion par pseudo n'est pas encore disponible : entre ton adresse e-mail.";
      const { error } = await supabase.auth.signInWithPassword({ email: login, password });
      return error ? "Adresse e-mail ou mot de passe incorrect." : null;
    });
  };

  const signUp = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email")).trim();
    if (nameFeedback(username).state !== "ok") return setError(NAME_HINT);
    if (password.length < 8) return setError("Le mot de passe doit faire au moins 8 caractères.");
    void run(async () => {
      if (!supabase) return null;
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { username: username.trim() } } });
      if (error) return error.message;
      if (!data.session) setInfo("Compte créé : confirme ton adresse e-mail pour te connecter.");
      return null;
    });
  };

  const oauth = (provider: "google" | "discord") =>
    run(async () => {
      const { error } = await supabase!.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin } });
      return error?.message ?? null;
    });

  const revealToggle = (
    <button type="button" className="text-xs font-semibold text-hud-accent" onClick={() => setReveal((r) => !r)}>
      {reveal ? "Masquer" : "Afficher"}
    </button>
  );
  const passwordType = reveal ? "text" : "password";
  const name = nameFeedback(username);
  const guestFeedback = nameFeedback(guestName);

  return (
    <div className="fixed inset-0 overflow-y-auto bg-night">
      <LoginDecor />
      <div className="relative z-10 grid min-h-full place-items-center p-4">
        <HudPanel className="w-full max-w-[20rem] p-5">
          {/* « ! » : les titres h1 à h3 reçoivent une police globale non « layered » qui l'emporterait sans lui. */}
          <h1 className="mb-3.5 flex justify-center font-hud!">
            <LogoLockup />
          </h1>

          {mode === "guest" ? (
            <form onSubmit={guest} noValidate>
              <h2 className="mb-1 font-hud! text-[15px] font-semibold">Jouer en invité</h2>
              <p className="mb-2.5 text-xs text-hud-muted">Pas de jetons ni de boutique, et ta progression n'est pas sauvegardée.</p>
              <HudField
                id="guest-name"
                label="Pseudo"
                placeholder="Pixel_Pat"
                maxLength={16}
                autoComplete="nickname"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                state={guestFeedback.state}
                hint={guestFeedback.hint}
              />
              <HudButton type="submit" className="mt-1 h-10 w-full" disabled={busy}>
                Entrer
              </HudButton>
              {supabase && (
                <p className="mt-2.5 text-center text-[13px]">
                  <button type="button" className="font-semibold text-hud-accent" onClick={() => switchMode("in")}>
                    Retour
                  </button>
                </p>
              )}
            </form>
          ) : (
            <>
              <HudSegmented<"in" | "up">
                label="Connexion ou inscription"
                className="mb-3"
                value={mode}
                onChange={switchMode}
                options={[
                  { value: "in", label: "Connexion" },
                  { value: "up", label: "Créer un compte" },
                ]}
              />
              {mode === "in" ? (
                <form onSubmit={signIn} noValidate>
                  <HudField id="login" name="login" label="Pseudo ou e-mail" autoComplete="username" />
                  <HudField
                    id="password"
                    name="password"
                    label="Mot de passe"
                    type={passwordType}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    action={revealToggle}
                  />
                  <HudButton type="submit" className="mt-1 h-10 w-full" disabled={busy}>
                    Se connecter
                  </HudButton>
                </form>
              ) : (
                <form onSubmit={signUp} noValidate>
                  <HudField
                    id="signup-name"
                    label="Pseudo"
                    maxLength={16}
                    autoComplete="nickname"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    state={name.state}
                    hint={name.hint}
                  />
                  <HudField id="signup-email" name="email" label="Adresse e-mail" type="email" autoComplete="email" />
                  <HudField
                    id="signup-password"
                    label="Mot de passe"
                    type={passwordType}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    state={password ? (password.length >= 8 ? "ok" : "bad") : undefined}
                    hint={password.length >= 8 ? "Mot de passe valide." : "8 caractères minimum."}
                    action={revealToggle}
                  />
                  <HudButton type="submit" className="mt-1 h-10 w-full" disabled={busy}>
                    Créer mon compte
                  </HudButton>
                </form>
              )}

              <div className="my-2.5 flex items-center gap-2 text-xs text-[#9a97bd] before:h-px before:flex-1 before:bg-hud-divider after:h-px after:flex-1 after:bg-hud-divider">
                ou continuer avec
              </div>
              <div className="flex gap-2">
                <HudButton variant="outline" className="h-[38px] flex-1" disabled={busy} onClick={() => oauth("google")}>
                  <GoogleMark className="size-4" />
                  Google
                </HudButton>
                <HudButton variant="discord" className="h-[38px] flex-1" disabled={busy} onClick={() => oauth("discord")}>
                  <DiscordMark className="size-[18px]" />
                  Discord
                </HudButton>
              </div>
              <p className="mt-2.5 text-center text-[13px]">
                Pas envie de t'inscrire ?{" "}
                <button type="button" className="font-semibold text-hud-accent" onClick={() => switchMode("guest")}>
                  Jouer en invité
                </button>
              </p>
            </>
          )}

          {error && (
            <p role="alert" className="mt-2.5 rounded-[10px] bg-hud-bad-soft px-2.5 py-1.5 text-center text-xs text-hud-bad">
              {error}
            </p>
          )}
          {info && <p className="mt-2.5 rounded-[10px] bg-hud-ok-soft px-2.5 py-1.5 text-center text-xs text-hud-ok">{info}</p>}
          {!supabase && (
            <p className="mt-2.5 text-center text-[11.5px] text-hud-muted">
              Les comptes (e-mail, Google, Discord) demandent <code>NEXT_PUBLIC_SUPABASE_URL</code> et <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> dans{" "}
              <code>apps/web/.env.local</code>.
            </p>
          )}
        </HudPanel>
      </div>
    </div>
  );
}
