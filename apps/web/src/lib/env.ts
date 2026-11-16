/**
 * Serveur de jeu : l'adresse configurée, sinon la machine qui sert la page sur le port 2567 (localhost, ou l'adresse du réseau local
 * quand un autre appareil ouvre le site : « localhost » y désignerait cet appareil, pas le serveur).
 */
export const GAME_SERVER_URL =
  process.env.NEXT_PUBLIC_GAME_SERVER_URL ??
  (typeof window === "undefined"
    ? "http://localhost:2567"
    : `${window.location.protocol}//${window.location.hostname}:2567`);
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
