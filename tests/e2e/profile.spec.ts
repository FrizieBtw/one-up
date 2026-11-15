import { expect, test } from "@playwright/test";
import { openConsole } from "./helpers/guestLogin";
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
  await expect(page).toHaveURL("http://localhost:3000/"); // la route ne change pas : le profil est un écran de la chambre
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByText(ME.username)).toBeVisible();
  await expect(panel.getByText("Niv. 2")).toBeVisible();
  await expect(page.getByText("50 / 200 XP avant le niveau 3")).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  await expect(page.getByRole("row", { name: /Blackjack\s+3\s+1\s+7\s+22/ })).toBeVisible();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "test-results/12-profil.png" });

  // --- Succès ---
  await page.getByRole("tab", { name: "Succès" }).click();
  const unlocked = page.getByRole("listitem").filter({ hasText: "Débloqué" });
  await expect(unlocked).toHaveCount(2);
  await expect(page.getByRole("listitem").filter({ hasText: "Habitué" })).not.toContainText("Débloqué");

  // --- Éditeur d'avatar ---
  // Le miroir de la chambre ouvre l'éditeur (l'infobulle n'apparaît qu'à côté : on déclenche son clic directement).
  await page.locator("header").getByRole("button", { name: "Chambre" }).click();
  await page.getByRole("button", { name: "Miroir : Modifier mon avatar" }).dispatchEvent("click");
  const save = page.getByRole("button", { name: "Valider" });
  await page.getByRole("radiogroup", { name: "Visage" }).getByRole("radio", { name: "Longs cheveux blonds" }).click();
  await page.getByRole("button", { name: "Cheveux & barbe 3" }).click();
  await page.getByRole("tab", { name: "Haut" }).click();
  await page.getByRole("radiogroup", { name: "Haut" }).getByRole("radio", { name: "Pilote" }).click();
  await page.getByRole("tab", { name: "Bas" }).click();
  await page.getByRole("radiogroup", { name: "Bas" }).getByRole("radio", { name: "Pilote" }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "test-results/13-avatar.png" });
  await save.click();
  await expect(page.getByText("Avatar enregistré")).toBeVisible();
  expect(db.avatar).toMatchObject({ v: 3, face: "Witch", hairColor: "#f2c14e", outfit: "Driver", legs: "Driver" });
  // Valider referme le studio : retour à la chambre, puis au profil.
  await expect(page.getByText(`Chambre de ${ME.username}`)).toBeVisible();
  await page.getByRole("button", { name: "Mon profil" }).click();

  // --- Amis ---
  await page.getByRole("tab", { name: /^Social/ }).click();
  await expect(page.getByText("Carol_Demande veut être votre ami")).toBeVisible();
  const bobRow = page.getByRole("listitem").filter({ hasText: "Bob_Ami" }).filter({ hasText: "Niv." });
  await expect(bobRow).toContainText("En partie · Blackjack"); // présence fournie par le serveur de jeu
  await page.getByLabel("Pseudo").fill("Da");
  await page.getByRole("button", { name: "Chercher" }).click();
  await expect(page.getByText("Dan_Inconnu")).toBeVisible();
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByText("Demande envoyée.")).toBeVisible();
  await expect(page.getByText("Demande envoyée à Dan_Inconnu")).toBeVisible();
  expect(db.sent).toEqual([DAN.id]);
  await page.getByRole("button", { name: "Accepter" }).click();
  await expect(page.getByText("Mes amis (2)")).toBeVisible();
  await expect(page.getByText("Carol_Demande veut être votre ami")).toHaveCount(0);
  await page.getByLabel("Pseudo").fill("zzz");
  await page.getByRole("button", { name: "Chercher" }).click();
  await expect(page.getByText("Aucun joueur trouvé.")).toBeVisible();
  await page.screenshot({ path: "test-results/14-amis.png" });

  // --- Classements ---
  await page.getByRole("tab", { name: "Classement" }).click();
  await expect(page.getByRole("region", { name: "Entre amis" }).getByRole("list", { name: "Podium" }).getByRole("listitem")).toHaveCount(3);
  await page.getByRole("tab", { name: "Général" }).click();
  // Le podium est rangé 2e, 1er, 3e.
  await expect(page.getByRole("region", { name: "Classement mondial" }).getByRole("list", { name: "Podium" }).getByRole("listitem")).toHaveText([/Zoé_Test.*150 XP/, /Bob_Ami.*420 XP/, /Carol_Demande.*90 XP/]);
  await page.screenshot({ path: "test-results/15-classements.png" });

  // --- Confidentialité ---
  await page.getByRole("button", { name: "Paramètres" }).click();
  await page.getByRole("tab", { name: "Confidentialité" }).click();
  const presence = page.getByRole("tablist", { name: "Qui voit si je suis en ligne" });
  await expect(presence.getByRole("tab", { name: "Amis" })).toHaveAttribute("aria-selected", "true"); // valeur par défaut
  await presence.getByRole("tab", { name: "Personne" }).click();
  await page.getByRole("tablist", { name: "Demandes d'ami" }).getByRole("tab", { name: "Personne" }).click();
  await expect(page.getByText("Réglages enregistrés.")).toBeVisible();
  await page.keyboard.press("Escape");
  expect(db.privacy).toMatchObject({ presence: "nobody", friend_requests: "nobody", show_stats: "everyone" });

  // --- Retour à la chambre ---
  await page.getByRole("button", { name: "Chambre" }).click();
  await expect(page.getByText(`Chambre de ${ME.username}`)).toBeVisible();
  await openConsole(page);
  await expect(page.getByRole("button", { name: /^Blackjack/ })).toBeVisible();
});

test("boutique, inventaire et missions (base simulée)", async ({ page }) => {
  const url = supabaseUrl();
  test.skip(!url, "apps/web/.env.local absent : pas d'URL Supabase à simuler");
  const db = await mockAccount(page, url!);
  await page.goto("/profile");
  const header = page.locator("header");
  await expect(header.getByText("200", { exact: true })).toBeVisible();

  // --- Boutique : trop cher, essayage, achat en deux temps ---
  await header.getByRole("button", { name: "Boutique" }).click();
  await page.getByRole("button", { name: "Tenue de paladin", exact: true }).click();
  await page.getByRole("button", { name: /^Acheter · 250/ }).click();
  await expect(page.getByText("Il te manque 50 jetons.")).toBeVisible(); // 250 > 200
  const glasses = page.getByRole("button", { name: "Lunettes rondes", exact: true });
  await glasses.click();
  await expect(page.getByRole("complementary", { name: "Détail" }).getByText("Lunettes rondes")).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/16-boutique.png" });

  expect(db.purchases).toEqual([]); // choisir un objet n'achète rien
  await page.getByRole("button", { name: /^Acheter · 100/ }).click();
  await expect(page.getByText("Lunettes rondes : Achat effectué !")).toBeVisible();
  expect(db.purchases).toEqual(["acc_glasses"]);
  await expect(glasses).toContainText("Possédé");
  await expect(header.getByText("100", { exact: true })).toBeVisible();

  // --- Équipement depuis le détail, puis historique ---
  await page.getByRole("button", { name: "Équiper", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retirer", exact: true })).toBeVisible();
  expect(db.inventory).toEqual([{ item_id: "acc_glasses", equipped: true }]);
  await header.getByRole("button", { name: "Mon profil" }).click();
  await page.getByRole("tab", { name: "Historique" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Achat : Lunettes rondes" })).toContainText("-100");
  await expect(page.getByRole("listitem").filter({ hasText: "Solde de départ" })).toContainText("+200");

  // --- Missions ---
  await page.getByRole("tab", { name: "Missions" }).click();
  await expect(page.getByRole("heading", { name: "Missions du jour" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Progression : Trois manches gagnées" })).toHaveAttribute("aria-valuenow", "2");
  await expect(page.getByRole("progressbar", { name: "Progression : Une partie par jour" })).toHaveAttribute("aria-valuenow", "0");
  await expect(page.getByRole("heading", { name: "Défis" })).toBeVisible();
  await expect(page.getByText("Joueur régulier")).toBeVisible();
  await page.screenshot({ path: "test-results/18-missions.png" });
});
