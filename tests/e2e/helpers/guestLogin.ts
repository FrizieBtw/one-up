import type { Page } from "@playwright/test";

/**
 * Entre en invité depuis l'écran de connexion. Avec Supabase configuré, le formulaire invité est derrière le lien
 * « Jouer en invité » ; sans Supabase, il est affiché d'emblée.
 */
export async function guestLogin(page: Page, name: string) {
  // Le pseudo d'un invité est aléatoire : les tests l'imposent pour reconnaître leurs joueurs.
  await page.evaluate((n) => sessionStorage.setItem("stepup-guest-name", n), name);
  const link = page.getByRole("button", { name: "Jouer en invité" });
  const enter = page.getByRole("button", { name: "Entrer", exact: true });
  await link.or(enter).first().waitFor();
  if (await link.isVisible()) await link.click();
  await enter.click();
}

/**
 * De la chambre à l'écran Console (grille des jeux). L'hologramme n'apparaît que près de la console : on déclenche son clic
 * directement, comme le ferait un lecteur d'écran, sans déplacer l'avatar.
 */
export async function openConsole(page: Page) {
  await page.getByRole("button", { name: "Console : Choisir un jeu" }).dispatchEvent("click");
}
