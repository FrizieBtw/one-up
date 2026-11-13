import { readFileSync } from "node:fs";
import { type Page, type Route } from "@playwright/test";

// Parcours du profil avec une base Supabase SIMULÉE dans le navigateur : on vérifie l'interface et ses appels
// (écritures, filtrage, états vides), pas la base elle-même. La vraie base est vérifiée par les migrations
// (blocs SQL annulés) et les tests du serveur de jeu. Aucun compte n'est créé.
export function supabaseUrl(): string | null {
  try {
    return /^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m.exec(readFileSync("apps/web/.env.local", "utf8"))?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

export const ME = { id: "11111111-1111-4111-8111-111111111111", username: "Zoé_Test", public_id: "ZOE12345" };
export const BOB = { id: "22222222-2222-4222-8222-222222222222", username: "Bob_Ami", public_id: "BOB12345" };
export const CAROL = { id: "33333333-3333-4333-8333-333333333333", username: "Carol_Demande", public_id: "CAR12345" };
export const DAN = { id: "44444444-4444-4444-8444-444444444444", username: "Dan_Inconnu", public_id: "DAN12345" };

export const SHOP = [
  { id: "outfit_gold", category: "outfit", name: "Tenue de paladin", description: "Une armure qui brille.", price: 250, payload: { outfit: "Paladin" } },
  { id: "outfit_midnight", category: "outfit", name: "Combinaison spatiale", description: "Pour explorer les étoiles.", price: 150, payload: { outfit: "SpaceRanger" } },
  { id: "outfit_mint", category: "outfit", name: "Soldat de plomb", description: "Au garde-à-vous.", price: 150, payload: { outfit: "ToySoldier" } },
  { id: "acc_glasses", category: "accessory", name: "Lunettes rondes", description: "Pour un air studieux.", price: 100, payload: { accessory: "glasses" } },
  { id: "acc_cap", category: "accessory", name: "Casquette", description: "Visière vers l'avant.", price: 100, payload: { accessory: "cap" } },
  { id: "emote_spin", category: "emote", name: "Emote Toupie", description: "Tourner sur soi-même.", price: 120, payload: { emote: "spin" } },
  { id: "emote_bow", category: "emote", name: "Emote Révérence", description: "Saluer avec classe.", price: 120, payload: { emote: "bow" } },
  { id: "cart_gold", category: "cartridge", name: "Cartouches dorées", description: "Un fini métallisé.", price: 200, payload: { body: "#e6b422", metalness: 0.7 } },
  { id: "deco_stars", category: "decoration", name: "Cadre étoilé", description: "Un cadre doré.", price: 150, payload: { decoration: "stars" } },
];
export const MISSIONS = [
  { id: "daily_play", kind: "daily", title: "Une partie par jour", description: "Terminer une session de jeu.", game_id: null, target: 1, reward: 30 },
  { id: "daily_wins", kind: "daily", title: "Trois manches gagnées", description: "Gagner 3 manches dans la journée.", game_id: null, target: 3, reward: 40 },
  { id: "sessions_10", kind: "challenge", title: "Joueur régulier", description: "Terminer 10 sessions de jeu.", game_id: null, target: 10, reward: 150 },
];

/** Compte simulé : session factice, base Supabase et serveur de jeu simulés dans le navigateur. Renvoie l'état de la fausse base. */
export async function mockAccount(page: Page, url: string) {
  const db = {
    // Économie : solde, objets possédés, historique, aide de reprise réclamée, achats effectivement faits.
    balance: 200,
    inventory: [] as { item_id: string; equipped: boolean }[],
    tx: [{ id: "t0", amount: 200, balance_after: 200, kind: "initial", ref: "initial", created_at: new Date().toISOString() }] as Record<string, unknown>[],
    claimed: 0,
    purchases: [] as string[],
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
  const ref = new URL(url).hostname.split(".")[0];
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
    if (table === "rpc/purchase_item") {
      const item = SHOP.find((i) => i.id === body.p_item);
      if (!item) return json(route, "not_found");
      if (db.inventory.some((o) => o.item_id === item.id)) return json(route, "already_owned");
      if (db.balance < item.price) return json(route, "insufficient");
      db.balance -= item.price;
      db.inventory.push({ item_id: item.id, equipped: false });
      db.purchases.push(item.id);
      db.tx.unshift({ id: `t${db.tx.length}`, amount: -item.price, balance_after: db.balance, kind: "purchase", ref: item.id, created_at: new Date().toISOString() });
      return json(route, "ok");
    }
    if (table === "rpc/set_equipped") {
      const owned = db.inventory.find((o) => o.item_id === body.p_item);
      if (!owned) return json(route, false);
      const category = SHOP.find((i) => i.id === owned.item_id)!.category;
      if (body.p_equipped) for (const other of db.inventory) if (SHOP.find((i) => i.id === other.item_id)!.category === category) other.equipped = false;
      owned.equipped = body.p_equipped;
      return json(route, true);
    }
    if (table === "rpc/claim_recovery") {
      if (db.balance >= 20) return json(route, "not_eligible");
      if (db.claimed > 0) return json(route, "cooldown");
      db.claimed++;
      db.balance += 100;
      db.tx.unshift({ id: `t${db.tx.length}`, amount: 100, balance_after: db.balance, kind: "recovery", ref: "r", created_at: new Date().toISOString() });
      return json(route, "ok");
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
      case "wallets":
        return reply([{ balance: db.balance }]);
      case "economy_settings":
        return reply([{ recovery_threshold: 20, recovery_amount: 100, recovery_cooldown_hours: 24 }]);
      case "wallet_transactions":
        return reply(db.tx);
      case "shop_items":
        return reply(SHOP);
      case "user_inventory":
        return reply(db.inventory);
      case "missions":
        return reply(MISSIONS);
      case "mission_progress":
        return reply([{ mission_id: "daily_wins", period: new Date().toISOString().slice(0, 10), progress: 2, completed: false }]);
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

  return db;
}

