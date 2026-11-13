import { createClient } from "@supabase/supabase-js";
import { cosmeticsFromEquipped, ownedEmoteIds, parseAvatarConfig, type InventoryEntry, type PresenceVisibility } from "@stepup/shared";
import { env } from "./env";

export interface MatchParticipant {
  user_id: string;
  rank: number;
  score: number;
  wins: number;
  pushes: number;
  losses: number;
}

export interface MatchReward {
  userId: string;
  xpGained: number;
  xp: number;
  achievements: string[];
  /** Jetons gagnés (session et missions), solde après versement, missions accomplies. */
  tokensGained: number;
  balance: number;
  missions: string[];
}

const admin =
  env.supabaseUrl && env.supabaseServiceRoleKey
    ? createClient(env.supabaseUrl, env.supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;

const logFailure = (event: string, detail: Record<string, unknown>) => console.error(JSON.stringify({ event, ...detail }));

/**
 * Enregistre une session terminée (comptes uniquement, les invités n'ont pas de progression) et renvoie
 * les récompenses calculées par la base (XP, succès). Idempotent grâce à `sessionId` : un second appel
 * renvoie une liste vide. Sans Supabase configuré, ne fait rien. Ne lève jamais : un échec de sauvegarde
 * ne doit pas casser la partie.
 */
export async function recordMatch(sessionId: string, gameId: string, rounds: number, participants: MatchParticipant[]): Promise<MatchReward[]> {
  if (!admin || participants.length === 0) return [];
  const { data, error } = await admin.rpc("record_match", {
    p_session_id: sessionId,
    p_game_id: gameId,
    p_rounds: rounds,
    p_participants: participants,
  });
  if (error) {
    logFailure("record_match_failed", { sessionId, gameId, message: error.message });
    return [];
  }
  const rewards =
    (data as { rewards?: { user_id: string; xp_gained: number; xp: number; achievements: string[]; tokens_gained: number; balance: number; missions: string[] }[] } | null)
      ?.rewards ?? [];
  return rewards.map((r) => ({
    userId: r.user_id,
    xpGained: r.xp_gained,
    xp: r.xp,
    achievements: r.achievements,
    tokensGained: r.tokens_gained,
    balance: r.balance,
    missions: r.missions,
  }));
}

/**
 * Objets de boutique d'un compte : cosmétiques équipés (JSON d'`AvatarCosmetics`, revalidé) et emotes possédées.
 * Sans Supabase ou en cas d'erreur : aucun cosmétique, seules les emotes gratuites restent utilisables.
 */
export async function fetchCosmetics(userId: string): Promise<{ cosmetics: string; ownedEmotes: string[] }> {
  const none = { cosmetics: "{}", ownedEmotes: [] };
  if (!admin) return none;
  const { data, error } = await admin.from("user_inventory").select("equipped, shop_items(category, payload)").eq("user_id", userId);
  if (error) {
    logFailure("fetch_cosmetics_failed", { userId, message: error.message });
    return none;
  }
  const rows = (data ?? []).flatMap((row) => {
    const item = (Array.isArray(row.shop_items) ? row.shop_items[0] : row.shop_items) as InventoryEntry | null | undefined;
    return item ? [{ equipped: row.equipped as boolean, item }] : [];
  });
  return {
    cosmetics: JSON.stringify(cosmeticsFromEquipped(rows.filter((r) => r.equipped).map((r) => r.item))),
    ownedEmotes: ownedEmoteIds(rows.map((r) => r.item)),
  };
}

/** Avatar enregistré d'un compte, revalidé (la base ne vérifie que la forme générale). Chaîne JSON, ou vide. */
export async function fetchAvatar(userId: string): Promise<string> {
  if (!admin) return "";
  const { data, error } = await admin.from("avatar_configurations").select("config").eq("user_id", userId).maybeSingle();
  if (error) {
    logFailure("fetch_avatar_failed", { userId, message: error.message });
    return "";
  }
  const config = parseAvatarConfig(data?.config);
  return config ? JSON.stringify(config) : "";
}

/** Amis d'un compte et réglage de présence de chacun. */
export async function fetchFriendsWithPresenceSetting(userId: string): Promise<{ id: string; visibility: PresenceVisibility }[]> {
  if (!admin) return [];
  const { data: links, error } = await admin.from("friendships").select("user_a, user_b").or(`user_a.eq.${userId},user_b.eq.${userId}`);
  if (error || !links?.length) return [];
  const ids = links.map((link) => (link.user_a === userId ? link.user_b : link.user_a));
  const { data: settings } = await admin.from("user_privacy_settings").select("user_id, presence").in("user_id", ids);
  const byUser = new Map(settings?.map((s) => [s.user_id, s.presence as PresenceVisibility]));
  // Valeur par défaut de la base : présence visible des amis.
  return ids.map((id) => ({ id, visibility: byUser.get(id) ?? "friends" }));
}
