import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  // Séquentiel : chaque parcours ouvre plusieurs pages WebGL ; en parallèle, la charge fait expirer les fenêtres
  // de temps du jeu (manche suivante automatique après 15 s) et rend les parcours intermittents.
  workers: 1,
  use: { baseURL: "http://localhost:3000", viewport: { width: 1280, height: 800 } },
  // Lance serveur de jeu + web, ou réutilise ceux déjà démarrés par `npm run dev`.
  webServer: { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 },
});
