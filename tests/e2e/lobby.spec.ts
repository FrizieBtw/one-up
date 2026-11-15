import { guestLogin, openConsole } from "./helpers/guestLogin";
import { noAvatarModels } from "./helpers/noAvatarModels";
import { expect, test, type Browser, type Page } from "@playwright/test";

async function player(browser: Browser, name: string, path = "/"): Promise<Page> {
  const context = await browser.newContext();
  await noAvatarModels(context);
  const page = await context.newPage();
  await page.goto(path);
  await guestLogin(page, name);
  return page;
}

test("cartouche → création, jointure par code, réglages, lien de partage, départ de l'hôte", async ({ browser }) => {
  // Alice ouvre la console, choisit Blackjack et lance : la chambre devient un salon privé.
  const alice = await player(browser, "Alice");
  await openConsole(alice);
  await alice.getByRole("button", { name: /Blackjack/ }).click();
  await expect(alice.getByRole("button", { name: "Lancer la partie" })).toBeVisible();
  await alice.waitForTimeout(1200);
  await alice.screenshot({ path: "test-results/1-console.png" });

  // Fermer : retour à la chambre, puis on rouvre la console.
  await alice.keyboard.press("Escape");
  await expect(alice.getByText("Chambre de Alice")).toBeVisible();
  await openConsole(alice);
  await alice.getByRole("button", { name: /Blackjack/ }).click();
  await alice.getByRole("button", { name: "Lancer la partie" }).click();
  await expect(alice).toHaveURL(/\/lobby\/[A-Z2-9]{4}$/);
  const code = alice.url().split("/").pop()!;
  await expect(alice.getByText("Joueurs 1/4")).toBeVisible();

  // Bob : code inconnu refusé, puis jointure par code (4 cases d'un caractère).
  const bob = await player(browser, "Bob");
  await openConsole(bob);
  await bob.getByRole("tab", { name: "Rejoindre un groupe" }).click();
  const enter = async (text: string) => {
    await bob.getByLabel("Caractère 1 du code").click();
    await bob.keyboard.type(text);
  };
  await enter("ZZZZ");
  await bob.getByRole("button", { name: "Rejoindre", exact: true }).click();
  await expect(bob.getByText("Salon introuvable")).toBeVisible();
  await enter(code.toLowerCase());
  await bob.getByRole("button", { name: "Rejoindre", exact: true }).click();
  await expect(bob).toHaveURL(new RegExp(`/lobby/${code}$`));
  await expect(bob.getByRole("heading", { name: "Blackjack" })).toBeVisible();
  await expect(alice.getByText("Joueurs 2/4")).toBeVisible();

  // Salon privé : absent des chambres ouvertes.
  const carol = await player(browser, "Carol");
  await openConsole(carol);
  await carol.getByRole("tab", { name: "Rejoindre un groupe" }).click();
  await expect(carol.getByText("Aucune chambre ouverte")).toBeVisible();

  // Alice ouvre les règles au dos de la mini cartouche ; Bob est notifié et reste prêt.
  await bob.getByRole("button", { name: "Je suis prêt" }).click();
  await alice.waitForTimeout(1200);
  await alice.screenshot({ path: "test-results/2-lobby.png" });
  await alice.getByRole("button", { name: "Règles de la partie : ouvrir la cartouche" }).click();
  const rules = alice.getByRole("dialog", { name: "Règles de la partie" });
  await rules.getByLabel("Temps de décision").selectOption("30");
  await expect(bob.getByRole("listitem").filter({ hasText: "Règle modifiée : Temps de décision." })).toBeVisible();
  await expect(bob.getByRole("button", { name: "Annuler prêt" })).toBeVisible();
  await alice.waitForTimeout(1200);
  await alice.screenshot({ path: "test-results/3-regles.png" });
  await alice.keyboard.press("Escape");
  await expect(rules).toBeHidden();

  // Bob (non hôte) propose une règle ; Alice vote puis valide. Le vote seul ne change rien.
  await bob.getByRole("button", { name: "Règles de la partie : ouvrir la cartouche" }).click();
  await expect(bob.getByRole("dialog").getByLabel("Temps de décision")).toHaveValue("30");
  await bob.getByRole("dialog").getByLabel("Temps de décision").selectOption("60");
  await bob.keyboard.press("Escape");
  await expect(alice.getByText("Bob propose : Temps de décision → 60")).toBeVisible();
  await expect(bob.getByRole("button", { name: "Valider" })).toHaveCount(0);
  await bob.getByRole("button", { name: /^Pour/ }).click();
  await alice.getByRole("button", { name: /^Contre/ }).click();
  await expect(bob.getByRole("button", { name: "Pour (1)" })).toBeVisible();
  await expect(bob.getByRole("button", { name: "Contre (1)" })).toBeVisible();
  await alice.screenshot({ path: "test-results/4-proposition.png" });
  await alice.getByRole("button", { name: "Valider" }).click();
  await expect(bob.getByRole("listitem").filter({ hasText: "Proposition validée : Temps de décision." })).toBeVisible();
  await expect(alice.getByText("Bob propose : Temps de décision → 60")).toHaveCount(0);
  await alice.getByRole("button", { name: "Règles de la partie : ouvrir la cartouche" }).click();
  await expect(rules.getByLabel("Temps de décision")).toHaveValue("60");
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
  await expect(dan.getByText("Joueurs 3/4")).toBeVisible();

  // Rechargement : Bob retrouve son siège, sans doublon.
  await bob.reload();
  await expect(bob.getByText("Joueurs 3/4")).toBeVisible();
  await expect(bob.getByText("Bob (vous)")).toBeVisible();

  // Retour navigateur d'Alice (hôte) : elle quitte, le rôle passe à Bob.
  await alice.goBack();
  await expect(alice.getByText("Chambre de Alice")).toBeVisible(); // retour à la chambre
  await expect(bob.getByText("Joueurs 2/4")).toBeVisible();
  await expect(bob.getByRole("listitem").filter({ hasText: "Bob est maintenant l'hôte." })).toBeVisible();
});
