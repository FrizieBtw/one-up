"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { getGame, levelProgress, type AvatarConfig, type PresenceEntry, type PresenceVisibility } from "@stepup/shared";
import { lookFromId } from "@/avatar/Avatar";
import {
  DEFAULT_PRIVACY,
  cancelFriendRequest,
  fetchFriendsPresence,
  loadFriends,
  loadFriendsLeaderboard,
  loadGlobalLeaderboard,
  loadMyProfile,
  removeFriend,
  respondFriendRequest,
  saveAvatar,
  savePrivacy,
  searchProfiles,
  sendFriendRequest,
  type Friend,
  type FriendRequestOutcome,
  type FriendRequestView,
  type LeaderboardRow,
  type MyProfile,
  type Privacy,
  type SearchResult,
} from "@/lib/social";
import { Badge, Button, Card, Input } from "../ui";
import { AvatarEditor } from "./AvatarEditor";

const AvatarPreview = dynamic(() => import("./AvatarEditor").then((m) => m.AvatarPreview), { ssr: false });

const TABS = [
  ["profile", "Profil"],
  ["avatar", "Avatar"],
  ["friends", "Amis"],
  ["leaderboards", "Classements"],
  ["privacy", "Confidentialité"],
] as const;
type Tab = (typeof TABS)[number][0];

const PRESENCE_LABEL: Record<PresenceEntry["status"], string> = { online: "En ligne", lobby: "Dans un lobby", playing: "En partie", offline: "Hors ligne" };
const PRESENCE_STYLE: Record<PresenceEntry["status"], string> = { online: "bg-turquoise", lobby: "bg-sun", playing: "bg-orange", offline: "bg-white" };

function LevelBar({ xp }: { xp: number }) {
  const { level, into, needed } = levelProgress(xp);
  return (
    <div>
      <p className="font-display text-2xl">
        Niveau {level} <span className="text-base font-bold text-ink/70">· {xp} XP</span>
      </p>
      <div role="progressbar" aria-label="Progression vers le niveau suivant" aria-valuemin={0} aria-valuemax={needed} aria-valuenow={into} className="mt-1 h-4 overflow-hidden rounded-full border-3 border-ink bg-cream">
        <div className="h-full bg-turquoise" style={{ width: `${(into / needed) * 100}%` }} />
      </div>
      <p className="mt-0.5 text-xs font-bold text-ink/70">
        {into} / {needed} XP avant le niveau {level + 1}
      </p>
    </div>
  );
}

export function ProfileScreen({ userId, onHome }: { userId: string; onHome: () => void }) {
  const [tab, setTab] = useState<Tab>("profile");
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [friends, setFriends] = useState<{ friends: Friend[]; requests: FriendRequestView[] } | null>(null);

  const reload = useCallback(
    () => loadMyProfile(userId).then(setProfile, (e: Error) => setError(e.message)),
    [userId],
  );
  const reloadFriends = useCallback(
    () => loadFriends(userId).then(setFriends, (e: Error) => setError(e.message)),
    [userId],
  );
  useEffect(() => {
    void reload();
    void reloadFriends();
  }, [reload, reloadFriends]);

  if (error) {
    return (
      <Card>
        <p role="alert" className="font-bold text-coral">
          {error}
        </p>
        <Button className="mt-3" onClick={onHome}>
          Retour à l'accueil
        </Button>
      </Card>
    );
  }
  if (!profile) return <p aria-busy="true">Chargement du profil…</p>;

  const avatar = profile.avatar ?? (lookFromId(userId) as AvatarConfig);
  const pending = friends?.requests.filter((r) => r.direction === "incoming").length ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="grow text-4xl text-violet">{profile.username}</h2>
        <Button variant="plain" onClick={onHome}>
          Retour aux jeux
        </Button>
      </div>

      <div role="tablist" aria-label="Sections du profil" className="flex flex-wrap gap-2">
        {TABS.map(([id, label]) => (
          <Button key={id} role="tab" aria-selected={tab === id} variant={tab === id ? "primary" : "plain"} className="!px-4 !py-1 !text-base" onClick={() => setTab(id)}>
            {label}
            {id === "friends" && pending > 0 && ` (${pending})`}
          </Button>
        ))}
      </div>

      <div role="tabpanel" aria-label={TABS.find(([id]) => id === tab)![1]}>
        {tab === "profile" && <ProfileTab profile={profile} avatar={avatar} />}
        {tab === "avatar" && <AvatarTab userId={userId} profile={profile} initial={avatar} onSaved={reload} />}
        {tab === "friends" && friends && <FriendsTab userId={userId} data={friends} onChange={reloadFriends} />}
        {tab === "leaderboards" && <LeaderboardsTab userId={userId} friends={friends?.friends ?? []} />}
        {tab === "privacy" && <PrivacyTab userId={userId} initial={profile.privacy} onSaved={reload} />}
      </div>
    </div>
  );
}

function ProfileTab({ profile, avatar }: { profile: MyProfile; avatar: AvatarConfig }) {
  const stats = profile.stats;
  return (
    <div className="grid gap-5 md:grid-cols-[18rem_1fr]">
      <Card className="flex flex-col items-center gap-2">
        <AvatarPreview config={avatar} name={profile.username} className="h-72 w-full" />
        <p className="text-sm font-bold text-ink/70">
          Identifiant <span className="rounded-md bg-sun px-1.5 font-display tracking-widest text-ink">{profile.publicId}</span>
        </p>
      </Card>

      <div className="flex flex-col gap-5">
        <Card>
          <LevelBar xp={profile.xp} />
        </Card>
        <Card>
          <h3 className="text-2xl">Statistiques par jeu</h3>
          {stats.length === 0 ? (
            <p className="mt-2 text-sm font-bold text-ink/70">Aucune partie terminée pour l'instant. Jouez une session pour remplir cette page !</p>
          ) : (
            <table className="mt-2 w-full text-left text-sm font-bold">
              <thead className="text-xs uppercase text-ink/60">
                <tr>
                  <th>Jeu</th>
                  <th>Sessions</th>
                  <th>Victoires</th>
                  <th>Manches gagnées</th>
                  <th className="text-right">Points</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.game_id}>
                    <td className="py-1">{getGame(s.game_id)?.title ?? s.game_id}</td>
                    <td>{s.sessions_played}</td>
                    <td>{s.sessions_won}</td>
                    <td>{s.rounds_won}</td>
                    <td className="text-right">{s.total_score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card>
          <h3 className="text-2xl">Succès</h3>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {profile.achievements.map((a) => (
              <li key={a.id} className={`rounded-xl border-2 border-ink p-2 text-sm font-bold ${a.unlocked ? "bg-sun" : "bg-cream opacity-60"}`}>
                <p>
                  {a.title} {a.unlocked && <Badge className="bg-turquoise">Débloqué</Badge>}
                </p>
                <p className="text-xs font-semibold">{a.description}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function AvatarTab({ userId, profile, initial, onSaved }: { userId: string; profile: MyProfile; initial: AvatarConfig; onSaved: () => Promise<unknown> }) {
  const [config, setConfig] = useState(initial);
  const [status, setStatus] = useState<string | null>(null);
  // Comparé à l'avatar affiché (celui par défaut tant qu'aucun n'est enregistré) : il est identique partout dans les salons.
  const dirty = JSON.stringify(config) !== JSON.stringify(initial);

  const save = async () => {
    setStatus(null);
    try {
      await saveAvatar(userId, config);
      await onSaved();
      setStatus("Avatar enregistré. Il apparaîtra dans vos prochains salons.");
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  return (
    <div className="grid gap-5 md:grid-cols-[18rem_1fr]">
      <Card>
        <AvatarPreview config={config} name={profile.username} className="h-72 w-full" />
      </Card>
      <Card className="flex flex-col gap-4">
        <h3 className="text-2xl">Personnaliser mon avatar</h3>
        <AvatarEditor config={config} onChange={setConfig} />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="accent" disabled={!dirty} onClick={() => void save()}>
            Enregistrer
          </Button>
          <Button variant="plain" disabled={!dirty} onClick={() => setConfig(initial)}>
            Annuler les changements
          </Button>
          <p role="status" className="text-sm font-bold">
            {status}
          </p>
        </div>
      </Card>
    </div>
  );
}

const OUTCOME_MESSAGE: Record<FriendRequestOutcome, string> = {
  sent: "Demande envoyée.",
  accepted: "Vous êtes maintenant amis !",
  already_friends: "Vous êtes déjà amis.",
  already_sent: "Demande déjà envoyée.",
  not_found: "Joueur introuvable.",
  not_allowed: "Ce joueur n'accepte pas de demandes d'ami.",
  limit: "Trop de demandes récentes, réessayez plus tard.",
};

function FriendsTab({ userId, data, onChange }: { userId: string; data: { friends: Friend[]; requests: FriendRequestView[] }; onChange: () => Promise<unknown> }) {
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [presence, setPresence] = useState<Map<string, PresenceEntry>>(new Map());

  useEffect(() => {
    let active = true;
    const refresh = () => void fetchFriendsPresence().then((map) => active && setPresence(map));
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const run = async (action: () => Promise<unknown>) => {
    setMessage(null);
    try {
      await action();
      await onChange();
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  const search = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMessage(null);
    try {
      setResults(await searchProfiles(String(new FormData(e.currentTarget).get("query"))));
    } catch (err) {
      setMessage((err as Error).message);
    }
  };

  const known = new Set([...data.friends.map((f) => f.id), ...data.requests.map((r) => r.userId), userId]);
  const incoming = data.requests.filter((r) => r.direction === "incoming");
  const outgoing = data.requests.filter((r) => r.direction === "outgoing");

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Card className="flex flex-col gap-3">
        <h3 className="text-2xl">Ajouter un ami</h3>
        <form onSubmit={search} className="flex gap-2">
          <Input name="query" aria-label="Pseudo ou identifiant" required minLength={2} maxLength={16} placeholder="Pseudo ou identifiant" autoComplete="off" />
          <Button type="submit">Chercher</Button>
        </form>
        {results && results.length === 0 && <p className="text-sm font-bold text-ink/70">Aucun joueur trouvé.</p>}
        <ul className="flex flex-col gap-2">
          {results?.map((r) => (
            <li key={r.id} className="flex items-center gap-2 rounded-xl border-2 border-ink bg-cream px-3 py-1.5 text-sm font-bold">
              <span className="grow">
                {r.username} <span className="text-xs text-ink/60">#{r.public_id}</span>
              </span>
              <Button
                className="!px-3 !py-0.5 !text-sm"
                variant="calm"
                disabled={known.has(r.id)}
                onClick={() => void run(async () => setMessage(OUTCOME_MESSAGE[await sendFriendRequest(r.id)]))}
              >
                {known.has(r.id) ? "Déjà ajouté" : "Ajouter"}
              </Button>
            </li>
          ))}
        </ul>
        <p role="status" className="min-h-5 text-sm font-bold">
          {message}
        </p>
      </Card>

      <Card className="flex flex-col gap-3">
        <h3 className="text-2xl">Demandes</h3>
        {incoming.length + outgoing.length === 0 && <p className="text-sm font-bold text-ink/70">Aucune demande en attente.</p>}
        <ul className="flex flex-col gap-2">
          {incoming.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-ink bg-sun px-3 py-1.5 text-sm font-bold">
              <span className="grow">{r.username} veut être votre ami</span>
              <Button className="!px-3 !py-0.5 !text-sm" variant="calm" onClick={() => void run(() => respondFriendRequest(r.id, true))}>
                Accepter
              </Button>
              <Button className="!px-3 !py-0.5 !text-sm" variant="plain" onClick={() => void run(() => respondFriendRequest(r.id, false))}>
                Refuser
              </Button>
            </li>
          ))}
          {outgoing.map((r) => (
            <li key={r.id} className="flex items-center gap-2 rounded-xl border-2 border-ink bg-cream px-3 py-1.5 text-sm font-bold">
              <span className="grow">Demande envoyée à {r.username}</span>
              <Button className="!px-3 !py-0.5 !text-sm" variant="plain" onClick={() => void run(() => cancelFriendRequest(r.id))}>
                Annuler
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="flex flex-col gap-3 md:col-span-2">
        <h3 className="text-2xl">Mes amis ({data.friends.length})</h3>
        {data.friends.length === 0 && <p className="text-sm font-bold text-ink/70">Pas encore d'amis : cherchez un pseudo ci-dessus.</p>}
        <ul className="grid gap-2 sm:grid-cols-2">
          {data.friends.map((friend) => {
            const entry = presence.get(friend.id);
            const status = entry?.status ?? "offline";
            return (
              <li key={friend.id} className="flex items-center gap-2 rounded-xl border-2 border-ink bg-white px-3 py-1.5 text-sm font-bold">
                <span className="grow">
                  {friend.username} <span className="text-xs text-ink/60">Niv. {levelProgress(friend.xp).level}</span>
                </span>
                <Badge className={PRESENCE_STYLE[status]}>
                  {PRESENCE_LABEL[status]}
                  {entry?.gameId && ` · ${getGame(entry.gameId)?.title ?? entry.gameId}`}
                </Badge>
                <button type="button" className="text-xs underline" onClick={() => void run(() => removeFriend(friend.id))}>
                  Retirer {friend.username}
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

function Board({ title, rows, userId }: { title: string; rows: LeaderboardRow[] | null; userId: string }) {
  return (
    <Card>
      <h3 className="text-2xl">{title}</h3>
      {!rows ? (
        <p aria-busy="true">Chargement…</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-sm font-bold text-ink/70">Personne pour l'instant.</p>
      ) : (
        <ol className="mt-2 flex flex-col gap-1">
          {rows.map((row, i) => (
            <li key={row.userId} className={`flex items-center gap-3 rounded-lg px-2 py-1 text-sm font-bold ${row.userId === userId ? "bg-sun" : ""}`}>
              <span className="w-6 font-display text-lg">{i + 1}</span>
              <span className="grow">{row.username}</span>
              <span className="text-xs text-ink/60">Niv. {levelProgress(row.xp).level}</span>
              <span>{row.xp} XP</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function LeaderboardsTab({ userId, friends }: { userId: string; friends: Friend[] }) {
  const [global, setGlobal] = useState<LeaderboardRow[] | null>(null);
  const [mine, setMine] = useState<LeaderboardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadGlobalLeaderboard().then(setGlobal, (e: Error) => setError(e.message));
    loadFriendsLeaderboard(userId, friends).then(setMine, (e: Error) => setError(e.message));
  }, [userId, friends]);
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Board title="Classement mondial" rows={global} userId={userId} />
      <Board title="Entre amis" rows={mine} userId={userId} />
      {error && <p role="alert" className="font-bold text-coral">{error}</p>}
    </div>
  );
}

const VISIBILITY: [PresenceVisibility, string][] = [
  ["everyone", "Tout le monde"],
  ["friends", "Mes amis"],
  ["nobody", "Personne"],
];

function PrivacyTab({ userId, initial, onSaved }: { userId: string; initial: Privacy; onSaved: () => Promise<unknown> }) {
  const [privacy, setPrivacy] = useState(initial);
  const [status, setStatus] = useState<string | null>(null);
  const dirty = JSON.stringify(privacy) !== JSON.stringify(initial);

  const save = async () => {
    setStatus(null);
    try {
      await savePrivacy(userId, privacy);
      await onSaved();
      setStatus("Réglages enregistrés.");
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  const select = (label: string, value: string, options: [string, string][], onChange: (v: string) => void, hint: string) => (
    <div className="flex flex-col gap-1">
      <label className="font-bold" htmlFor={`privacy-${label}`}>
        {label}
      </label>
      <select id={`privacy-${label}`} className="w-fit rounded-xl border-3 border-ink bg-white px-3 py-1 font-bold" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
      <p className="text-xs font-semibold text-ink/70">{hint}</p>
    </div>
  );

  return (
    <Card className="flex max-w-xl flex-col gap-5">
      <h3 className="text-2xl">Confidentialité</h3>
      {select("Qui voit ma présence", privacy.presence, VISIBILITY, (v) => setPrivacy({ ...privacy, presence: v as PresenceVisibility }), "En ligne, dans un lobby, en partie, et le jeu en cours.")}
      {select(
        "Qui voit mes statistiques",
        privacy.show_stats,
        VISIBILITY,
        (v) => setPrivacy({ ...privacy, show_stats: v as PresenceVisibility }),
        "Statistiques, historique et succès. Votre niveau reste visible dans les classements.",
      )}
      {select(
        "Qui peut m'envoyer une demande d'ami",
        privacy.friend_requests,
        [
          ["everyone", "Tout le monde"],
          ["nobody", "Personne"],
        ],
        (v) => setPrivacy({ ...privacy, friend_requests: v as Privacy["friend_requests"] }),
        "Votre adresse e-mail n'est jamais visible des autres joueurs.",
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="accent" disabled={!dirty} onClick={() => void save()}>
          Enregistrer
        </Button>
        <Button variant="plain" disabled={JSON.stringify(privacy) === JSON.stringify(DEFAULT_PRIVACY)} onClick={() => setPrivacy(DEFAULT_PRIVACY)}>
          Valeurs par défaut
        </Button>
        <p role="status" className="text-sm font-bold">
          {status}
        </p>
      </div>
    </Card>
  );
}

