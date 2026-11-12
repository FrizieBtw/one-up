// Catalogue des jeux. Les réglages de lobby sont générés et validés à partir de ces schémas,
// côté client (interface) comme côté serveur (autorité).

export type SettingValue = number | boolean | string;

export type SettingDef =
  | { key: string; label: string; type: "select"; options: { value: number | string; label: string }[]; default: number | string }
  | { key: string; label: string; type: "int"; min: number; max: number; default: number }
  | { key: string; label: string; type: "bool"; default: boolean };

export interface GameDefinition {
  id: string;
  title: string;
  tagline: string;
  status: "available" | "soon";
  minPlayers: number;
  maxPlayers: number;
  settings: SettingDef[];
}

export const GAMES = [
  {
    id: "blackjack",
    title: "Blackjack Battle",
    tagline: "Battez le croupier, grimpez au classement.",
    status: "available",
    minPlayers: 1,
    maxPlayers: 6,
    settings: [
      {
        key: "decisionSeconds",
        label: "Temps de décision",
        type: "select",
        options: [10, 20, 30, 60].map((s) => ({ value: s, label: `${s} s` })),
        default: 20,
      },
    ],
  },
  {
    id: "kart",
    title: "Kart Rush",
    tagline: "Course arcade, dérapages et boosts.",
    status: "soon",
    minPlayers: 1,
    maxPlayers: 8,
    settings: [
      { key: "laps", label: "Nombre de tours", type: "int", min: 1, max: 10, default: 3 },
      { key: "collisions", label: "Collisions entre joueurs", type: "bool", default: true },
      { key: "bots", label: "Nombre de bots", type: "int", min: 0, max: 7, default: 0 },
      {
        key: "trackMode",
        label: "Sélection du circuit",
        type: "select",
        options: [
          { value: "direct", label: "Choix de l'hôte" },
          { value: "vote", label: "Vote" },
          { value: "random", label: "Aléatoire" },
        ],
        default: "vote",
      },
    ],
  },
  {
    id: "party",
    title: "Party Worlds",
    tagline: "Plateau, étoiles et mini-jeux.",
    status: "soon",
    minPlayers: 2,
    maxPlayers: 8,
    settings: [
      {
        key: "mode",
        label: "Mode",
        type: "select",
        options: [
          { value: "board", label: "Plateau" },
          { value: "minigames", label: "Mini-jeux" },
        ],
        default: "board",
      },
      { key: "turns", label: "Nombre de tours", type: "int", min: 5, max: 30, default: 10 },
    ],
  },
] as const satisfies readonly GameDefinition[];

export type GameId = (typeof GAMES)[number]["id"];
export const GAME_IDS = GAMES.map((g) => g.id) as [GameId, ...GameId[]];

export function getGame(id: string): GameDefinition | undefined {
  return GAMES.find((g) => g.id === id);
}

export function defaultSettings(game: GameDefinition): Record<string, SettingValue> {
  return Object.fromEntries(game.settings.map((s) => [s.key, s.default]));
}

export function isValidSetting(game: GameDefinition, key: string, value: unknown): value is SettingValue {
  const def = game.settings.find((s) => s.key === key);
  if (!def) return false;
  switch (def.type) {
    case "select":
      return def.options.some((o) => o.value === value);
    case "int":
      return typeof value === "number" && Number.isInteger(value) && value >= def.min && value <= def.max;
    case "bool":
      return typeof value === "boolean";
  }
}

/**
 * Raison empêchant l'hôte de lancer la partie, ou null si le lancement est permis.
 * Seuls les joueurs connectés comptent ; il faut une majorité stricte de joueurs prêts.
 */
export function launchBlocker(game: GameDefinition, players: readonly { ready: boolean; connected: boolean }[]): string | null {
  if (game.status !== "available") return "Ce jeu n'est pas encore disponible.";
  const present = players.filter((p) => p.connected);
  if (present.length < game.minPlayers) return `Il faut au moins ${game.minPlayers} joueurs.`;
  if (present.filter((p) => p.ready).length * 2 <= present.length) return "Plus de la moitié des joueurs doivent être prêts.";
  return null;
}

export function isValidCapacity(game: GameDefinition, capacity: unknown, currentPlayers = 0): capacity is number {
  return (
    typeof capacity === "number" &&
    Number.isInteger(capacity) &&
    capacity >= Math.max(game.minPlayers, currentPlayers) &&
    capacity <= game.maxPlayers
  );
}
