import { guestLogin, openConsole } from "./helpers/guestLogin";
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

test("blackjack : jointure par code, lancement, deux manches, résultats, retour au lobby", async ({ browser }) => {
  const alice = await player(browser, "Alice");
  // Ouvrir la chambre crée son code et la rend visible dans « Chambres ouvertes » ; Blackjack est la cartouche par défaut.
  await alice.getByRole("button", { name: "Accès à la chambre : privée" }).click();
  const codeText = alice.getByText(/^[A-Z2-9]{4}$/);
  await expect(codeText).toBeVisible();
  const code = (await codeText.textContent())!;

  // Bob arrive dans la chambre d'Alice avec son code (4 cases, encoche « rejoindre » de la chambre).
  const bob = await player(browser, "Bob");
  await bob.getByLabel("Code de chambre, caractère 1").click();
  await bob.keyboard.type(code);
  await bob.getByRole("button", { name: "Rejoindre la chambre" }).click();
  await expect(bob.getByText("Chambre de Alice")).toBeVisible();
  await expect(alice.getByRole("button", { name: "Joueurs : 2 sur 4" })).toBeVisible();
  await expect(bob.getByRole("button", { name: "Joueurs : 2 sur 4" })).toBeVisible();

  // Lancement : réservé à l'hôte, annulable.
  await openConsole(bob);
  await expect(bob.getByRole("button", { name: "Lancer la partie" })).toHaveCount(0);
  await bob.keyboard.press("Escape");
  await openConsole(alice);
  await alice.getByRole("button", { name: "Lancer la partie" }).click();
  await expect(bob.getByText("La partie démarre dans")).toBeVisible();
  // Le compte à rebours dure 5 s : un clic classique attend que la page soit « stable » et peut y perdre la course
  // quand la machine est chargée. On déclenche donc le clic directement.
  await alice.getByRole("button", { name: "Annuler le lancement" }).dispatchEvent("click");
  await expect(bob.getByText("Lancement annulé.")).toBeVisible();
  await openConsole(alice);
  await alice.getByRole("button", { name: "Lancer la partie" }).click();

  // Après les 5 s de compte à rebours, tout le monde arrive en jeu (la manche 1 s'affiche juste après).
  // Son : réglage accessible et mémorisé.
  await alice.getByRole("button", { name: "Paramètres" }).click();
  await alice.getByRole("tab", { name: "Son" }).click();
  const effects = alice.getByRole("switch", { name: "Effets sonores" });
  await effects.click();
  await expect(effects).toHaveAttribute("aria-checked", "false");
  await expect(alice.getByLabel("Volume des effets sonores")).toBeDisabled();
  await alice.keyboard.press("Escape");

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
    await expect(page.getByText("Blackjack · 2 manches")).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(3); // en-tête + deux joueurs
  }
  await bob.waitForTimeout(600);
  await bob.screenshot({ path: "test-results/10-resultats.png" });

  await expect(bob.getByRole("button", { name: "Retour au lobby" })).toHaveCount(0);
  await alice.getByRole("button", { name: "Retour au lobby" }).click();
  for (const page of [alice, bob]) {
    await expect(page.getByText("Chambre de Alice")).toBeVisible(); // retour dans la chambre
    await expect(page.getByRole("button", { name: "Joueurs : 2 sur 4" })).toBeVisible();
  }
});
