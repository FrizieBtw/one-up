import { expect, test } from "@playwright/test";
import { HEADS } from "../../apps/web/src/avatar/parts/catalogue";

// Planche de contrôle du découpage des têtes KayKit (outil interne /dev/avatar-parts) : toutes les têtes se chargent et se
// classent sans erreur, et une capture par page est gardée dans test-results/ pour la relecture visuelle.
const PAGES = Math.ceil(HEADS.length / 8);

for (let n = 0; n < PAGES; n++) {
  test(`planche des têtes, page ${n + 1}/${PAGES}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`/dev/avatar-parts?page=${n}`);
    await page.waitForFunction(() => (window as unknown as { __done?: boolean }).__done === true, null, { timeout: 90_000 });
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    const lines = await page.getByRole("list", { name: "Rôles par tête" }).getByRole("listitem").allInnerTexts();
    expect(lines.filter((l) => l.includes("ERREUR"))).toEqual([]);
    await page.locator("canvas").screenshot({ path: `test-results/avatar-parts-${n}.png` });
    console.log(lines.join("\n"));
    expect(errors).toEqual([]);
  });
}
