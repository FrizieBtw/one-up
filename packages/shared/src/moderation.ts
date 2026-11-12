// Filtre de chat de premier niveau, appliqué par le serveur avant diffusion.
// shortcut: liste de départ volontairement courte ; à remplacer par une liste maintenue
// (ou un service de modération) avant toute ouverture publique.
const BANNED = ["connard", "connasse", "salope", "pute", "encule", "merde", "nique", "pd", "fuck", "shit", "bitch", "asshole", "nigger", "nigga", "faggot", "retard"];

const strip = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Masque les mots interdits (insensible à la casse et aux accents). */
export function filterChat(text: string): string {
  return text.replace(/[\p{L}\p{N}]+/gu, (word) => (BANNED.includes(strip(word)) ? "*".repeat(word.length) : word));
}
