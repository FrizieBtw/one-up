import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import { AVATAR_FACES, AVATAR_OUTFITS } from "../../packages/shared/src/avatar";

// Vignettes de l'éditeur d'avatar (visages, hauts et bas KayKit), générées par /dev/avatar-thumbs.
// Pour les régénérer dans apps/web/public/models/kaykit/thumbs/ : UPDATE_THUMBS=1 npx playwright test avatarThumbs
const OUT = join(__dirname, "../../apps/web/public/models/kaykit/thumbs");

test("vignettes des visages et des tenues", async ({ page }) => {
  await page.goto("/dev/avatar-thumbs");
  await page.waitForFunction(() => Boolean((window as unknown as { __thumbs?: unknown }).__thumbs), null, { timeout: 120_000 });
  const thumbs = await page.evaluate(() => (window as unknown as { __thumbs: Record<string, string> }).__thumbs);
  expect(Object.keys(thumbs).sort()).toEqual([...AVATAR_FACES.map((f) => `faces/${f}.png`), ...AVATAR_OUTFITS.flatMap((o) => [`tops/${o}.png`, `bottoms/${o}.png`])].sort());
  if (process.env.UPDATE_THUMBS) {
    for (const [file, url] of Object.entries(thumbs)) {
      mkdirSync(dirname(join(OUT, file)), { recursive: true });
      writeFileSync(join(OUT, file), Buffer.from(url.split(",")[1]!, "base64"));
    }
  }
});
