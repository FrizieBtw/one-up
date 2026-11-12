import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { playerNameSchema, type Identity } from "@stepup/shared";
import { env } from "./env";

const GUEST_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const sign = (payload: string) => createHmac("sha256", env.guestTokenSecret).update(payload).digest("base64url");

/** Jeton invité : `<payload base64url>.<HMAC>`. Un seul point, donc distinguable d'un JWT Supabase. */
export function issueGuestToken(name: string, now = Date.now()): { token: string; identity: Identity } {
  const identity: Identity = { id: `guest_${randomUUID()}`, name, kind: "guest" };
  const payload = Buffer.from(JSON.stringify({ ...identity, exp: now + GUEST_TOKEN_TTL_MS })).toString("base64url");
  return { token: `${payload}.${sign(payload)}`, identity };
}

export function verifyGuestToken(token: string, now = Date.now()): Identity | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const { id, name, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
  return exp > now ? { id, name, kind: "guest" } : null;
}

async function verifySupabaseToken(token: string): Promise<Identity | null> {
  if (!env.supabaseUrl || !env.supabaseAnonKey) return null;
  // Client porteur du jeton de l'utilisateur : la lecture du profil passe par les politiques RLS.
  const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: profile } = await supabase.from("profiles").select("username").eq("id", data.user.id).single();
  const name = playerNameSchema.safeParse(profile?.username);
  return name.success ? { id: data.user.id, name: name.data, kind: "user" } : null;
}

export async function verifyToken(token: string | undefined): Promise<Identity | null> {
  if (!token) return null;
  return token.split(".").length === 2 ? verifyGuestToken(token) : verifySupabaseToken(token);
}
