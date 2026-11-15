"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CURRENCY_NAME } from "@stepup/shared";
import {
  CATEGORY_LABELS,
  loadMissions,
  loadWallet,
  purchaseItem,
  setItemEquipped,
  useEconomy,
  type Mission,
  type PurchaseOutcome,
  type ShopCategory,
  type ShopItem,
  type Transaction,
} from "@/lib/economy";
import { HudButton, HudChip, HudProgress, HudRow } from "../hud";
import { EscapeHint } from "../inputPrompts";
import { useNav } from "@/lib/nav";
import { TokensIcon } from "../icons";

const PURCHASE_MESSAGE: Record<PurchaseOutcome, string> = {
  ok: "Achat effectué !",
  not_found: "Cet objet n'est plus en vente.",
  already_owned: "Vous possédez déjà cet objet.",
  insufficient: `Pas assez de ${CURRENCY_NAME}.`,
};

const KIND_LABEL: Record<Transaction["kind"], string> = {
  initial: "Solde de départ",
  game_reward: "Fin de session",
  mission_reward: "Mission",
  purchase: "Achat",
  recovery: "Aide de reprise",
};

const CATEGORIES = Object.keys(CATEGORY_LABELS) as ShopCategory[];

const Title = ({ children }: { children: React.ReactNode }) => (
  <h3 className="mb-2 font-hud! text-lg font-semibold text-black">
    {children}
  </h3>
);
const Sub = ({ children }: { children: React.ReactNode }) => (
  <h4 className="mt-4 mb-1.5 font-hud! text-[13px] font-semibold text-hud-muted">
    {children}
  </h4>
);
const Status = ({ children }: { children: React.ReactNode }) => (
  <p role="status" className="min-h-5 text-sm text-hud-muted">
    {children}
  </p>
);

function Balance({ balance }: { balance: number | null }) {
  return (
    <p
      className="flex items-center gap-1.5 font-hud text-lg font-semibold text-black"
      aria-live="polite"
    >
      <span className="text-[#e0a100]">
        <TokensIcon />
      </span>
      {balance ?? "…"}{" "}
      <span className="text-sm font-medium text-hud-muted">
        {CURRENCY_NAME}
      </span>
    </p>
  );
}

// ---------- Boutique : grille de cartes à gauche, détail à droite ----------

const SWATCHES = [
  "#ff9eb5",
  "#ffe08a",
  "#8fe3c0",
  "#b9a3f5",
  "#7ec8f5",
  "#ffd6e1",
];
const swatchOf = (id: string) =>
  SWATCHES[
    [...id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % SWATCHES.length
  ]!;

/** Temps restant avant minuit UTC, au format HH:MM:SS. */
function untilMidnight(now: number): string {
  const left = Math.max(
    0,
    Math.floor((86_400_000 - (now % 86_400_000)) / 1000),
  );
  return [Math.floor(left / 3600), Math.floor((left % 3600) / 60), left % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

export function ShopTab() {
  const { shop, inventory, balance, refresh } = useEconomy();
  const [selected, setSelected] = useState<ShopItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const owned = useMemo(
    () => new Map(inventory.map((o) => [o.itemId, o])),
    [inventory],
  );
  const entry = selected ? owned.get(selected.id) : undefined;
  const wearable = selected ? selected.category !== "emote" : false;

  const buy = async (item: ShopItem) => {
    if ((balance ?? 0) < item.price)
      return setMessage(`Il te manque ${item.price - (balance ?? 0)} jetons.`);
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await purchaseItem(item.id);
      setMessage(
        outcome === "ok"
          ? `${item.name} : ${PURCHASE_MESSAGE.ok}`
          : PURCHASE_MESSAGE[outcome],
      );
    } catch (e) {
      setMessage((e as Error).message);
    }
    await refresh();
    setBusy(false);
  };
  const toggleEquipped = async (item: ShopItem, equipped: boolean) => {
    setBusy(true);
    try {
      await setItemEquipped(item.id, !equipped);
      setMessage(equipped ? `${item.name} retiré.` : `${item.name} équipé.`);
    } catch (e) {
      setMessage((e as Error).message);
    }
    await refresh();
    setBusy(false);
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="min-h-0 flex-1 overflow-y-auto py-3.5 pr-3.5 pl-[18px]">
        <div className="flex items-center justify-between">
          <h3 className="font-hud! text-lg font-semibold text-black">
            Boutique
          </h3>
          <span className="flex items-center gap-3">
            <span className="rounded-full bg-hud-soft px-3 py-[5px] text-[12.5px] font-semibold text-hud-accent">
              Nouvelle sélection dans {untilMidnight(now)}
            </span>
            <EscapeHint />
          </span>
        </div>
        {CATEGORIES.map((category) => {
          const items = shop.filter((item) => item.category === category);
          if (items.length === 0) return null;
          return (
            <section key={category} aria-label={CATEGORY_LABELS[category]}>
              <h4 className="mt-4 mb-2 font-hud! text-sm font-semibold text-black">
                {CATEGORY_LABELS[category]}
              </h4>
              <ul className="grid grid-cols-3 gap-2">
                {items.map((item) => {
                  const mine = owned.get(item.id);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        aria-pressed={selected?.id === item.id}
                        aria-label={item.name}
                        onClick={() => {
                          setSelected(item);
                          setMessage(null);
                        }}
                        className={`relative w-full rounded-[14px] border-2 p-2 text-left font-hud text-[13px] font-semibold text-black ${selected?.id === item.id ? "border-hud-accent bg-hud-soft" : "border-transparent bg-hud-field"}`}
                      >
                        {mine && (
                          <span className="absolute top-1.5 right-1.5 rounded-[7px] bg-[#e3f6ec] px-1.5 text-[10.5px] text-hud-ok">
                            {mine.equipped ? "Équipé" : "Possédé"}
                          </span>
                        )}
                        <span
                          className="mb-1.5 block h-[52px] rounded-[10px] border-2 border-outline"
                          style={{ background: swatchOf(item.id) }}
                        />
                        {item.name}
                        <span className="mt-0.5 flex items-center gap-1 text-xs font-medium text-hud-muted">
                          <span className="text-[#e0a100]">
                            <TokensIcon className="size-3.5" />
                          </span>
                          {item.price}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        <div className="h-3" />
      </div>

      <aside
        aria-label="Détail"
        className="w-[190px] shrink-0 overflow-y-auto border-l border-hud-divider p-3.5"
      >
        {selected ? (
          <>
            <div
              className="mb-2.5 h-[84px] rounded-xl border-2 border-outline"
              style={{ background: swatchOf(selected.id) }}
            />
            <p className="font-hud text-base font-semibold text-black">
              {selected.name}
            </p>
            <p className="mt-1 mb-2.5 text-[12.5px] text-hud-muted">
              {selected.description}
            </p>
            {!entry ? (
              <HudButton
                className="w-full"
                disabled={busy}
                onClick={() => void buy(selected)}
              >
                Acheter · {selected.price}
              </HudButton>
            ) : wearable ? (
              <HudButton
                variant={entry.equipped ? "soft" : "primary"}
                className="w-full"
                disabled={busy}
                onClick={() => void toggleEquipped(selected, entry.equipped)}
              >
                {entry.equipped ? "Retirer" : "Équiper"}
              </HudButton>
            ) : (
              <HudChip className="block w-full py-2 text-center">
                Débloquée
              </HudChip>
            )}
            {wearable && (
              <HudButton
                variant="soft"
                className="mt-1.5 w-full"
                onClick={() => useNav.getState().tryAtMirror(selected.id)}
              >
                Essayer au miroir
              </HudButton>
            )}
          </>
        ) : (
          <p className="text-[13px] text-hud-muted">
            Choisis un objet pour voir le détail.
          </p>
        )}
        <p role="status" className="mt-2 min-h-5 text-[12.5px] text-hud-muted">
          {message}
        </p>
      </aside>
    </div>
  );
}

// ---------- Historique des jetons ----------

export function HistoryTab({ userId }: { userId: string }) {
  const { shop, refresh } = useEconomy();
  const [wallet, setWallet] = useState<{ transactions: Transaction[] } | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    await refresh(userId);
    try {
      const { transactions } = await loadWallet(userId);
      setWallet({ transactions });
    } catch (e) {
      setMessage((e as Error).message);
    }
  }, [refresh, userId]);
  useEffect(() => void reload(), [reload]);

  const nameOf = (id: string) => shop.find((s) => s.id === id)?.name ?? id;

  return (
    <div>
      <Title>Historique</Title>
      <Status>{message}</Status>
      {!wallet ? (
        <p aria-busy="true" className="text-sm text-hud-muted">
          Chargement…
        </p>
      ) : wallet.transactions.length === 0 ? (
        <p className="text-sm text-hud-muted">Aucune transaction.</p>
      ) : (
        <ul>
          {wallet.transactions.map((t) => (
            <HudRow key={t.id} className="mb-2">
              <div className="flex-1">
                <div className="font-semibold">
                  {KIND_LABEL[t.kind]}
                  {t.kind === "purchase" && ` : ${nameOf(t.ref)}`}
                </div>
                <small className="block text-xs font-normal text-hud-muted">
                  {new Date(t.created_at).toLocaleString("fr-FR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </small>
              </div>
              <div
                className={`flex items-center gap-1 font-semibold ${t.amount < 0 ? "text-hud-bad" : "text-hud-ok"}`}
              >
                <span className="text-[#e0a100]">
                  <TokensIcon className="size-3.5" />
                </span>
                {t.amount > 0 ? `+${t.amount}` : t.amount}
              </div>
            </HudRow>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- Missions ----------

function MissionRow({ m }: { m: Mission }) {
  const value = Math.min(m.progress, m.target);
  return (
    <HudRow className="mb-2">
      <div className="flex-1">
        <div>{m.title}</div>
        <HudProgress
          label={`Progression : ${m.title}`}
          value={value}
          max={m.target}
          className={`mt-1.5 ${m.completed ? "[&>div]:bg-hud-ok" : ""}`}
        />
        <small className="mt-1 block text-xs font-normal text-hud-muted">
          {value} / {m.target}
        </small>
      </div>
      <span className="flex items-center gap-1 font-semibold text-[#e0a100]">
        <TokensIcon className="size-[15px]" />
        <span className="text-black">+{m.reward}</span>
      </span>
      {/* La récompense est versée toute seule à la fin d'une session : une mission terminée est donc déjà « Réclamée ». */}
      {m.completed ? (
        <span className="rounded-[10px] bg-[#e3f6ec] px-3.5 py-1.5 text-[12.5px] font-semibold text-hud-ok">
          Réclamé
        </span>
      ) : (
        <span className="rounded-[10px] bg-hud-soft px-3.5 py-1.5 text-[12.5px] font-semibold text-hud-accent">
          En cours
        </span>
      )}
    </HudRow>
  );
}

export function MissionsTab({ userId }: { userId: string }) {
  const [missions, setMissions] = useState<Mission[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    loadMissions(userId).then(setMissions, (e: Error) => setError(e.message));
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [userId]);

  if (error)
    return (
      <p role="alert" className="text-hud-bad">
        {error}
      </p>
    );
  if (!missions) return <p aria-busy="true">Chargement des missions…</p>;
  const daily = missions.filter((m) => m.kind === "daily");
  const challenges = missions.filter((m) => m.kind === "challenge");
  return (
    <div>
      <section aria-label="Missions du jour">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-hud! text-lg font-semibold text-black">
            Missions du jour
          </h3>
          <span className="rounded-full bg-hud-soft px-3 py-[5px] text-[12.5px] font-semibold text-hud-accent">
            Nouvelles missions dans {untilMidnight(now)}
          </span>
        </div>
        <ul>
          {daily.map((m) => (
            <MissionRow key={m.id} m={m} />
          ))}
        </ul>
      </section>
      <section aria-label="Défis">
        <h3 className="mt-4 mb-2 font-hud! text-lg font-semibold text-black">
          Défis
        </h3>
        <ul>
          {challenges.map((m) => (
            <MissionRow key={m.id} m={m} />
          ))}
        </ul>
      </section>
    </div>
  );
}
