"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  cosmeticsFromEquipped,
  getGame,
  PLAYER_COLORS,
  levelProgress,
  type AvatarConfig,
  type PresenceEntry,
} from "@stepup/shared";
import { lookFromId } from "@/avatar/Avatar";
import {
  equippedPayload,
  useEconomy,
  useEquippedCosmetics,
} from "@/lib/economy";
import { useNav, type ProfileTabId } from "@/lib/nav";
import { useSession } from "@/lib/session";
import {
  cancelFriendRequest,
  fetchFriendsPresence,
  loadFriends,
  loadFriendsLeaderboard,
  loadGlobalLeaderboard,
  loadMyProfile,
  removeFriend,
  respondFriendRequest,
  saveAvatar,
  saveColor,
  searchProfiles,
  sendFriendRequest,
  type Friend,
  type FriendRequestOutcome,
  type FriendRequestView,
  type LeaderboardRow,
  type MyProfile,
  type SearchResult,
} from "@/lib/social";
import {
  HudButton,
  HudChip,
  HudOverlay,
  HudPanel,
  HudProgress,
  HudRow,
  HudSegmented,
} from "../hud";
import { chamberSend } from "@/lib/chamber";
import { pfpBackground, useMyColor } from "@/lib/playerColor";
import { EscapeHint } from "../inputPrompts";
import { AvatarStudio } from "./AvatarEditor";
import { HistoryTab, MissionsTab, ShopTab } from "./EconomyTabs";

const AvatarPortrait = dynamic(
  () => import("./AvatarPortrait").then((m) => m.AvatarPortrait),
  { ssr: false },
);

const SECTIONS = [
  ["profile", "Profil"],
  ["missions", "Missions"],
  ["achievements", "Succès"],
  ["leaderboards", "Classement"],
  ["friends", "Social"],
  ["history", "Historique"],
] as const;

const PRESENCE_LABEL: Record<PresenceEntry["status"], string> = {
  online: "En ligne",
  lobby: "Dans un lobby",
  playing: "En partie",
  offline: "Hors ligne",
};
const PRESENCE_DOT: Record<PresenceEntry["status"], string> = {
  online: "bg-hud-ok",
  lobby: "bg-pastel-sun",
  playing: "bg-pastel-pink",
  offline: "bg-hud-line",
};

const Title = ({ children }: { children: ReactNode }) => (
  <h3 className="mb-2 font-hud! text-lg font-semibold text-black">
    {children}
  </h3>
);
const Sub = ({ children }: { children: ReactNode }) => (
  <h4 className="mt-4 mb-1.5 font-hud! text-[13px] font-semibold text-hud-muted">
    {children}
  </h4>
);

// Dernier profil chargé : en revenant sur l'écran, la fenêtre s'affiche tout de suite (puis se met à jour) au lieu de clignoter.
let cached: { userId: string; profile: MyProfile } | null = null;

export function ProfileScreen({
  userId,
  onHome,
}: {
  userId: string;
  onHome: () => void;
}) {
  // La section vit dans le magasin de navigation : l'en-tête (Boutique) et l'écran la changent tous deux.
  const tab = useNav((s) => s.profileTab);
  const setTab = (profileTab: ProfileTabId) => useNav.setState({ profileTab });
  const [profile, setProfile] = useState<MyProfile | null>(
    cached?.userId === userId ? cached.profile : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [friends, setFriends] = useState<{
    friends: Friend[];
    requests: FriendRequestView[];
  } | null>(null);

  const reload = useCallback(
    () =>
      loadMyProfile(userId).then(
        (p) => {
          cached = { userId, profile: p };
          setProfile(p);
        },
        (e: Error) => setError(e.message),
      ),
    [userId],
  );
  const reloadFriends = useCallback(
    () =>
      loadFriends(userId).then(setFriends, (e: Error) => setError(e.message)),
    [userId],
  );
  useEffect(() => {
    void reload();
    void reloadFriends();
  }, [reload, reloadFriends]);

  if (error) {
    return (
      <HudPanel className="p-5">
        <p role="alert" className="text-hud-bad">
          {error}
        </p>
        <HudButton className="mt-3" onClick={onHome}>
          Retour à l'accueil
        </HudButton>
      </HudPanel>
    );
  }
  if (!profile) return <p aria-busy="true">Chargement du profil…</p>;

  const avatar = profile.avatar ?? (lookFromId(userId) as AvatarConfig);
  const pending =
    friends?.requests.filter((r) => r.direction === "incoming").length ?? 0;
  const navTab = tab;

  if (tab === "avatar")
    return (
      <AvatarTab
        userId={userId}
        profile={profile}
        initial={avatar}
        onSaved={reload}
        onClose={() => useNav.getState().goHome()}
      />
    );

  if (tab === "shop")
    return (
      <HudOverlay
        compact
        role="region"
        aria-label="Boutique"
        className="w-[min(900px,calc(100vw-2rem))] h-[min(580px,calc(100dvh-108px))]"
      >
        <div className="min-h-0 min-w-0 grow">
          <ShopTab />
        </div>
      </HudOverlay>
    );

  return (
    <HudOverlay
      compact
      className="w-[min(900px,calc(100vw-2rem))] h-[min(580px,calc(100dvh-108px))]"
    >
      <nav
        aria-label="Sections du profil"
        className="flex w-[170px] shrink-0 flex-col border-r border-hud-divider px-2 py-3"
      >
        <div
          role="tablist"
          aria-orientation="vertical"
          className="flex flex-col gap-1"
        >
          {SECTIONS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={navTab === id}
              onClick={() => setTab(id)}
              className={`flex w-full items-center justify-between rounded-[11px] px-3 py-2 text-left font-hud text-[13px] font-semibold ${navTab === id ? "bg-hud-accent text-white" : "text-black"}`}
            >
              <span>{label}</span>
              {id === "friends" && pending > 0 && (
                <span className="min-w-4 rounded-full bg-hud-bad px-1.5 text-center text-[11px] text-white">
                  {pending}
                </span>
              )}
            </button>
          ))}
        </div>
        <EscapeHint className="mt-auto px-1 pt-3" />
      </nav>

      <div
        role="tabpanel"
        aria-label={SECTIONS.find(([id]) => id === tab)?.[1]}
        className="min-h-0 min-w-0 grow overflow-y-auto px-5 py-4"
      >
        {tab === "profile" && (
          <ProfileTab
            profile={profile}
            avatar={avatar}
            friends={friends?.friends.length ?? 0}
          />
        )}
        {tab === "missions" && <MissionsTab userId={userId} />}
        {tab === "achievements" && <AchievementsTab profile={profile} />}
        {tab === "friends" && friends && (
          <FriendsTab userId={userId} data={friends} onChange={reloadFriends} />
        )}
        {tab === "leaderboards" && (
          <LeaderboardsTab userId={userId} friends={friends?.friends ?? []} />
        )}
        {tab === "history" && <HistoryTab userId={userId} />}
      </div>
    </HudOverlay>
  );
}

// ---------- Profil ----------

const DECORATION_STYLE: Record<string, { ring: string; label: string }> = {
  stars: { ring: "ring-4 ring-pastel-sun", label: "★ Cadre étoilé" },
  flames: { ring: "ring-4 ring-pastel-pink", label: "Cadre en flammes" },
};

const nf = new Intl.NumberFormat("fr-FR");

/** Choix de la couleur du joueur : fond de sa pastille, pseudo dans le chat… Enregistrée sur le compte. */
function ColorPicker() {
  const color = useMyColor((s) => s.color);
  const userId = useSession().userId;
  const [error, setError] = useState<string | null>(null);
  const choose = async (next: string | null) => {
    if (!userId) return;
    const previous = useMyColor.getState().color;
    useMyColor.getState().set(next);
    setError(null);
    try {
      await saveColor(userId, next);
      chamberSend("refreshAvatar"); // les joueurs de la chambre voient la nouvelle couleur tout de suite
    } catch (e) {
      useMyColor.getState().set(previous);
      setError((e as Error).message);
    }
  };
  return (
    <fieldset className="mt-4">
      <legend className="mb-1.5 font-hud text-[13px] font-semibold text-hud-muted">
        Ma couleur
      </legend>
      <div className="flex flex-wrap items-center gap-2">
        {PLAYER_COLORS.map((c, i) => (
          <button
            key={c}
            type="button"
            aria-label={`Couleur ${i + 1}`}
            aria-pressed={color === c}
            onClick={() => void choose(c)}
            className={`size-7 rounded-full border-[2.5px] border-white ${color === c ? "shadow-[0_0_0_2.5px_#6f5be0]" : "shadow-[0_0_0_1.5px_#cfcbe8]"}`}
            style={{ backgroundColor: c }}
          />
        ))}
        <button
          type="button"
          aria-pressed={color === null}
          onClick={() => void choose(null)}
          className={`h-7 rounded-full px-3 font-hud text-xs font-semibold ${color === null ? "bg-hud-accent text-white" : "bg-hud-field text-black"}`}
        >
          Auto
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-hud-bad">
          {error}
        </p>
      )}
    </fieldset>
  );
}

function ProfileTab({
  profile,
  avatar,
  friends,
}: {
  profile: MyProfile;
  avatar: AvatarConfig;
  friends: number;
}) {
  const color = useMyColor((s) => s.color);
  const balance = useEconomy((s) => s.balance);
  const owned = useEconomy((s) => s.inventory.length);
  const decoration = useEconomy(
    (s) => equippedPayload(s, "decoration")?.decoration,
  );
  const frame =
    typeof decoration === "string" ? DECORATION_STYLE[decoration] : undefined;
  const { level, into, needed } = levelProgress(profile.xp);
  const played = profile.stats.reduce((sum, g) => sum + g.sessions_played, 0);
  const won = profile.stats.reduce((sum, g) => sum + g.sessions_won, 0);
  const tiles: [string, string][] = [
    [nf.format(played), "Parties jouées"],
    [nf.format(won), "Victoires"],
    [nf.format(profile.xp), "Expérience (XP)"],
    [balance === null ? "…" : nf.format(balance), "Jetons"],
    [nf.format(owned), "Objets possédés"],
    [nf.format(friends), "Amis"],
  ];
  return (
    <div>
      <Title>Profil</Title>
      <div className="mb-3 flex items-center gap-3.5">
        <div
          className={`relative size-[76px] shrink-0 overflow-hidden rounded-full ${frame?.ring ?? ""}`}
          style={{ background: pfpBackground(profile.username, color) }}
        >
          <AvatarPortrait config={avatar} className="size-full" />
        </div>
        <div className="flex-1">
          <div className="flex items-center font-hud text-xl font-semibold text-black">
            {profile.username}
            <span className="ml-1 rounded-lg bg-[#eceaff] px-2 py-px text-[13px] font-medium text-hud-accent">
              Niv. {level}
            </span>
          </div>
          <HudProgress
            label="Progression vers le niveau suivant"
            value={into}
            max={needed}
            className="mt-2 mb-1"
          />
          <p className="text-xs text-hud-muted">
            {nf.format(into)} / {nf.format(needed)} XP avant le niveau{" "}
            {level + 1}
          </p>
          {frame && (
            <p className="mt-1 text-xs text-hud-muted">{frame.label}</p>
          )}
        </div>
      </div>
      <ul className="grid grid-cols-3 gap-2">
        {tiles.map(([value, label]) => (
          <li key={label} className="rounded-[14px] bg-hud-field px-3 py-2.5">
            <b className="block font-hud text-xl font-semibold text-black">
              {value}
            </b>
            <span className="text-xs text-hud-muted">{label}</span>
          </li>
        ))}
      </ul>
      <ColorPicker />
      <h4 className="mt-4 mb-1.5 font-hud! text-[13px] font-semibold text-hud-muted">
        Statistiques par jeu
      </h4>
      {profile.stats.length === 0 ? (
        <p className="text-sm text-hud-muted">
          Aucune partie terminée pour l'instant. Jouez une session pour remplir
          cette page !
        </p>
      ) : (
        <table className="w-full text-left text-sm text-black">
          <thead className="text-xs text-hud-muted">
            <tr>
              <th className="font-medium">Jeu</th>
              <th className="font-medium">Sessions</th>
              <th className="font-medium">Victoires</th>
              <th className="font-medium">Manches gagnées</th>
              <th className="text-right font-medium">Points</th>
            </tr>
          </thead>
          <tbody>
            {profile.stats.map((s) => (
              <tr key={s.game_id} className="border-t border-hud-divider">
                <td className="py-1.5">
                  {getGame(s.game_id)?.title ?? s.game_id}
                </td>
                <td>{s.sessions_played}</td>
                <td>{s.sessions_won}</td>
                <td>{s.rounds_won}</td>
                <td className="text-right">{s.total_score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------- Succès ----------

const ICON_COLORS = [
  "#8fe3c0",
  "#ffe08a",
  "#ff9eb5",
  "#7ec8f5",
  "#b9a3f5",
  "#ffd6a8",
];
const iconColor = (id: string) =>
  ICON_COLORS[
    [...id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % ICON_COLORS.length
  ]!;

function AchievementsTab({ profile }: { profile: MyProfile }) {
  const done = profile.achievements.filter((a) => a.unlocked).length;
  return (
    <div>
      <Title>
        Succès{" "}
        <span className="text-[13px] font-medium text-hud-muted">
          {done} / {profile.achievements.length} débloqués
        </span>
      </Title>
      <ul>
        {profile.achievements.map((a) => (
          <HudRow key={a.id} className="mb-2">
            <span
              className={`size-9 shrink-0 rounded-[11px] border-2 border-outline ${a.unlocked ? "" : "opacity-50"}`}
              style={{ background: iconColor(a.id) }}
              aria-hidden
            />
            <span className="grow">
              <span>{a.title}</span>
              <small className="block text-xs font-normal text-hud-muted">
                {a.description}
              </small>
              <HudProgress
                label={`Progression : ${a.title}`}
                value={a.unlocked ? 1 : 0}
                max={1}
                className="mt-1.5"
              />
            </span>
            {a.unlocked ? (
              <span className="rounded-[10px] bg-[#e3f6ec] px-3.5 py-1.5 text-[12.5px] font-semibold text-hud-ok">
                Débloqué
              </span>
            ) : (
              <span className="rounded-[10px] bg-hud-soft px-3.5 py-1.5 text-[12.5px] font-semibold text-hud-accent">
                En cours
              </span>
            )}
          </HudRow>
        ))}
      </ul>
    </div>
  );
}

// ---------- Avatar : éditeur devant le miroir ----------

function AvatarTab({
  userId,
  profile,
  initial,
  onSaved,
  onClose,
}: {
  userId: string;
  profile: MyProfile;
  initial: AvatarConfig;
  onSaved: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [config, setConfig] = useState(initial);
  const [status, setStatus] = useState<string | null>(null);
  // « Essayer au miroir » depuis la boutique : l'objet est porté par l'aperçu, sans être équipé.
  const tryItemId = useNav((s) => s.tryItemId);
  const shop = useEconomy((s) => s.shop);
  const equipped = useEquippedCosmetics();
  const tryItem = shop.find((item) => item.id === tryItemId);
  const cosmetics = tryItem
    ? {
        ...equipped,
        ...cosmeticsFromEquipped([
          { category: tryItem.category, payload: tryItem.payload },
        ]),
      }
    : undefined;
  const save = async () => {
    setStatus(null);
    try {
      await saveAvatar(userId, config);
      await onSaved();
      chamberSend("refreshAvatar"); // les joueurs de la chambre voient le nouveau personnage tout de suite
      setStatus("Avatar enregistré.");
      setTimeout(onClose, 1200);
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  return (
    <AvatarStudio
      config={config}
      onChange={setConfig}
      name={profile.username}
      cosmetics={cosmetics}
      tryName={tryItem?.name}
      status={status}
      onCancel={onClose}
      onConfirm={() => void save()}
    />
  );
}

// ---------- Social ----------

const OUTCOME_MESSAGE: Record<FriendRequestOutcome, string> = {
  sent: "Demande envoyée.",
  accepted: "Vous êtes maintenant amis !",
  already_friends: "Vous êtes déjà amis.",
  already_sent: "Demande déjà envoyée.",
  not_found: "Joueur introuvable.",
  not_allowed: "Ce joueur n'accepte pas de demandes d'ami.",
  limit: "Trop de demandes récentes, réessayez plus tard.",
};

const small = "px-3 py-1.5 text-[12.5px]";

function FriendsTab({
  userId,
  data,
  onChange,
}: {
  userId: string;
  data: { friends: Friend[]; requests: FriendRequestView[] };
  onChange: () => Promise<unknown>;
}) {
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [presence, setPresence] = useState<Map<string, PresenceEntry>>(
    new Map(),
  );

  useEffect(() => {
    let active = true;
    const refresh = () =>
      void fetchFriendsPresence().then((map) => active && setPresence(map));
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
      setResults(
        await searchProfiles(
          String(new FormData(e.currentTarget).get("query")),
        ),
      );
    } catch (err) {
      setMessage((err as Error).message);
    }
  };

  const known = new Set([
    ...data.friends.map((f) => f.id),
    ...data.requests.map((r) => r.userId),
    userId,
  ]);
  const incoming = data.requests.filter((r) => r.direction === "incoming");
  const outgoing = data.requests.filter((r) => r.direction === "outgoing");

  return (
    <div>
      <Title>Social</Title>
      <form onSubmit={search} className="flex gap-2">
        <input
          name="query"
          aria-label="Pseudo"
          required
          minLength={2}
          maxLength={16}
          placeholder="Ajouter un ami par pseudo"
          autoComplete="off"
          className="h-[34px] flex-1 rounded-[10px] border-[1.5px] border-hud-line bg-hud-field px-3 text-[13px] text-hud-ink outline-none focus:border-hud-accent focus:bg-white"
        />
        <HudButton type="submit" className="px-3.5 py-1.5 text-[12.5px]">
          Chercher
        </HudButton>
      </form>
      {results && results.length === 0 && (
        <p className="mt-2 text-sm text-hud-muted">Aucun joueur trouvé.</p>
      )}
      <ul className="mt-2 flex flex-col gap-2">
        {results?.map((r) => (
          <HudRow key={r.id}>
            <span className="grow">{r.username}</span>
            <HudButton
              className={small}
              disabled={known.has(r.id)}
              onClick={() =>
                void run(async () =>
                  setMessage(OUTCOME_MESSAGE[await sendFriendRequest(r.id)]),
                )
              }
            >
              {known.has(r.id) ? "Déjà ajouté" : "Ajouter"}
            </HudButton>
          </HudRow>
        ))}
      </ul>
      <p role="status" className="min-h-5 text-sm text-hud-muted">
        {message}
      </p>

      <Sub>Demandes</Sub>
      {incoming.length + outgoing.length === 0 && (
        <p className="text-sm text-hud-muted">Aucune demande en attente.</p>
      )}
      <ul className="flex flex-col gap-2">
        {incoming.map((r) => (
          <HudRow key={r.id} me className="flex-wrap">
            <span className="grow">{r.username} veut être votre ami</span>
            <HudButton
              className={small}
              onClick={() => void run(() => respondFriendRequest(r.id, true))}
            >
              Accepter
            </HudButton>
            <HudButton
              variant="soft"
              className={small}
              onClick={() => void run(() => respondFriendRequest(r.id, false))}
            >
              Refuser
            </HudButton>
          </HudRow>
        ))}
        {outgoing.map((r) => (
          <HudRow key={r.id}>
            <span className="grow">Demande envoyée à {r.username}</span>
            <HudButton
              variant="soft"
              className={small}
              onClick={() => void run(() => cancelFriendRequest(r.id))}
            >
              Annuler
            </HudButton>
          </HudRow>
        ))}
      </ul>

      <Sub>Mes amis ({data.friends.length})</Sub>
      {data.friends.length === 0 && (
        <p className="text-sm text-hud-muted">
          Pas encore d'amis : cherchez un pseudo ci-dessus.
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {data.friends.map((friend) => {
          const entry = presence.get(friend.id);
          const status = entry?.status ?? "offline";
          return (
            <HudRow key={friend.id} className="flex-wrap">
              <span
                className="grid size-[34px] shrink-0 place-items-center rounded-full font-semibold text-hud-ink"
                style={{
                  background: pfpBackground(friend.username, friend.color),
                }}
                aria-hidden
              >
                {friend.username.slice(0, 1).toUpperCase()}
              </span>
              <span className="grow">
                {friend.username}{" "}
                <span className="text-xs text-hud-muted">
                  Niv. {levelProgress(friend.xp).level}
                </span>
                <small className="flex items-center text-xs text-hud-muted">
                  <span
                    className={`mr-1.5 inline-block size-[9px] rounded-full ${PRESENCE_DOT[status]}`}
                  />
                  {PRESENCE_LABEL[status]}
                  {entry?.gameId &&
                    ` · ${getGame(entry.gameId)?.title ?? entry.gameId}`}
                </small>
              </span>
              <HudButton
                variant="soft"
                className={small}
                onClick={() => void run(() => removeFriend(friend.id))}
              >
                Retirer {friend.username}
              </HudButton>
            </HudRow>
          );
        })}
      </ul>
    </div>
  );
}

// ---------- Classement : podium puis liste ----------

const MEDAL = ["#ffd23f", "#d5d8ea", "#e8a46b"];
const PODIUM_ORDER = [1, 0, 2];
const PODIUM_HEIGHT = [74, 100, 56];

function Podium({ rows, userId }: { rows: LeaderboardRow[]; userId: string }) {
  return (
    <ol
      aria-label="Podium"
      className="mx-auto mt-2 mb-3 grid max-w-md grid-cols-[1fr_1.15fr_1fr] items-end gap-2.5"
    >
      {PODIUM_ORDER.map((rank) => {
        const row = rows[rank];
        if (!row) return <li key={rank} />;
        return (
          <li key={row.userId} className="text-center">
            <div
              className={`mx-auto mb-1 grid place-items-center rounded-full border-[3px] border-white font-semibold text-hud-ink ${rank === 0 ? "size-16 text-xl" : "size-[54px]"}`}
              style={{
                background: pfpBackground(row.username),
                boxShadow: `0 0 0 2px ${MEDAL[rank]}`,
              }}
              aria-hidden
            >
              {row.username.slice(0, 1).toUpperCase()}
            </div>
            <p
              className={`text-sm font-semibold ${row.userId === userId ? "text-hud-accent" : "text-black"}`}
            >
              {row.username}
              {row.userId === userId && " (toi)"}
            </p>
            <p className="mb-1 text-[13px] text-hud-muted">
              Niv. {levelProgress(row.xp).level} · {row.xp} XP
            </p>
            <div
              className="flex items-start justify-center rounded-t-[14px] pt-2 text-2xl font-semibold text-hud-ink"
              style={{ background: MEDAL[rank], height: PODIUM_HEIGHT[rank] }}
            >
              {rank + 1}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Board({
  title,
  rows,
  userId,
}: {
  title: string;
  rows: LeaderboardRow[] | null;
  userId: string;
}) {
  return (
    <section aria-label={title}>
      {!rows ? (
        <p aria-busy="true">Chargement…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-hud-muted">Personne pour l'instant.</p>
      ) : (
        <>
          <Podium rows={rows} userId={userId} />
          <ol start={4} className="flex flex-col gap-2">
            {rows.slice(3).map((row, i) => (
              <HudRow key={row.userId} me={row.userId === userId}>
                <span className="w-7 text-center font-semibold text-hud-muted">
                  {i + 4}
                </span>
                <span className="grow font-semibold">
                  {row.username}
                  {row.userId === userId && (
                    <span className="ml-1 text-[11.5px] text-hud-accent">
                      {" "}
                      (toi)
                    </span>
                  )}
                </span>
                <span className="text-xs text-hud-muted">
                  Niv. {levelProgress(row.xp).level}
                </span>
                <span className="font-semibold">{row.xp} XP</span>
              </HudRow>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function LeaderboardsTab({
  userId,
  friends,
}: {
  userId: string;
  friends: Friend[];
}) {
  const [scope, setScope] = useState<"friends" | "global">("friends");
  const [global, setGlobal] = useState<LeaderboardRow[] | null>(null);
  const [mine, setMine] = useState<LeaderboardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadGlobalLeaderboard().then(setGlobal, (e: Error) => setError(e.message));
    loadFriendsLeaderboard(userId, friends).then(setMine, (e: Error) =>
      setError(e.message),
    );
  }, [userId, friends]);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <Title>Classement</Title>
        <HudSegmented
          label="Portée du classement"
          value={scope}
          onChange={setScope}
          className="w-52"
          options={[
            { value: "friends", label: "Amis" },
            { value: "global", label: "Général" },
          ]}
        />
      </div>
      <p className="mb-1 text-xs text-hud-muted">
        Classement par expérience (XP) : chaque partie terminée en rapporte.
      </p>
      {scope === "global" ? (
        <Board title="Classement mondial" rows={global} userId={userId} />
      ) : (
        <Board title="Entre amis" rows={mine} userId={userId} />
      )}
      {error && (
        <p role="alert" className="text-hud-bad">
          {error}
        </p>
      )}
    </div>
  );
}
