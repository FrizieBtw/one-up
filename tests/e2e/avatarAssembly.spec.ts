import { expect, test } from "@playwright/test";

// Essai d'assemblage de pièces KayKit (outil interne /dev/avatar-assembly) : toutes les combinaisons se construisent
// sans erreur ; la capture est gardée dans test-results/ pour la relecture visuelle.
test("assemblage de pièces et recoloration", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/dev/avatar-assembly");
  await page.waitForFunction(() => (window as unknown as { __done?: boolean }).__done === true, null, { timeout: 90_000 });
  const lines = await page.getByRole("list", { name: "Assemblages" }).getByRole("listitem").allInnerTexts();
  expect(lines.filter((l) => l.includes("ERREUR"))).toEqual([]);
  await page.locator("canvas").screenshot({ path: "test-results/avatar-assembly.png" });
  expect(errors).toEqual([]);
});
