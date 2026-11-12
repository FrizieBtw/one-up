import { readFileSync } from "node:fs";
import { expect, test, type Route } from "@playwright/test";

// Parcours du profil avec une base Supabase SIMULÉE dans le navigateur : on vérifie l'interface et ses appels
// (écritures, filtrage, états vides), pas la base elle-même. La vraie base est vérifiée par les migrations
// (blocs SQL annulés) et les tests du serveur de jeu. Aucun compte n'est créé.
function supabaseUrl(): string | null {
  try {
    return /^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m.exec(readFileSync("apps/web/.env.local", "utf8"))?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

const ME = { id: "11111111-1111-4111-8111-111111111111", username: "Zoé_Test", public_id: "ZOE12345" };
const BOB = { id: "22222222-2222-4222-8222-222222222222", username: "Bob_Ami", public_id: "BOB12345" };
const CAROL = { id: "33333333-3333-4333-8333-333333333333", username: "Carol_Demande", public_id: "CAR12345" };
const DAN = { id: "44444444-4444-4444-8444-444444444444", username: "Dan_Inconnu", public_id: "DAN12345" };

test("profil, avatar, amis, classements et confidentialité (base simulée)", async ({ page }) => {
  const url = supabaseUrl();
  test.skip(!url, "apps/web/.env.local absent : pas d'URL Supabase à simuler");

  const db = {
    avatar: null as Record<string, unknown> | null,
    privacy: null as Record<string, unknown> | null,
    friendships: [{ user_a: ME.id, user_b: BOB.id }],
    requests: [{ id: "r1", from_user: CAROL.id, to_user: ME.id }] as { id: string; from_user: string; to_user: string }[],
    sent: [] as string[],
  };
  const profiles = [ME, BOB, CAROL, DAN];
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });

  // Session de compte factice : supabase-js la lit dans le stockage local.
  const ref = new URL(url!).hostname.split(".")[0];
  await page.addInitScript(
    ([key, user]) =>
      localStorage.setItem(
        key as string,
        JSON.stringify({ access_token: "faux.jeton.test", refresh_token: "x", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user }),
      ),
    [`sb-${ref}-auth-token`, { id: ME.id, aud: "authenticated", role: "authenticated", email: "zoe@test.invalid" }],
  );

  await page.route(`${url}/auth/v1/**`, (route) => (route.request().method() === "OPTIONS" ? route.fulfill({ status: 204, headers: cors }) : json(route, { id: ME.id })));
  await page.route(`${url}/rest/v1/**`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const { pathname, searchParams } = new URL(request.url());
    const table = pathname.replace("/rest/v1/", "");
    const wantsObject = (request.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    const body = request.postDataJSON?.() ?? null;
    const reply = (rows: unknown[], status = 200) => json(route, wantsObject ? (rows[0] ?? null) : rows, status);

    if (table === "rpc/search_profiles") {
      const q = String(body.p_query).toLowerCase();
      return json(route, profiles.filter((p) => p.id !== ME.id && p.username.toLowerCase().startsWith(q)));
    }
    if (table === "rpc/send_friend_request") {
      db.sent.push(body.p_target);
      db.requests.push({ id: `out-${db.sent.length}`, from_user: ME.id, to_user: body.p_target });
      return json(route, "sent");
    }
    if (table === "rpc/respond_friend_request") {
      const req = db.requests.find((r) => r.id === body.p_request);
      db.requests = db.requests.filter((r) => r !== req);
      if (req && body.p_accept) db.friendships.push({ user_a: ME.id, user_b: req.from_user });
      return json(route, true);
    }
    if (table === "rpc/remove_friend") {
      db.friendships = db.friendships.filter((f) => f.user_b !== body.p_other);
      return json(route, null, 204);
    }

    switch (table) {
      case "profiles": {
        const id = /^eq\.(.+)$/.exec(searchParams.get("id") ?? "")?.[1];
        return reply(id ? profiles.filter((p) => p.id === id) : profiles);
      }
      case "progression": {
        const rows = [{ user_id: ME.id, xp: 150 }, { user_id: BOB.id, xp: 420 }, { user_id: CAROL.id, xp: 90 }];
        const filter = searchParams.get("user_id") ?? "";
        const eq = /^eq\.(.+)$/.exec(filter)?.[1];
        const sorted = [...rows].sort((a, b) => b.xp - a.xp);
        return reply(eq ? sorted.filter((r) => r.user_id === eq) : filter.startsWith("in.") ? sorted.filter((r) => filter.includes(r.user_id)) : sorted);
      }
      case "avatar_configurations":
        if (request.method() === "PATCH") return json(route, db.avatar ? ((db.avatar = body), [{ user_id: ME.id }]) : []);
        // La vraie base n'accorde l'insertion que sur user_id et config : toute autre colonne est refusée (403, 42501).
        if (request.method() === "POST") {
          const extra = Object.keys(body).filter((key) => !["user_id", "config"].includes(key));
          if (extra.length > 0) return json(route, { code: "42501", message: "permission denied for table avatar_configurations" }, 403);
          return ((db.avatar = body.config), json(route, [], 201));
        }
        return reply(db.avatar ? [{ config: db.avatar }] : []);
      case "user_privacy_settings":
        if (request.method() === "PATCH") return json(route, db.privacy ? ((db.privacy = { ...db.privacy, ...body }), [{ user_id: ME.id }]) : []);
        if (request.method() === "POST") return ((db.privacy = body), json(route, [], 201));
        return reply(db.privacy ? [db.privacy] : []);
      case "player_stats":
        return reply([{ game_id: "blackjack", sessions_played: 3, sessions_won: 1, rounds_won: 7, rounds_pushed: 1, rounds_lost: 4, total_score: 22 }]);
      case "achievements":
        return reply([
          { id: "first_round_win", title: "Premier coup gagnant", description: "Gagner une manche." },
          { id: "first_session", title: "Première table", description: "Terminer une première session de jeu." },
          { id: "sessions_5", title: "Habitué", description: "Terminer 5 sessions de jeu." },
        ]);
      case "user_achievements":
        return reply([{ achievement_id: "first_session" }, { achievement_id: "first_round_win" }]);
      case "friendships":
        return reply(db.friendships);
      case "friend_requests":
        if (request.method() === "DELETE") {
          const id = /^eq\.(.+)$/.exec(searchParams.get("id") ?? "")?.[1];
          db.requests = db.requests.filter((r) => r.id !== id);
          return json(route, null, 204);
        }
        return reply(db.requests);
    }
    return json(route, { message: `table inattendue : ${table}` }, 404);
  });

  // Présence des amis : réponse simulée du serveur de jeu (le vrai refuserait ce faux jeton).
  await page.route(/localhost:2567\/presence/, (route) =>
    route.request().method() === "OPTIONS" ? route.fulfill({ status: 204, headers: cors }) : json(route, [{ userId: BOB.id, status: "playing", gameId: "blackjack" }]),
  );

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
  await page.getByRole("button", { name: "Couettes" }).click();
  await page.getByRole("button", { name: "Couleur des cheveux 4" }).click();
  await page.getByRole("button", { name: "Tenue 3" }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "test-results/13-avatar.png" });
  await save.click();
  await expect(page.getByText("Avatar enregistré")).toBeVisible();
  expect(db.avatar).toMatchObject({ hairStyle: 2, hair: "#ff5c6c", outfit: "#ff8a1f" });
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
