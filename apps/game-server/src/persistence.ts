import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

export interface MatchParticipant {
  user_id: string;
  rank: number;
  score: number;
  wins: number;
  pushes: number;
  losses: number;
}

const admin =
  env.supabaseUrl && env.supabaseServiceRoleKey
    ? createClient(env.supabaseUrl, env.supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;

/**
 * Enregistre une session terminée (comptes uniquement, les invités n'ont pas de progression).
 * Idempotent côté base grâce à `sessionId`. Sans Supabase configuré, ne fait rien.
 * Ne lève jamais : un échec de sauvegarde ne doit pas casser la partie.
 */
export async function recordMatch(sessionId: string, gameId: string, rounds: number, participants: MatchParticipant[]): Promise<void> {
  if (!admin || participants.length === 0) return;
  const { error } = await admin.rpc("record_match", {
    p_session_id: sessionId,
    p_game_id: gameId,
    p_rounds: rounds,
    p_participants: participants,
  });
  if (error) console.error(JSON.stringify({ event: "record_match_failed", sessionId, gameId, message: error.message }));
}
