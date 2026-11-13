import type { Page } from "@playwright/test";

/**
 * Entre en invité depuis l'écran de connexion. Avec Supabase configuré, le formulaire invité est derrière le lien
 * « Jouer en invité » ; sans Supabase, il est affiché d'emblée.
 */
export async function guestLogin(page: Page, name: string) {
  const link = page.getByRole("button", { name: "Jouer en invité" });
  const field = page.getByLabel("Pseudo");
  await link.or(field).first().waitFor();
  if (await link.isVisible()) await link.click();
  await field.first().fill(name);
  await page.getByRole("button", { name: "Entrer", exact: true }).click();
}
