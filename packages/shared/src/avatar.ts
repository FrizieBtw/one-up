import { z } from "zod";

// Options d'avatar gratuites. Source unique : l'éditeur, le rendu et la validation serveur en dérivent.
export const AVATAR_OPTIONS = {
  skin: ["#ffd9b8", "#f2b98f", "#c98a5e", "#8a5a3c"],
  hair: ["#2a1b4d", "#6b3a1e", "#f2c14e", "#ff5c6c", "#14c4bd", "#f4f0ff"],
  outfit: ["#6c3bf5", "#14c4bd", "#ff8a1f", "#ff5c6c", "#ffd23f", "#3fa7ff"],
  hairStyle: [0, 1, 2],
  eyeStyle: [0, 1],
} as const;

export const avatarConfigSchema = z.object({
  skin: z.enum(AVATAR_OPTIONS.skin),
  hair: z.enum(AVATAR_OPTIONS.hair),
  outfit: z.enum(AVATAR_OPTIONS.outfit),
  hairStyle: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  eyeStyle: z.union([z.literal(0), z.literal(1)]),
});
export type AvatarConfig = z.infer<typeof avatarConfigSchema>;

/** Configuration valide, ou null (JSON absent, corrompu ou hors des options autorisées). */
export function parseAvatarConfig(value: unknown): AvatarConfig | null {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const parsed = avatarConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
