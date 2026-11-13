import { expect, test } from "@playwright/test";
import { BOB, CAROL, DAN, ME, mockAccount, supabaseUrl } from "./helpers/mockAccount";

test("profil, avatar, amis, classements et confidentialité (base simulée)", async ({ page }) => {
  const url = supabaseUrl();
  test.skip(!url, "apps/web/.env.local absent : pas d'URL Supabase à simuler");
  const db = await mockAccount(page, url!);

  // --- Accueil : invitation facultative à personnaliser l'avatar ---
  await page.goto("/");
  const invite = page.getByText("Personnalisez votre avatar");
  await expect(invite).toBeVisible();
  await page.getByRole("button", { name: "Plus tard" }).click();
  await expect(invite).toBeHidden();
  await page.reload();
  await expect(page.getByRole("button", { name: "Mon profil" })).toBeVisible();
  await expect(invite).toBeHidden(); // mémorisé sur cet appareil

  // --- Profil ---
  await page.getByRole("button", { name: "Mon profil" }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole("heading", { name: ME.username })).toBeVisible();
  await expect(page.getByText("Niveau 2")).toBeVisible();
  await expect(page.getByText("50 / 200 XP avant le niveau 3")).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  await expect(page.getByRole("row", { name: /Blackjack Battle\s+3\s+1\s+7\s+22/ })).toBeVisible();
  const unlocked = page.getByRole("listitem").filter({ hasText: "Débloqué" });
  await expect(unlocked).toHaveCount(2);
  await expect(page.getByRole("listitem").filter({ hasText: "Habitué" })).not.toContainText("Débloqué");
  await expect(page.getByText(ME.public_id)).toBeVisible();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "test-results/12-profil.png" });

  // --- Éditeur d'avatar ---
  await page.getByRole("tab", { name: "Avatar" }).click();
  const save = page.getByRole("button", { name: "Enregistrer" });
  await expect(save).toBeDisabled(); // rien n'a changé
  await page.getByRole("radiogroup", { name: "Visage" }).getByRole("radio", { name: "Couettes" }).click();
  await page.getByRole("button", { name: "Couleur des cheveux 4" }).click();
  await page.getByRole("radiogroup", { name: "Haut" }).getByRole("radio", { name: "Rôdeur" }).click();
  await page.getByRole("radiogroup", { name: "Bas" }).getByRole("radio", { name: "Chevalier" }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "test-results/13-avatar.png" });
  await save.click();
  await expect(page.getByText("Avatar enregistré")).toBeVisible();
  expect(db.avatar).toMatchObject({ v: 3, face: "MagicalGirl", hairColor: "#ff5c6c", outfit: "Ranger", legs: "Knight" });
  await expect(save).toBeDisabled();

  // --- Amis ---
  await page.getByRole("tab", { name: /^Amis/ }).click();
  await expect(page.getByText("Carol_Demande veut être votre ami")).toBeVisible();
  const bobRow = page.getByRole("listitem").filter({ hasText: "Bob_Ami" }).filter({ hasText: "Niv." });
  await expect(bobRow).toContainText("En partie · Blackjack Battle"); // présence fournie par le serveur de jeu
  await page.getByLabel("Pseudo ou identifiant").fill("Da");
  await page.getByRole("button", { name: "Chercher" }).click();
  await expect(page.getByText("Dan_Inconnu")).toBeVisible();
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByText("Demande envoyée.")).toBeVisible();
  await expect(page.getByText("Demande envoyée à Dan_Inconnu")).toBeVisible();
  expect(db.sent).toEqual([DAN.id]);
  await page.getByRole("button", { name: "Accepter" }).click();
  await expect(page.getByText("Mes amis (2)")).toBeVisible();
  await expect(page.getByText("Carol_Demande veut être votre ami")).toHaveCount(0);
  await page.getByLabel("Pseudo ou identifiant").fill("zzz");
  await page.getByRole("button", { name: "Chercher" }).click();
  await expect(page.getByText("Aucun joueur trouvé.")).toBeVisible();
  await page.screenshot({ path: "test-results/14-amis.png" });

  // --- Classements ---
  await page.getByRole("tab", { name: "Classements" }).click();
  const global = page.getByRole("heading", { name: "Classement mondial" }).locator("xpath=..");
  await expect(global.getByRole("listitem")).toHaveText([/1\s*Bob_Ami.*420 XP/, /2\s*Zoé_Test.*150 XP/, /3\s*Carol_Demande.*90 XP/]);
  await expect(page.getByRole("heading", { name: "Entre amis" }).locator("xpath=..").getByRole("listitem")).toHaveCount(3);
  await page.screenshot({ path: "test-results/15-classements.png" });

  // --- Confidentialité ---
  await page.getByRole("tab", { name: "Confidentialité" }).click();
  await expect(page.getByLabel("Qui voit ma présence")).toHaveValue("friends"); // valeur par défaut
  await page.getByLabel("Qui voit ma présence").selectOption("nobody");
  await page.getByLabel("Qui peut m'envoyer une demande d'ami").selectOption("nobody");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Réglages enregistrés.")).toBeVisible();
  expect(db.privacy).toMatchObject({ presence: "nobody", friend_requests: "nobody", show_stats: "everyone" });

  // --- Retour aux jeux ---
  await page.getByRole("button", { name: "Retour aux jeux" }).click();
  await expect(page.getByRole("button", { name: "Blackjack Battle : ouvrir la cartouche" })).toBeVisible();
});

test("boutique, inventaire, aide de reprise et missions (base simulée)", async ({ page }) => {
  const url = supabaseUrl();
  test.skip(!url, "apps/web/.env.local absent : pas d'URL Supabase à simuler");
  const db = await mockAccount(page, url!);
  await page.goto("/profile");
  const header = page.locator("header");
  await expect(header.getByText("200 jetons")).toBeVisible();

  // --- Boutique : trop cher, essayage, achat en deux temps ---
  await page.getByRole("tab", { name: "Boutique" }).click();
  await expect(page.getByRole("button", { name: "Trop cher : Tenue de paladin" })).toBeDisabled(); // 250 > 200
  await page.getByRole("button", { name: "Accessoires" }).click();
  const glasses = page.getByRole("listitem").filter({ hasText: "Lunettes rondes" });
  await glasses.getByRole("button", { name: "Essayer" }).click();
  await expect(page.getByText("Aperçu : Lunettes rondes")).toBeVisible();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "test-results/16-boutique.png" });

  await page.getByRole("button", { name: "Acheter Casquette" }).click();
  await page.waitForTimeout(300);
  expect(db.purchases).toEqual([]); // un clic isolé n'achète rien : il faut confirmer
  await page.getByRole("button", { name: "Acheter Lunettes rondes" }).click();
  await page.getByRole("button", { name: "Confirmer l'achat" }).click();
  await expect(page.getByText("Lunettes rondes : Achat effectué !")).toBeVisible();
  expect(db.purchases).toEqual(["acc_glasses"]);
  await expect(glasses).toContainText("Possédé");
  await expect(header.getByText("100 jetons")).toBeVisible();

  // --- Inventaire : équipement, historique ---
  await page.getByRole("tab", { name: "Inventaire" }).click();
  await page.getByRole("button", { name: "Équiper Lunettes rondes" }).click();
  await expect(page.getByRole("button", { name: "Retirer Lunettes rondes" })).toBeVisible();
  expect(db.inventory).toEqual([{ item_id: "acc_glasses", equipped: true }]);
  await expect(page.getByRole("row", { name: /Achat : Lunettes rondes\s+-100\s+100/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Solde de départ\s+\+200\s+200/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Réclamer l'aide de reprise" })).toHaveCount(0); // solde suffisant

  // --- Solde épuisé : l'aide de reprise apparaît, une seule fois ---
  await page.getByRole("tab", { name: "Boutique" }).click();
  await page.getByRole("button", { name: "Accessoires" }).click();
  await page.getByRole("button", { name: "Acheter Casquette" }).click();
  await page.getByRole("button", { name: "Confirmer l'achat" }).click();
  await expect(header.getByText("0 jetons")).toBeVisible();
  await page.getByRole("tab", { name: "Inventaire" }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "test-results/17-inventaire.png" });
  await page.getByRole("button", { name: "Réclamer l'aide de reprise" }).click();
  await expect(page.getByText("Aide de reprise versée.")).toBeVisible();
  await expect(header.getByText("100 jetons")).toBeVisible();
  expect(db.claimed).toBe(1);
  await expect(page.getByRole("button", { name: "Réclamer l'aide de reprise" })).toHaveCount(0);

  // --- Missions ---
  await page.getByRole("tab", { name: "Missions" }).click();
  await expect(page.getByRole("heading", { name: "Missions du jour" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Progression : Trois manches gagnées" })).toHaveAttribute("aria-valuenow", "2");
  await expect(page.getByRole("progressbar", { name: "Progression : Une partie par jour" })).toHaveAttribute("aria-valuenow", "0");
  await expect(page.getByRole("heading", { name: "Défis" })).toBeVisible();
  await expect(page.getByText("Joueur régulier")).toBeVisible();
  await page.screenshot({ path: "test-results/18-missions.png" });
});
