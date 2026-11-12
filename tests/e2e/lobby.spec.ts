import { expect, test, type Browser, type Page } from "@playwright/test";

async function player(browser: Browser, name: string, path = "/"): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(path);
  await page.getByLabel("Pseudo").first().fill(name);
  await page.getByRole("button", { name: "Entrer" }).click();
  return page;
}

test("cartouche → création, jointure par code, réglages, lien de partage, départ de l'hôte", async ({ browser }) => {
  // Alice retourne la cartouche Kart Rush et crée un salon privé.
  const alice = await player(browser, "Alice");
  await alice.getByRole("button", { name: "Kart Rush : ouvrir la cartouche" }).click();
  const back = alice.getByRole("dialog", { name: "Kart Rush" });
  await expect(back.getByRole("button", { name: "Chercher une partie" })).toBeVisible();
  await alice.waitForTimeout(1200); // fin du retournement, pour la capture
  await alice.screenshot({ path: "test-results/1-dos-cartouche.png" });

  // Échap : sous-panneau → menu → accueil.
  await back.getByRole("button", { name: "Rejoindre par code" }).click();
  await alice.keyboard.press("Escape");
  await expect(back.getByRole("button", { name: "Créer une partie" })).toBeVisible();
  await alice.keyboard.press("Escape");
  await expect(back).toBeHidden();
  await alice.waitForTimeout(1200);
  await alice.screenshot({ path: "test-results/0-grille.png" });

  await alice.getByRole("button", { name: "Kart Rush : ouvrir la cartouche" }).click();
  await back.getByRole("button", { name: "Créer une partie" }).click();
  await back.getByRole("button", { name: "Salon privé" }).click();
  await expect(alice).toHaveURL(/\/lobby\/[A-Z2-9]{6}$/);
  const code = alice.url().split("/").pop()!;
  await expect(alice.getByText("Joueurs 1/8")).toBeVisible();

  // Bob : code inconnu refusé, puis jointure par code depuis une autre cartouche.
  const bob = await player(browser, "Bob");
  await bob.getByRole("button", { name: "Blackjack Battle : ouvrir la cartouche" }).click();
  await bob.getByRole("button", { name: "Rejoindre par code" }).click();
  await bob.getByLabel("Code du salon").fill("ZZZZZZ");
  await bob.getByRole("button", { name: "Rejoindre", exact: true }).click();
  await expect(bob.getByText("Salon introuvable")).toBeVisible();
  await bob.getByLabel("Code du salon").fill(code.toLowerCase());
  await bob.getByRole("button", { name: "Rejoindre", exact: true }).click();
  await expect(bob).toHaveURL(new RegExp(`/lobby/${code}$`));
  await expect(bob.getByRole("heading", { name: "Kart Rush" })).toBeVisible();
  await expect(alice.getByText("Joueurs 2/8")).toBeVisible();

  // Salon privé : absent de la recherche publique.
  const carol = await player(browser, "Carol");
  await carol.getByRole("button", { name: "Kart Rush : ouvrir la cartouche" }).click();
  await carol.getByRole("button", { name: "Chercher une partie" }).click();
  await expect(carol.getByText("Aucun salon public")).toBeVisible();

  // Alice ouvre les règles au dos de la mini cartouche ; Bob est notifié et reste prêt.
  await bob.getByRole("button", { name: "Je suis prêt" }).click();
  await alice.waitForTimeout(1200);
  await alice.screenshot({ path: "test-results/2-lobby.png" });
  await alice.getByRole("button", { name: "Règles de la partie : ouvrir la cartouche" }).click();
  const rules = alice.getByRole("dialog", { name: "Règles de la partie" });
  await rules.getByLabel("Nombre de tours").selectOption("5");
  await expect(bob.getByRole("status").filter({ hasText: "Règle modifiée : Nombre de tours." })).toBeVisible();
  await expect(bob.getByRole("button", { name: "Annuler prêt" })).toBeVisible();
  await alice.waitForTimeout(1200);
  await alice.screenshot({ path: "test-results/3-regles.png" });
  await alice.keyboard.press("Escape");
  await expect(rules).toBeHidden();

  // Bob (non hôte) propose une règle ; Alice vote puis valide. Le vote seul ne change rien.
  await bob.getByRole("button", { name: "Règles de la partie : ouvrir la cartouche" }).click();
  await expect(bob.getByRole("dialog").getByLabel("Nombre de tours")).toHaveValue("5");
  await bob.getByRole("dialog").getByLabel("Nombre de tours").selectOption("7");
  await bob.keyboard.press("Escape");
  await expect(alice.getByText("Bob propose : Nombre de tours → 7")).toBeVisible();
  await expect(bob.getByRole("button", { name: "Valider" })).toHaveCount(0);
  await bob.getByRole("button", { name: /^Pour/ }).click();
  await alice.getByRole("button", { name: /^Contre/ }).click();
  await expect(bob.getByRole("button", { name: "Pour (1)" })).toBeVisible();
  await expect(bob.getByRole("button", { name: "Contre (1)" })).toBeVisible();
  await alice.screenshot({ path: "test-results/4-proposition.png" });
  await alice.getByRole("button", { name: "Valider" }).click();
  await expect(bob.getByRole("status").filter({ hasText: "Proposition validée : Nombre de tours." })).toBeVisible();
  await expect(alice.getByText("Bob propose : Nombre de tours → 7")).toHaveCount(0);
  await alice.getByRole("button", { name: "Règles de la partie : ouvrir la cartouche" }).click();
  await expect(rules.getByLabel("Nombre de tours")).toHaveValue("7");
  await alice.keyboard.press("Escape");

  // Déplacement : Bob marche au clavier, Alice voit sa position serveur évoluer.
  const bobSession = await bob.evaluate(() => (window as any).__lobbyRoom.sessionId as string);
  const bobX = () => alice.evaluate((id) => (window as any).__lobbyRoom.state.players.get(id).x as number, bobSession);
  const before = await bobX();
  await bob.locator("body").click({ position: { x: 640, y: 400 } });
  await bob.keyboard.down("ArrowLeft");
  await bob.waitForTimeout(400);
  await bob.keyboard.up("ArrowLeft");
  await bob.waitForTimeout(300);
  expect(before - (await bobX())).toBeGreaterThan(0.8);
  const settled = await bobX();
  await bob.waitForTimeout(300);
  expect(await bobX()).toBe(settled); // arrêté dès la touche relâchée

  // Emote au clavier, chat filtré, blocage local.
  await bob.keyboard.press("Digit2");
  await bob.getByLabel("Message").fill("merde alors");
  await bob.getByRole("button", { name: "Envoyer" }).click();
  await expect(alice.getByText("***** alors")).toBeVisible();
  await alice.waitForTimeout(600);
  await alice.screenshot({ path: "test-results/5-salle-3d.png" });
  await alice.getByRole("button", { name: "Bloquer Bob" }).click();
  await expect(alice.getByText("***** alors")).toHaveCount(0);
  await alice.getByRole("button", { name: "Débloquer Bob" }).click();
  await expect(alice.getByText("***** alors")).toBeVisible();
  await alice.getByRole("button", { name: "Signaler Bob" }).click();
  await bob.keyboard.press("Digit2");
  await alice.waitForTimeout(500);
  await alice.screenshot({ path: "test-results/6-salle-3d-apres.png" });
  await expect(alice.getByText("Signalement de Bob envoyé.")).toBeVisible();

  // Lien de partage : Dan n'est pas connecté, il s'identifie puis arrive dans le salon.
  const dan = await player(browser, "Dan", `/lobby/${code}`);
  await expect(dan.getByText("Joueurs 3/8")).toBeVisible();

  // Rechargement : Bob retrouve son siège, sans doublon.
  await bob.reload();
  await expect(bob.getByText("Joueurs 3/8")).toBeVisible();
  await expect(bob.getByText("Bob (vous)")).toBeVisible();

  // Retour navigateur d'Alice (hôte) : elle quitte, le rôle passe à Bob.
  await alice.goBack();
  await expect(alice.getByRole("button", { name: "Kart Rush : ouvrir la cartouche" })).toBeVisible();
  await expect(bob.getByText("Joueurs 2/8")).toBeVisible();
  await expect(bob.getByRole("status").filter({ hasText: "Bob est maintenant l'hôte." })).toBeVisible();
});
