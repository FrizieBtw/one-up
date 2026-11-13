import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 240_000, // les pages WebGL en rendu logiciel ralentissent beaucoup sur une machine chargée
  // Séquentiel : chaque parcours ouvre plusieurs pages WebGL ; en parallèle, la charge fait expirer les fenêtres
  // de temps du jeu (manche suivante automatique après 15 s) et rend les parcours intermittents.
  workers: 1,
  expect: { timeout: 20_000 }, // même raison : une assertion de 5 s expire quand le rendu logiciel et la compilation ralentissent la page
  use: { baseURL: "http://localhost:3000", viewport: { width: 1280, height: 800 } },
  // Lance serveur de jeu + web, ou réutilise ceux déjà démarrés par `npm run dev`.
  webServer: { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 },
});
