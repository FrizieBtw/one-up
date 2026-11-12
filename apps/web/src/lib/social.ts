"use client";

import { parseAvatarConfig, type AvatarConfig, type PresenceEntry, type PresenceVisibility } from "@stepup/shared";
import { GAME_SERVER_URL } from "./env";
import { getAuthToken, supabase } from "./session";

// Accès aux données sociales d'un compte. Tout passe par Supabase sous RLS (jeton de l'utilisateur) :
// ce que le navigateur peut lire ou écrire est décidé par les politiques de la base, pas par ce code.

const db = () => {
  if (!supabase) throw new Error("Supabase n'est pas configuré.");
  return supabase;
};

type Result<T> = { data: T | null; error: { message: string } | null };

/** Donnée éventuellement absente (ligne inexistante). */
function check<T>(result: Result<T>): T | null {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
/** Liste : vide si la requête ne renvoie rien. */
function list<T>(result: Result<T[]>): T[] {
  return check(result) ?? [];
}
/** Ligne attendue : une absence est une erreur. */
function must<T>(result: Result<T>): T {
  const data = check(result);
  if (data === null) throw new Error("Donnée introuvable.");
  return data;
}

export interface PlayerStat {
  game_id: string;
  sessions_played: number;
  sessions_won: number;
  rounds_won: number;
  rounds_pushed: number;
  rounds_lost: number;
  total_score: number;
}

export interface AchievementInfo {
  id: string;
  title: string;
  description: string;
  unlocked: boolean;
}

export interface Privacy {
  presence: PresenceVisibility;
  friend_requests: "everyone" | "nobody";
  show_stats: PresenceVisibility;
}

export const DEFAULT_PRIVACY: Privacy = { presence: "friends", friend_requests: "everyone", show_stats: "everyone" };

export interface MyProfile {
  username: string;
  publicId: string;
  xp: number;
  avatar: AvatarConfig | null;
  stats: PlayerStat[];
  achievements: AchievementInfo[];
  privacy: Privacy;
}

export async function loadMyProfile(userId: string): Promise<MyProfile> {
  const client = db();
  const [profile, progression, avatar, stats, achievements, unlocked, privacy] = await Promise.all([
    client.from("profiles").select("username, public_id").eq("id", userId).single(),
    client.from("progression").select("xp").eq("user_id", userId).maybeSingle(),
    client.from("avatar_configurations").select("config").eq("user_id", userId).maybeSingle(),
    client.from("player_stats").select("*").eq("user_id", userId),
    client.from("achievements").select("id, title, description").order("id"),
    client.from("user_achievements").select("achievement_id").eq("user_id", userId),
    client.from("user_privacy_settings").select("presence, friend_requests, show_stats").eq("user_id", userId).maybeSingle(),
  ]);
  const me = must(profile);
  const done = new Set(list(unlocked).map((row) => row.achievement_id));
  return {
    username: me.username,
    publicId: me.public_id,
    xp: check(progression)?.xp ?? 0,
    avatar: parseAvatarConfig(check(avatar)?.config),
    stats: list(stats) as PlayerStat[],
    achievements: list(achievements).map((a) => ({ ...a, unlocked: done.has(a.id) })),
    privacy: (check(privacy) as Privacy | null) ?? DEFAULT_PRIVACY,
  };
}

/** Met à jour la ligne de l'utilisateur, ou la crée si elle n'existe pas encore (les politiques n'autorisent pas l'upsert). */
async function saveOwnRow(table: "avatar_configurations" | "user_privacy_settings", userId: string, values: Record<string, unknown>) {
  const client = db();
  const updated = list(await client.from(table).update(values).eq("user_id", userId).select("user_id"));
  if (updated.length === 0) check(await client.from(table).insert({ user_id: userId, ...values }));
}

export const saveAvatar = (userId: string, config: AvatarConfig) => saveOwnRow("avatar_configurations", userId, { config, updated_at: new Date().toISOString() });
export const savePrivacy = (userId: string, privacy: Privacy) => saveOwnRow("user_privacy_settings", userId, { ...privacy });

// ---------- Amis ----------

export interface Friend {
  id: string;
  username: string;
  publicId: string;
  xp: number;
}

export interface FriendRequestView {
  id: string;
  userId: string;
  username: string;
  direction: "incoming" | "outgoing";
}

export interface SearchResult {
  id: string;
  username: string;
  public_id: string;
}

async function loadPeople(ids: string[]): Promise<Map<string, Friend>> {
  if (ids.length === 0) return new Map();
  const client = db();
  const [profiles, progression] = await Promise.all([
    client.from("profiles").select("id, username, public_id").in("id", ids),
    client.from("progression").select("user_id, xp").in("user_id", ids),
  ]);
  const xp = new Map(list(progression).map((row) => [row.user_id, row.xp]));
  return new Map(list(profiles).map((p) => [p.id, { id: p.id, username: p.username, publicId: p.public_id, xp: xp.get(p.id) ?? 0 }]));
}

export async function loadFriends(userId: string): Promise<{ friends: Friend[]; requests: FriendRequestView[] }> {
  const client = db();
  const [links, requests] = await Promise.all([
    client.from("friendships").select("user_a, user_b"),
    client.from("friend_requests").select("id, from_user, to_user"),
  ]);
  const friendIds = list(links).map((l) => (l.user_a === userId ? l.user_b : l.user_a));
  const requestRows = list(requests);
  const people = await loadPeople([...friendIds, ...requestRows.map((r) => (r.from_user === userId ? r.to_user : r.from_user))]);
  return {
    friends: friendIds.flatMap((id) => people.get(id) ?? []).sort((a, b) => a.username.localeCompare(b.username)),
    requests: requestRows.flatMap((r) => {
      const incoming = r.to_user === userId;
      const other = people.get(incoming ? r.from_user : r.to_user);
      return other ? [{ id: r.id, userId: other.id, username: other.username, direction: incoming ? ("incoming" as const) : ("outgoing" as const) }] : [];
    }),
  };
}

export const searchProfiles = async (query: string) => (check(await db().rpc("search_profiles", { p_query: query })) ?? []) as SearchResult[];

export type FriendRequestOutcome = "sent" | "accepted" | "already_friends" | "already_sent" | "not_found" | "not_allowed" | "limit";
export const sendFriendRequest = async (target: string) => check(await db().rpc("send_friend_request", { p_target: target })) as FriendRequestOutcome;
export const respondFriendRequest = async (requestId: string, accept: boolean) => check(await db().rpc("respond_friend_request", { p_request: requestId, p_accept: accept }));
export const cancelFriendRequest = async (requestId: string) => check(await db().from("friend_requests").delete().eq("id", requestId));
export const removeFriend = async (other: string) => check(await db().rpc("remove_friend", { p_other: other }));

// ---------- Classements ----------

export interface LeaderboardRow {
  userId: string;
  username: string;
  xp: number;
}

async function rankedRows(rows: { user_id: string; xp: number }[]): Promise<LeaderboardRow[]> {
  const people = await loadPeople(rows.map((r) => r.user_id));
  return rows.flatMap((r) => {
    const person = people.get(r.user_id);
    return person ? [{ userId: r.user_id, username: person.username, xp: r.xp }] : [];
  });
}

export async function loadGlobalLeaderboard(): Promise<LeaderboardRow[]> {
  return rankedRows(list(await db().from("progression").select("user_id, xp").order("xp", { ascending: false }).limit(20)));
}

export async function loadFriendsLeaderboard(userId: string, friends: Friend[]): Promise<LeaderboardRow[]> {
  const ids = [userId, ...friends.map((f) => f.id)];
  return rankedRows(list(await db().from("progression").select("user_id, xp").in("user_id", ids).order("xp", { ascending: false })));
}

/** Titres des succès débloqués (écran de résultats). */
export async function loadAchievementTitles(ids: string[]): Promise<string[]> {
  if (ids.length === 0 || !supabase) return [];
  const rows = list(await supabase.from("achievements").select("id, title").in("id", ids));
  return ids.map((id) => rows.find((row) => row.id === id)?.title ?? id);
}

// ---------- Présence ----------

async function presenceFetch(path: string, method: "GET" | "POST"): Promise<Response | null> {
  const token = await getAuthToken();
  if (!token) return null;
  return fetch(`${GAME_SERVER_URL}${path}`, { method, headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
}

/** Signale que ce compte est en ligne. Silencieux en cas d'échec : la présence n'est jamais bloquante. */
export const pingPresence = () => void presenceFetch("/presence/ping", "POST");

export async function fetchFriendsPresence(): Promise<Map<string, PresenceEntry>> {
  const res = await presenceFetch("/presence", "GET");
  if (!res?.ok) return new Map();
  return new Map(((await res.json()) as PresenceEntry[]).map((entry) => [entry.userId, entry]));
}
