import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:3000", viewport: { width: 1280, height: 800 } },
  // Lance serveur de jeu + web, ou réutilise ceux déjà démarrés par `npm run dev`.
  webServer: { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 },
});
