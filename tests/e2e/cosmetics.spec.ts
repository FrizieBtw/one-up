import { expect, test } from "@playwright/test";
import { SHOP, mockAccount, supabaseUrl } from "./helpers/mockAccount";

// Essaie chaque objet d'apparence de la boutique (tenues, accessoires, effets) sur l'aperçu 3D, de face
// (« réduire les animations » fige la rotation), et garde une capture de chacun. Vérifie surtout que rien ne casse le rendu.
test("les cosmétiques s'affichent sur l'avatar sans erreur de rendu", async ({ page }) => {
  const url = supabaseUrl();
  test.skip(!url, "apps/web/.env.local absent : pas d'URL Supabase à simuler");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("WebSocket") && !m.text().includes("net::") && errors.push(m.text()));

  await mockAccount(page, url!);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/profile");
  const header = page.locator("header");

  for (const item of SHOP.filter((i) => ["outfit", "accessory"].includes(i.category))) {
    // « Essayer au miroir » : l'objet est porté par l'aperçu du studio d'avatar.
    await header.getByRole("button", { name: "Boutique" }).click();
    await page.getByRole("button", { name: item.name, exact: true }).click();
    await page.getByRole("button", { name: "Essayer au miroir" }).click();
    await expect(page.getByText(`Essai : ${item.name}`)).toBeVisible();
    await page.waitForTimeout(500);
    await page.locator("div.relative").filter({ has: page.locator("canvas") }).first().screenshot({ path: `test-results/cosmetics/${item.id}.png` });
  }
  expect(errors).toEqual([]);
});
