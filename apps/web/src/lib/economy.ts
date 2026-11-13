"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { EMOTES, cosmeticsFromEquipped, ownedEmoteIds, type AvatarCosmetics, type InventoryEntry } from "@stepup/shared";
import { supabase } from "./session";

// Jetons, boutique, inventaire, missions. Lecture sous RLS ; achats, équipement et aide de reprise passent par des
// fonctions de la base qui valident tout (solde, possession, délai). Le client n'écrit jamais un solde.

const db = () => {
  if (!supabase) throw new Error("Supabase n'est pas configuré.");
  return supabase;
};

type Result<T> = { data: T | null; error: { message: string } | null };
function rows<T>(result: Result<T[]>): T[] {
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}
function one<T>(result: Result<T>): T | null {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export type ShopCategory = "outfit" | "accessory" | "emote" | "cartridge" | "decoration";

export const CATEGORY_LABELS: Record<ShopCategory, string> = {
  outfit: "Tenues",
  accessory: "Accessoires",
  emote: "Emotes",
  cartridge: "Cartouches",
  decoration: "Cadres de profil",
};

export interface ShopItem {
  id: string;
  category: ShopCategory;
  name: string;
  description: string;
  price: number;
  payload: Record<string, unknown>;
}

export interface Transaction {
  id: string;
  amount: number;
  balance_after: number;
  kind: "initial" | "game_reward" | "mission_reward" | "purchase" | "recovery";
  ref: string;
  created_at: string;
}

export interface Mission {
  id: string;
  kind: "daily" | "challenge";
  title: string;
  description: string;
  game_id: string | null;
  target: number;
  reward: number;
  progress: number;
  completed: boolean;
}

export interface RecoveryRules {
  threshold: number;
  amount: number;
  cooldownHours: number;
}

export type PurchaseOutcome = "ok" | "not_found" | "already_owned" | "insufficient";
export type RecoveryOutcome = "ok" | "not_eligible" | "cooldown";

const DAY_MS = 86_400_000;
/** Période (jour UTC) des missions quotidiennes ; les défis uniques utilisent une date fixe côté base. */
const utcDay = () => new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
const CHALLENGE_PERIOD = "2000-01-01";

export const loadShop = async (): Promise<ShopItem[]> =>
  rows(await db().from("shop_items").select("id, category, name, description, price, payload").order("price")) as ShopItem[];

export async function loadWallet(userId: string): Promise<{ balance: number; transactions: Transaction[]; rules: RecoveryRules }> {
  const client = db();
  const [wallet, transactions, settings] = await Promise.all([
    client.from("wallets").select("balance").eq("user_id", userId).maybeSingle(),
    client.from("wallet_transactions").select("id, amount, balance_after, kind, ref, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(30),
    client.from("economy_settings").select("recovery_threshold, recovery_amount, recovery_cooldown_hours").maybeSingle(),
  ]);
  const s = one(settings);
  return {
    balance: one(wallet)?.balance ?? 0,
    transactions: rows(transactions) as Transaction[],
    rules: { threshold: s?.recovery_threshold ?? 20, amount: s?.recovery_amount ?? 100, cooldownHours: s?.recovery_cooldown_hours ?? 24 },
  };
}

export interface OwnedItem {
  itemId: string;
  equipped: boolean;
}
export const loadInventory = async (userId: string): Promise<OwnedItem[]> =>
  rows(await db().from("user_inventory").select("item_id, equipped").eq("user_id", userId)).map((row) => ({ itemId: row.item_id, equipped: row.equipped }));

export async function loadMissions(userId: string): Promise<Mission[]> {
  const client = db();
  const [missions, progress] = await Promise.all([
    client.from("missions").select("id, kind, title, description, game_id, target, reward").order("reward"),
    client.from("mission_progress").select("mission_id, period, progress, completed").eq("user_id", userId),
  ]);
  const today = utcDay();
  const mine = new Map(rows(progress).map((p) => [`${p.mission_id}|${p.period}`, p]));
  return rows(missions).map((m) => {
    const p = mine.get(`${m.id}|${m.kind === "daily" ? today : CHALLENGE_PERIOD}`);
    return { ...m, progress: p?.progress ?? 0, completed: p?.completed ?? false } as Mission;
  });
}

/** Titres des missions accomplies (écran de résultats). */
export async function loadMissionTitles(ids: string[]): Promise<string[]> {
  if (ids.length === 0 || !supabase) return [];
  const found = rows(await supabase.from("missions").select("id, title").in("id", ids));
  return ids.map((id) => found.find((m) => m.id === id)?.title ?? id);
}

export const purchaseItem = async (itemId: string) => one(await db().rpc("purchase_item", { p_item: itemId })) as PurchaseOutcome;
export const setItemEquipped = async (itemId: string, equipped: boolean) => one(await db().rpc("set_equipped", { p_item: itemId, p_equipped: equipped })) as boolean;
export const claimRecovery = async () => one(await db().rpc("claim_recovery")) as RecoveryOutcome;

// ---------- État partagé : solde, objets possédés et équipés ----------

interface EconomyState {
  userId: string | null;
  balance: number | null;
  shop: ShopItem[];
  inventory: OwnedItem[];
  /** Recharge solde et inventaire du compte courant (silencieux en cas d'échec : l'économie n'est jamais bloquante). */
  refresh(userId?: string): Promise<void>;
  reset(): void;
}

export const useEconomy = create<EconomyState>((set, get) => ({
  userId: null,
  balance: null,
  shop: [],
  inventory: [],
  refresh: async (userId) => {
    const id = userId ?? get().userId;
    if (!id || !supabase) return;
    try {
      const [shop, inventory, wallet] = await Promise.all([get().shop.length ? Promise.resolve(get().shop) : loadShop(), loadInventory(id), loadWallet(id)]);
      set({ userId: id, shop, inventory, balance: wallet.balance });
    } catch {
      // réseau ou base indisponible : on garde l'état précédent
    }
  },
  reset: () => set({ userId: null, balance: null, inventory: [] }),
}));

const entries = (state: Pick<EconomyState, "shop" | "inventory">, only?: (item: OwnedItem) => boolean): InventoryEntry[] =>
  state.inventory
    .filter((owned) => (only ? only(owned) : true))
    .flatMap((owned) => {
      const item = state.shop.find((s) => s.id === owned.itemId);
      return item ? [{ category: item.category, payload: item.payload }] : [];
    });

/** Apparence issue des objets équipés (tenue premium, accessoire, effet). */
export const equippedCosmetics = (state: Pick<EconomyState, "shop" | "inventory">): AvatarCosmetics =>
  cosmeticsFromEquipped(entries(state, (owned) => owned.equipped));

/** Charge utile de l'objet équipé d'une catégorie (fini de cartouche, cadre de profil). */
export function equippedPayload(state: Pick<EconomyState, "shop" | "inventory">, category: ShopCategory): Record<string, unknown> | null {
  const owned = state.inventory.find((o) => o.equipped && state.shop.find((s) => s.id === o.itemId)?.category === category);
  return owned ? (state.shop.find((s) => s.id === owned.itemId)?.payload ?? null) : null;
}

/** Emotes utilisables : les gratuites, plus celles de boutique que le compte possède. */
export function availableEmotes(state: Pick<EconomyState, "shop" | "inventory">) {
  const owned = new Set(ownedEmoteIds(entries(state)));
  return EMOTES.filter((emote) => !("item" in emote) || owned.has(emote.id));
}

// Les sélecteurs de zustand doivent renvoyer une valeur stable : ces hooks lisent les tranches de l'état (références stables)
// et dérivent le résultat avec useMemo, jamais dans le sélecteur lui-même (un nouvel objet à chaque lecture bouclerait à l'infini).
export function useEquippedCosmetics(): AvatarCosmetics {
  const shop = useEconomy((s) => s.shop);
  const inventory = useEconomy((s) => s.inventory);
  return useMemo(() => equippedCosmetics({ shop, inventory }), [shop, inventory]);
}

export function useAvailableEmotes() {
  const shop = useEconomy((s) => s.shop);
  const inventory = useEconomy((s) => s.inventory);
  return useMemo(() => availableEmotes({ shop, inventory }), [shop, inventory]);
}
