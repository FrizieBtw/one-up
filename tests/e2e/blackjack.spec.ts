import { guestLogin } from "./helpers/guestLogin";
import { noAvatarModels } from "./helpers/noAvatarModels";
import { expect, test, type Browser, type Page } from "@playwright/test";

async function player(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  await noAvatarModels(context);
  const page = await context.newPage();
  await page.goto("/");
  await guestLogin(page, name);
  return page;
}

/** Joue une manche : chaque joueur reste dès que c'est son tour (les cartes sont aléatoires). */
async function standUntilRoundEnds(pages: Page[], round: number) {
  const done = pages[0]!.getByText(`Manche ${round} terminée`);
  await expect(async () => {
    for (const page of pages) {
      const stand = page.getByRole("button", { name: "Rester" });
      // Clic direct : l'attente de stabilité d'un clic classique dépend du rythme d'affichage, très ralenti par le rendu 3D logiciel.
      if ((await stand.isVisible()) && (await stand.isEnabled())) await stand.dispatchEvent("click");
    }
    await expect(done).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 40_000 });
}

test("blackjack : recherche publique, lancement, deux manches, résultats, retour au lobby", async ({ browser }) => {
  const alice = await player(browser, "Alice");
  await alice.getByRole("button", { name: "Blackjack Battle : ouvrir la cartouche" }).click();
  await alice.getByRole("button", { name: "Créer une partie" }).click();
  await alice.getByRole("button", { name: "Salon public" }).click();
  await expect(alice.getByText("Joueurs 1/6")).toBeVisible();

  // Bob trouve le salon dans la recherche publique de la cartouche.
  const bob = await player(browser, "Bob");
  await bob.getByRole("button", { name: "Blackjack Battle : ouvrir la cartouche" }).click();
  await bob.getByRole("button", { name: "Chercher une partie" }).click();
  await expect(bob.getByText("Salon de Alice")).toBeVisible();
  await bob.waitForTimeout(800);
  await bob.screenshot({ path: "test-results/7-recherche.png" });
  await bob.getByRole("button", { name: "Rejoindre", exact: true }).click();
  await expect(alice.getByText("Joueurs 2/6")).toBeVisible();

  // Lancement : bloqué sans majorité de prêts, réservé à l'hôte, annulable.
  const launch = alice.getByRole("button", { name: "Lancer la partie" });
  await expect(launch).toBeDisabled();
  await expect(alice.getByText("Plus de la moitié des joueurs doivent être prêts.")).toBeVisible();
  await expect(bob.getByRole("button", { name: "Lancer la partie" })).toHaveCount(0);
  await alice.getByRole("button", { name: "Je suis prêt" }).click();
  await bob.getByRole("button", { name: "Je suis prêt" }).click();
  await launch.click();
  await expect(bob.getByText("La partie démarre dans")).toBeVisible();
  // Le compte à rebours dure 5 s : un clic classique attend que la page soit « stable » et peut y perdre la course
  // quand la machine est chargée. On déclenche donc le clic directement.
  await alice.getByRole("button", { name: "Annuler le lancement" }).dispatchEvent("click");
  await expect(bob.getByRole("listitem").filter({ hasText: "Lancement annulé." })).toBeVisible();
  await launch.click();

  // Console : la séquence d'insertion joue chez tous. Bob la passe et arrive tout de suite en jeu (la scène est prête) ;
  // Alice la regarde jusqu'au bout.
  const sequence = (page: Page) => page.getByText(/Insertion de Blackjack Battle|Chargement du jeu/);
  await expect(sequence(alice)).toBeVisible({ timeout: 10_000 }); // après les 5 s de compte à rebours
  await bob.getByRole("button", { name: "Passer l'animation" }).click();
  await expect(sequence(bob)).toHaveCount(0);
  await expect(alice.getByText("Insertion de Blackjack Battle…")).toBeVisible();
  await alice.waitForTimeout(1100);
  await alice.screenshot({ path: "test-results/11-console.png" });
  await expect(sequence(alice)).toHaveCount(0);

  // Son : réglage accessible et mémorisé.
  await alice.getByRole("button", { name: "Son activé" }).click();
  await expect(alice.getByRole("button", { name: "Son coupé" })).toHaveAttribute("aria-pressed", "true");
  await expect(alice.getByLabel("Volume des effets sonores")).toBeDisabled();

  // Manche 1.
  await expect(bob.getByRole("heading", { name: "Manche 1" })).toBeVisible({ timeout: 10_000 });
  await expect(alice.getByText(/Croupier : \d+ \+ carte cachée/)).toBeVisible();
  await alice.waitForTimeout(1500);
  await alice.screenshot({ path: "test-results/8-table.png" });
  await standUntilRoundEnds([alice, bob], 1);
  await expect(alice.getByText("carte cachée")).toHaveCount(0);
  await alice.waitForTimeout(800);
  await alice.screenshot({ path: "test-results/9-fin-manche.png" });

  // Chat en jeu.
  await bob.getByLabel("Message").fill("bien joué");
  await bob.getByRole("button", { name: "Envoyer" }).click();
  await expect(alice.getByText("bien joué")).toBeVisible();

  // Manche 2 puis fin de session : seul l'hôte décide.
  await expect(bob.getByRole("button", { name: "Manche suivante" })).toHaveCount(0);
  await alice.getByRole("button", { name: "Manche suivante" }).click();
  await expect(bob.getByRole("heading", { name: "Manche 2" })).toBeVisible();
  await standUntilRoundEnds([alice, bob], 2);
  await alice.getByRole("button", { name: "Terminer la session" }).click();

  for (const page of [alice, bob]) {
    await expect(page.getByRole("heading", { name: "Résultats" })).toBeVisible();
    await expect(page.getByText("Blackjack Battle · 2 manches")).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(3); // en-tête + deux joueurs
  }
  await bob.waitForTimeout(600);
  await bob.screenshot({ path: "test-results/10-resultats.png" });

  await expect(bob.getByRole("button", { name: "Retour au lobby" })).toHaveCount(0);
  await alice.getByRole("button", { name: "Retour au lobby" }).click();
  for (const page of [alice, bob]) {
    await expect(page.getByText("Joueurs 2/6")).toBeVisible();
    await expect(page.getByRole("button", { name: "Je suis prêt" })).toBeVisible(); // statuts remis à zéro
  }
});
