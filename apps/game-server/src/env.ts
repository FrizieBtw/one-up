const isProd = process.env.NODE_ENV === "production";

function secret(name: string, devDefault: string): string {
  const value = process.env[name];
  if (value) return value;
  if (isProd) throw new Error(`Variable d'environnement manquante : ${name}`);
  return devDefault;
}

export const env = {
  port: Number(process.env.PORT ?? 2567),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  guestTokenSecret: secret("GUEST_TOKEN_SECRET", "dev-only-guest-secret"),
  // Optionnels : sans eux, seuls les invités peuvent se connecter.
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  // Optionnel : sans elle, les résultats de parties ne sont pas enregistrés. Ne jamais l'exposer au client.
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
};
