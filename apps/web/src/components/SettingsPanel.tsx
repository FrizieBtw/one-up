"use client";

import { useEffect, useState, type ReactNode } from "react";
import { playerNameSchema, type PresenceVisibility } from "@stepup/shared";
import { useAudio } from "@/lib/audio";
import { useDisplay } from "@/lib/display";
import { readGamepadPresses } from "@/lib/input";
import {
  ACTIONS,
  PAD_INDEX,
  keyLabel,
  useKeybinds,
  useLayoutMap,
  type Action,
  type PadButton,
} from "@/lib/keybinds";
import {
  DELETE_PENDING_KEY,
  REAUTH_REQUIRED,
  deleteMyAccount,
  logout,
  supabase,
  useSession,
} from "@/lib/session";
import {
  DEFAULT_PRIVACY,
  loadMyProfile,
  savePrivacy,
  type Privacy,
} from "@/lib/social";
import { DiscordMark, GoogleMark } from "./login/brandMarks";
import { HudButton, HudField, HudOverlay, HudSegmented } from "./hud";
import { ControllerIcon, EscapeHint, KeyIcon } from "./inputPrompts";

type Section =
  "graphics" | "sound" | "controls" | "privacy" | "account" | "room";

const Title = ({ children }: { children: ReactNode }) => (
  <h3 className="mb-1.5 font-hud! text-lg font-semibold text-black">
    {children}
  </h3>
);

/** Ligne de réglage : libellé (et précision) à gauche, commande à droite, filet dessous. */
function Row({
  label,
  hint,
  last,
  children,
}: {
  label: string;
  hint?: string;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 px-0.5 py-[11px] text-sm text-black ${last ? "" : "border-b border-hud-divider"}`}
    >
      <div>
        {label}
        {hint && (
          <small className="block text-[11.5px] font-normal text-hud-muted">
            {hint}
          </small>
        )}
      </div>
      {children}
    </div>
  );
}

function Switch({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-[23px] w-10 shrink-0 rounded-full transition-colors ${on ? "bg-hud-accent" : "bg-hud-line"}`}
    >
      <span
        className={`absolute top-[3px] size-[17px] rounded-full bg-white transition-all ${on ? "left-[20px]" : "left-[3px]"}`}
      />
    </button>
  );
}

const seg =
  "w-auto [&_button]:flex-none [&_button]:px-2.5 [&_button]:py-1 [&_button]:text-xs [&_button]:whitespace-nowrap";

function Sound() {
  const audio = useAudio();
  const { musicOn, setMusicOn, chatOverlay, setChatOverlay } = useDisplay();
  return (
    <div>
      <Title>Son</Title>
      <Row label="Effets sonores">
        <Switch
          label="Effets sonores"
          on={!audio.muted}
          onChange={(on) => audio.setMuted(!on)}
        />
      </Row>
      <Row label="Volume des effets">
        <input
          type="range"
          aria-label="Volume des effets sonores"
          className="w-[130px] accent-hud-accent"
          min={0}
          max={100}
          disabled={audio.muted}
          value={Math.round(audio.sfxVolume * 100)}
          onChange={(e) => audio.setSfxVolume(Number(e.target.value) / 100)}
        />
      </Row>
      <Row label="Musique">
        <Switch label="Musique" on={musicOn} onChange={setMusicOn} />
      </Row>
      <Row
        label="Messages du chat à l'écran"
        hint="Les messages disparaissent au bout de quelques secondes."
        last
      >
        <Switch
          label="Messages du chat à l'écran"
          on={chatOverlay}
          onChange={setChatOverlay}
        />
      </Row>
    </div>
  );
}

/** Graphismes : le décor 3D flottant du fond (désactivable pour économiser la machine). */
function Graphics() {
  const { floatingDecor, setFloatingDecor } = useDisplay();
  return (
    <div>
      <Title>Graphismes</Title>
      <Row
        label="Éléments 3D en arrière-plan"
        hint="Les objets flottants derrière les écrans. Désactivez-les pour alléger l'affichage."
        last
      >
        <Switch
          label="Éléments 3D en arrière-plan"
          on={floatingDecor}
          onChange={setFloatingDecor}
        />
      </Row>
    </div>
  );
}

const PAD_LABEL: Record<PadButton, string> = {
  a: "A",
  b: "B",
  x: "X",
  y: "Y",
  lb: "LB",
  rb: "RB",
  lt: "LT",
  rt: "RT",
  view: "Vue",
  menu: "Menu",
};
const FIXED_PAD = {
  up: "Stick gauche : haut",
  down: "Stick gauche : bas",
  left: "Stick gauche : gauche",
  right: "Stick gauche : droite",
} as const;

/** Tableau Action / Clavier / Manette : un clic sur une touche ou un bouton le remplace. Les déplacements de la manette sont fixes. */
function Controls() {
  const { keys, pad, setKey, setPad, reset } = useKeybinds();
  const layout = useLayoutMap();
  const [listening, setListening] = useState<{
    action: Action;
    device: "key" | "pad";
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!listening) return;
    if (listening.device === "key") {
      const onKey = (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.code === "Escape") return setListening(null);
        const clash = ACTIONS.find(
          (a) => a.id !== listening.action && keys[a.id] === e.code,
        );
        if (clash)
          setMessage(
            `« ${keyLabel(e.code, layout)} » est déjà utilisée pour « ${clash.label} ».`,
          );
        else {
          setKey(listening.action, e.code);
          setMessage(null);
        }
        setListening(null);
      };
      window.addEventListener("keydown", onKey, true);
      return () => window.removeEventListener("keydown", onKey, true);
    }
    readGamepadPresses(); // vide les appuis en attente
    const poll = setInterval(() => {
      const index = readGamepadPresses().find((i) =>
        Object.values(PAD_INDEX).includes(i),
      );
      const button = (Object.keys(PAD_INDEX) as PadButton[]).find(
        (b) => PAD_INDEX[b] === index,
      );
      if (button) {
        setPad(listening.action, button);
        setListening(null);
      }
    }, 50);
    return () => clearInterval(poll);
  }, [listening, keys, layout, setKey, setPad]);

  const cell =
    "justify-self-center flex h-[42px] w-16 items-center justify-center rounded-[10px] border-[1.5px] border-hud-line bg-white p-1 shadow-[0_2px_0_#cfcbe8] hover:bg-hud-field";
  const on = "border-hud-accent! bg-hud-soft! shadow-[0_2px_0_#6f5be0]!";

  return (
    <div>
      <Title>Commandes</Title>
      <p className="mb-1.5 text-xs text-hud-muted">
        Clique une touche ou un bouton pour le remplacer. Les déplacements de la
        manette (stick gauche) sont fixes.
      </p>
      <div role="table" aria-label="Commandes">
        <div
          role="row"
          className="grid grid-cols-[1fr_96px_96px] items-center border-b-2 border-hud-divider pb-1 text-xs font-semibold text-hud-muted"
        >
          <div role="columnheader">Action</div>
          <div role="columnheader" className="text-center">
            Clavier
          </div>
          <div role="columnheader" className="text-center">
            Manette
          </div>
        </div>
        {ACTIONS.map((a) => {
          const waitingKey =
            listening?.action === a.id && listening.device === "key";
          const waitingPad =
            listening?.action === a.id && listening.device === "pad";
          const button = pad[a.id];
          return (
            <div
              key={a.id}
              role="row"
              className="grid grid-cols-[1fr_96px_96px] items-center border-b border-hud-divider py-[5px] text-sm text-black"
            >
              <div role="cell">{a.label}</div>
              <div role="cell" className="grid">
                <button
                  type="button"
                  aria-label={`Remplacer la touche : ${a.label}`}
                  className={`${cell} ${waitingKey ? on : ""}`}
                  onClick={() => setListening({ action: a.id, device: "key" })}
                >
                  {waitingKey ? (
                    <span className="grid h-8 min-w-8 place-items-center rounded-lg bg-hud-accent px-1.5 font-hud text-lg font-semibold text-white">
                      …
                    </span>
                  ) : (
                    <KeyIcon
                      code={keys[a.id]}
                      printed={layout?.get(keys[a.id])}
                      label={keyLabel(keys[a.id], layout)}
                    />
                  )}
                </button>
              </div>
              <div role="cell" className="grid">
                {a.fixedPad ? (
                  <span
                    title="Fixe"
                    className="grid h-[42px] w-16 place-items-center justify-self-center rounded-[10px] bg-[#eceaf2]"
                  >
                    <ControllerIcon
                      button={a.fixedPad}
                      label={FIXED_PAD[a.fixedPad]}
                      fixed
                    />
                  </span>
                ) : (
                  <button
                    type="button"
                    aria-label={`Remplacer le bouton : ${a.label}`}
                    className={`${cell} ${waitingPad ? on : ""}`}
                    onClick={() =>
                      setListening({ action: a.id, device: "pad" })
                    }
                  >
                    {waitingPad ? (
                      <span className="grid h-8 min-w-8 place-items-center rounded-lg bg-hud-accent px-1.5 font-hud text-lg font-semibold text-white">
                        …
                      </span>
                    ) : button ? (
                      <ControllerIcon
                        button={button}
                        label={PAD_LABEL[button]}
                      />
                    ) : null}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p role="status" className="mt-1 min-h-4 text-xs text-hud-bad">
        {message}
      </p>
      <HudButton className="mt-1.5 h-10 px-5" onClick={reset}>
        Rétablir les commandes par défaut
      </HudButton>
    </div>
  );
}

const PRESENCE: { value: PresenceVisibility; label: string }[] = [
  { value: "friends", label: "Amis" },
  { value: "everyone", label: "Tout le monde" },
  { value: "nobody", label: "Personne" },
];

/** Confidentialité : chaque réglage est enregistré dès qu'on le change. */
function PrivacySection({ userId }: { userId: string }) {
  const [privacy, setPrivacy] = useState<Privacy | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    loadMyProfile(userId).then(
      (p) => setPrivacy(p.privacy),
      (e: Error) => setStatus(e.message),
    );
  }, [userId]);

  const update = async (next: Privacy) => {
    setPrivacy(next);
    setStatus(null);
    try {
      await savePrivacy(userId, next);
      setStatus("Réglages enregistrés.");
    } catch (e) {
      setStatus((e as Error).message);
    }
  };
  const value = privacy ?? DEFAULT_PRIVACY;

  return (
    <div>
      <Title>Confidentialité</Title>
      <Row label="Qui voit si je suis en ligne">
        <HudSegmented
          label="Qui voit si je suis en ligne"
          className={seg}
          value={value.presence}
          onChange={(v) => void update({ ...value, presence: v })}
          options={PRESENCE}
        />
      </Row>
      <Row label="Demandes d'ami">
        <HudSegmented
          label="Demandes d'ami"
          className={seg}
          value={value.friend_requests}
          onChange={(v) => void update({ ...value, friend_requests: v })}
          options={[
            { value: "everyone", label: "Tout le monde" },
            { value: "nobody", label: "Personne" },
          ]}
        />
      </Row>
      <Row label="Statistiques visibles sur mon profil" last>
        <Switch
          label="Statistiques visibles sur mon profil"
          on={value.show_stats !== "nobody"}
          onChange={(on) =>
            void update({ ...value, show_stats: on ? "everyone" : "nobody" })
          }
        />
      </Row>
      <p role="status" className="mt-1 min-h-4 text-xs text-hud-muted">
        {status}
      </p>
    </div>
  );
}

const PROVIDERS = [
  { id: "google", label: "Google", Mark: GoogleMark },
  { id: "discord", label: "Discord", Mark: DiscordMark },
] as const;

type Result = { ok: boolean; text: string } | null;

/** Message d'état sous un formulaire : vert si c'est réussi, rouge sinon. */
function Feedback({ result }: { result: Result }) {
  if (!result) return null;
  return (
    <p
      role="status"
      className={`mt-1 text-xs font-semibold ${result.ok ? "text-hud-ok" : "text-hud-bad"}`}
    >
      {result.text}
    </p>
  );
}

// Dernières informations connues du compte : la page s'affiche complète tout de suite à la réouverture.
let accountInfo: { email: string | null; linked: string[] } | null = null;

/** Pseudo, e-mail, mot de passe et comptes liés (comptes uniquement). */
function AccountDetails({ name }: { name: string }) {
  const [email, setEmail] = useState<string | null>(accountInfo?.email ?? null);
  const [linked, setLinked] = useState<string[]>(accountInfo?.linked ?? []);
  const [username, setUsername] = useState(name);
  const [nameResult, setNameResult] = useState<Result>(null);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordResult, setPasswordResult] = useState<Result>(null);
  const [linkResult, setLinkResult] = useState<Result>(null);

  const apply = (mail: string | null, providers: string[]) => {
    accountInfo = { email: mail, linked: providers };
    setEmail(mail);
    setLinked(providers);
  };
  const load = async () => {
    if (!supabase) return;
    // D'abord la session locale (immédiate, sans réseau), puis la confirmation du serveur.
    const local = (await supabase.auth.getSession()).data.session?.user;
    if (local)
      apply(
        local.email ?? null,
        local.identities?.map((i) => i.provider) ?? [],
      );
    const [{ data: user }, { data: identities }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.auth.getUserIdentities(),
    ]);
    apply(
      user.user?.email ?? null,
      identities?.identities.map((i) => i.provider) ?? [],
    );
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => setUsername(name), [name]);

  const saveName = async () => {
    const parsed = playerNameSchema.safeParse(username);
    if (!parsed.success)
      return setNameResult({
        ok: false,
        text: "3 à 16 caractères : lettres, chiffres, espace, - et _.",
      });
    if (parsed.data === name) return setNameResult(null);
    const { data: user } = await supabase!.auth.getUser();
    const { error } = await supabase!
      .from("profiles")
      .update({ username: parsed.data })
      .eq("id", user.user!.id);
    if (error)
      return setNameResult({
        ok: false,
        text:
          error.code === "23505"
            ? "Ce pseudo est déjà pris."
            : "Pseudo non modifié, réessaie.",
      });
    await supabase!.auth.refreshSession(); // la session relit le profil : le nouveau pseudo apparaît partout
    setNameResult({ ok: true, text: "Pseudo modifié." });
  };

  // Les comptes créés via Google ou Discord seulement n'ont pas (encore) de mot de passe à confirmer.
  const hasPassword = linked.includes("email");

  const savePassword = async () => {
    if (hasPassword) {
      if (!email)
        return setPasswordResult({
          ok: false,
          text: "Adresse e-mail introuvable.",
        });
      const { error: wrong } = await supabase!.auth.signInWithPassword({
        email,
        password: current,
      });
      if (wrong)
        return setPasswordResult({
          ok: false,
          text: "Mot de passe actuel incorrect.",
        });
    }
    if (password.length < 8)
      return setPasswordResult({
        ok: false,
        text: "Le mot de passe doit faire au moins 8 caractères.",
      });
    if (password !== confirm)
      return setPasswordResult({
        ok: false,
        text: "Les deux mots de passe ne correspondent pas.",
      });
    const { error } = await supabase!.auth.updateUser({ password });
    if (error) return setPasswordResult({ ok: false, text: error.message });
    setCurrent("");
    setPassword("");
    setConfirm("");
    setPasswordResult({ ok: true, text: "Mot de passe modifié." });
  };

  const link = async (provider: "google" | "discord") => {
    setLinkResult(null);
    const { error } = await supabase!.auth.linkIdentity({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (error) setLinkResult({ ok: false, text: error.message });
  };

  const unlink = async (provider: string) => {
    setLinkResult(null);
    const { data } = await supabase!.auth.getUserIdentities();
    const identity = data?.identities.find((i) => i.provider === provider);
    if (!identity) return;
    const { error } = await supabase!.auth.unlinkIdentity(identity);
    if (error) return setLinkResult({ ok: false, text: error.message });
    await load();
  };

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3 border-b border-hud-divider py-[11px]">
        <div>
          <div className="flex items-end gap-2">
            <HudField
              id="account-username"
              label="Pseudo"
              maxLength={16}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mb-0! min-w-0 flex-1"
            />
            <HudButton
              className="h-[38px] px-3 text-[13px]"
              onClick={() => void saveName()}
            >
              Enregistrer
            </HudButton>
          </div>
          <Feedback result={nameResult} />
        </div>
        <div>
          <p className="mb-0.5 text-xs font-semibold text-hud-ink">
            E-mail du compte
          </p>
          <p className="flex h-[38px] items-center truncate rounded-[11px] border-[1.5px] border-transparent bg-hud-field px-3 text-sm text-hud-muted">
            {email ?? "Aucune adresse e-mail"}
          </p>
        </div>
      </div>

      <div className="border-b border-hud-divider py-[11px]">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
          {hasPassword && (
            <HudField
              id="account-password-current"
              label="Mot de passe actuel"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="mb-1"
            />
          )}
          <HudField
            id="account-password"
            label="Nouveau mot de passe"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mb-1"
          />
          <HudField
            id="account-password-confirm"
            label="Confirmer le mot de passe"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mb-1"
          />
        </div>
        <HudButton className="h-10 px-5" onClick={() => void savePassword()}>
          Changer le mot de passe
        </HudButton>
        <Feedback result={passwordResult} />
      </div>

      <div className="border-b border-hud-divider py-[11px]">
        <p className="mb-1.5 text-xs font-semibold text-hud-ink">
          Comptes liés
        </p>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-3">
          {PROVIDERS.map(({ id, label, Mark }) => {
            const isLinked = linked.includes(id);
            return (
              <div
                key={id}
                className="flex items-center justify-between gap-2 rounded-[11px] bg-hud-field px-3 py-2 text-sm text-black"
              >
                <span className="flex items-center gap-2">
                  <Mark className="size-5" />
                  <span>
                    {label}
                    <small className="block text-[11.5px] text-hud-muted">
                      {isLinked ? "Lié" : "Non lié"}
                    </small>
                  </span>
                </span>
                {isLinked ? (
                  <HudButton
                    variant="soft"
                    className="px-3 py-1.5"
                    disabled={linked.length < 2}
                    onClick={() => void unlink(id)}
                  >
                    Dissocier
                  </HudButton>
                ) : (
                  <HudButton
                    className="px-3 py-1.5"
                    onClick={() => void link(id)}
                  >
                    Lier
                  </HudButton>
                )}
              </div>
            );
          })}
        </div>
        <Feedback result={linkResult} />
      </div>
    </>
  );
}

const pendingDelete = () => {
  try {
    return sessionStorage.getItem(DELETE_PENDING_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * Suppression définitive du compte, après une reconnexion : le mot de passe pour un compte qui en a un, sinon une
 * reconnexion via Google ou Discord (la page se recharge, puis la suppression est proposée). Le serveur exige aussi
 * une authentification de moins de 5 minutes.
 */
function DeleteAccount({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(pendingDelete);
  const [typed, setTyped] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const [providers, setProviders] = useState<string[]>([]);
  const [hasPassword, setHasPassword] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [returned, setReturned] = useState(pendingDelete);

  useEffect(() => {
    if (!open || !supabase) return;
    void Promise.all([
      supabase.auth.getUser(),
      supabase.auth.getUserIdentities(),
    ]).then(([{ data: user }, { data: identities }]) => {
      setEmail(user.user?.email ?? null);
      const list = identities?.identities.map((i) => i.provider) ?? [];
      setProviders(list.filter((p) => p === "google" || p === "discord"));
      setHasPassword(list.includes("email"));
    });
  }, [open]);

  if (!open)
    return (
      <HudButton
        className="h-10 bg-hud-bad! px-5 text-white!"
        onClick={() => setOpen(true)}
      >
        Supprimer mon compte
      </HudButton>
    );

  const cancel = () => {
    try {
      sessionStorage.removeItem(DELETE_PENDING_KEY);
    } catch {}
    setReturned(false);
    setOpen(false);
  };

  const reconnect = async (provider: "google" | "discord") => {
    try {
      sessionStorage.setItem(DELETE_PENDING_KEY, "1");
    } catch {}
    const { error: failure } = await supabase!.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (failure) setError(failure.message);
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    if (hasPassword) {
      const { error: wrong } = await supabase!.auth.signInWithPassword({
        email: email ?? "",
        password: typed,
      });
      if (wrong) {
        setBusy(false);
        return setError("Mot de passe incorrect.");
      }
    }
    const failure = await deleteMyAccount();
    setBusy(false);
    if (failure === REAUTH_REQUIRED) {
      setReturned(false);
      return setError("Reconnecte-toi pour confirmer la suppression.");
    }
    if (failure) return setError(failure);
    try {
      sessionStorage.removeItem(DELETE_PENDING_KEY);
    } catch {}
    onDone();
  };

  return (
    <div
      role="alertdialog"
      aria-label="Supprimer mon compte"
      className="w-full rounded-[11px] border-[1.5px] border-hud-bad-line bg-hud-bad-soft p-3"
    >
      <p className="mb-2 text-sm font-semibold text-hud-bad">
        Cette action est définitive.
      </p>
      {hasPassword ? (
        <HudField
          id="delete-confirm"
          label="Entre ton mot de passe pour confirmer"
          type="password"
          autoComplete="current-password"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="mb-2"
        />
      ) : returned ? (
        <p className="mb-2 text-xs text-black">
          Reconnexion réussie : tu peux confirmer la suppression.
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs text-black">
            Pour confirmer, reconnecte-toi avec ton compte lié.
          </p>
          <div className="mb-2 flex gap-2">
            {PROVIDERS.filter((p) => providers.includes(p.id)).map(
              ({ id, label, Mark }) => (
                <HudButton
                  key={id}
                  variant="outline"
                  className="h-10 gap-2 px-4"
                  onClick={() => void reconnect(id)}
                >
                  <Mark className="size-4" />
                  {label}
                </HudButton>
              ),
            )}
          </div>
        </>
      )}
      <div className="flex gap-2">
        {(hasPassword || returned) && (
          <HudButton
            className="h-10 bg-hud-bad! px-5 text-white!"
            disabled={busy || (hasPassword && typed === "")}
            onClick={() => void confirm()}
          >
            Supprimer définitivement
          </HudButton>
        )}
        <HudButton
          variant="outline"
          className="h-10 px-5"
          disabled={busy}
          onClick={cancel}
        >
          Annuler
        </HudButton>
      </div>
      {error && (
        <p role="status" className="mt-1 text-xs font-semibold text-hud-bad">
          {error}
        </p>
      )}
    </div>
  );
}

function Account({ onClose }: { onClose: () => void }) {
  const session = useSession();
  return (
    <div>
      <Title>Compte</Title>
      {session.kind === "user" && supabase ? (
        <AccountDetails name={session.name ?? ""} />
      ) : (
        <Row label="Pseudo" hint={`${session.name ?? ""} · invité`}>
          <span />
        </Row>
      )}
      <div className="flex gap-2 py-[11px]">
        <HudButton
          className="h-10 bg-hud-bad! px-5 text-white!"
          onClick={() => {
            onClose();
            void logout();
          }}
        >
          Se déconnecter
        </HudButton>
      </div>
      {session.kind === "user" && supabase && (
        <section
          className="mt-3 border-t border-hud-divider pt-4"
          aria-labelledby="danger-title"
        >
          <h4
            id="danger-title"
            className="mb-1 font-hud! text-sm font-semibold text-hud-bad"
          >
            Zone dangereuse
          </h4>
          <p className="mb-3 text-xs text-hud-muted">
            Supprimer ton compte efface définitivement ton personnage, tes
            jetons, tes achats, ta progression et ta liste d'amis. Cette action
            est irréversible.
          </p>
          <DeleteAccount
            onDone={() => {
              onClose();
              void logout();
            }}
          />
        </section>
      )}
    </div>
  );
}

/** Chambre : accès et capacité (réservés à l'hôte). La chambre est solo pour l'instant : le code n'existe que dans un salon. */
function RoomSection() {
  const { roomAccess, setRoomAccess } = useDisplay();
  return (
    <div>
      <Title>Chambre</Title>
      <p className="mb-1 text-xs text-hud-muted">Réservé à l'hôte.</p>
      <Row label="Accès">
        <HudSegmented
          label="Accès"
          className={seg}
          value={roomAccess}
          onChange={setRoomAccess}
          options={[
            { value: "closed", label: "Fermée" },
            { value: "public", label: "Publique" },
            { value: "friends", label: "Amis seulement" },
          ]}
        />
      </Row>
    </div>
  );
}

/** Paramètres, en panneau sur la chambre : Compte, Chambre, Son, Graphismes, Commandes et Confidentialité (comptes). */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const session = useSession();
  const [section, setSection] = useState<Section>("account");

  const sections: [Section, string][] = [
    ["account", "Compte"],
    ["room", "Chambre"],
    ["sound", "Son"],
    ["graphics", "Graphismes"],
    ["controls", "Commandes"],
    ...(session.userId
      ? ([["privacy", "Confidentialité"]] as [Section, string][])
      : []),
  ];

  return (
    <HudOverlay
      compact
      role="dialog"
      aria-label="Paramètres"
      className="h-[min(580px,calc(100dvh-108px))] w-[min(900px,calc(100vw-2rem))]"
    >
      <div className="flex w-40 shrink-0 flex-col border-r border-hud-divider p-3">
        <h2 className="mb-2 px-2 font-hud! text-lg font-semibold text-black">
          Paramètres
        </h2>
        <div
          role="tablist"
          aria-label="Sections des paramètres"
          aria-orientation="vertical"
          className="flex flex-col gap-1"
        >
          {sections.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={section === id}
              onClick={() => setSection(id)}
              className={`rounded-[11px] px-3 py-2 text-left font-hud text-[13px] font-semibold ${section === id ? "bg-hud-accent text-white" : "text-black"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <EscapeHint className="mt-auto px-1 pt-3" />
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-5">
        {section === "sound" && <Sound />}
        {section === "graphics" && <Graphics />}
        {section === "controls" && <Controls />}
        {section === "privacy" && session.userId && (
          <PrivacySection userId={session.userId} />
        )}
        {section === "account" && <Account onClose={onClose} />}
        {section === "room" && <RoomSection />}
      </div>
    </HudOverlay>
  );
}
