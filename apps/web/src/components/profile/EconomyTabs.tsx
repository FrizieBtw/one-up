"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CURRENCY_NAME, cosmeticsFromEquipped, type AvatarConfig, type EmoteId } from "@stepup/shared";
import {
  CATEGORY_LABELS,
  claimRecovery,
  loadMissions,
  loadWallet,
  purchaseItem,
  setItemEquipped,
  useEconomy,
  useEquippedCosmetics,
  type Mission,
  type PurchaseOutcome,
  type RecoveryOutcome,
  type RecoveryRules,
  type ShopCategory,
  type ShopItem,
  type Transaction,
} from "@/lib/economy";
import { Badge, Button, Card } from "../ui";

const AvatarPreview = dynamic(() => import("./AvatarEditor").then((m) => m.AvatarPreview), { ssr: false });

const PURCHASE_MESSAGE: Record<PurchaseOutcome, string> = {
  ok: "Achat effectué !",
  not_found: "Cet objet n'est plus en vente.",
  already_owned: "Vous possédez déjà cet objet.",
  insufficient: `Pas assez de ${CURRENCY_NAME}.`,
};

const RECOVERY_MESSAGE: Record<RecoveryOutcome, string> = {
  ok: "Aide de reprise versée.",
  not_eligible: "Votre solde est encore suffisant.",
  cooldown: "Une aide a déjà été versée récemment.",
};

const KIND_LABEL: Record<Transaction["kind"], string> = {
  initial: "Solde de départ",
  game_reward: "Fin de session",
  mission_reward: "Mission",
  purchase: "Achat",
  recovery: "Aide de reprise",
};

const CATEGORIES = Object.keys(CATEGORY_LABELS) as ShopCategory[];

function Balance({ balance }: { balance: number | null }) {
  return (
    <p className="font-display text-2xl" aria-live="polite">
      {balance ?? "…"} <span className="text-base font-bold text-ink/70">{CURRENCY_NAME}</span>
    </p>
  );
}

// ---------- Boutique ----------

export function ShopTab({ look, name }: { look: AvatarConfig; name: string }) {
  const { shop, inventory, balance, refresh } = useEconomy();
  const [category, setCategory] = useState<ShopCategory>("outfit");
  const [tryOn, setTryOn] = useState<ShopItem | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const owned = useMemo(() => new Set(inventory.map((o) => o.itemId)), [inventory]);
  const equipped = useEquippedCosmetics();

  // La confirmation expire : un clic isolé, plus tard, n'achète rien.
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(null), 5000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const buy = async (item: ShopItem) => {
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await purchaseItem(item.id);
      setMessage(outcome === "ok" ? `${item.name} : ${PURCHASE_MESSAGE.ok}` : PURCHASE_MESSAGE[outcome]);
    } catch (e) {
      setMessage((e as Error).message);
    }
    setConfirming(null);
    await refresh();
    setBusy(false);
  };

  // Essayage : l'objet visé remplace, le temps de l'aperçu, celui de sa catégorie.
  const previewCosmetics = tryOn ? { ...equipped, ...cosmeticsFromEquipped([{ category: tryOn.category, payload: tryOn.payload }]) } : equipped;
  const previewEmote = tryOn?.category === "emote" ? (tryOn.payload.emote as EmoteId) : null;

  return (
    <div className="grid gap-5 md:grid-cols-[18rem_1fr]">
      <Card className="flex flex-col items-center gap-2">
        <AvatarPreview config={look} name={name} cosmetics={previewCosmetics} emote={previewEmote} className="h-72 w-full" />
        <p className="text-center text-sm font-bold text-ink/70">
          {tryOn ? `Aperçu : ${tryOn.name}` : "Choisissez « Essayer » sur un objet."}
        </p>
        <Balance balance={balance} />
      </Card>

      <Card className="flex flex-col gap-3">
        <h3 className="text-2xl">Boutique</h3>
        <p className="text-sm font-bold text-ink/70">Tous les objets sont cosmétiques : aucun ne donne d'avantage en jeu.</p>
        <div role="group" aria-label="Catégories" className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <Button key={c} className="!px-3 !py-0.5 !text-sm" variant={category === c ? "primary" : "plain"} aria-pressed={category === c} onClick={() => setCategory(c)}>
              {CATEGORY_LABELS[c]}
            </Button>
          ))}
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {shop
            .filter((item) => item.category === category)
            .map((item) => {
              const have = owned.has(item.id);
              const canAfford = (balance ?? 0) >= item.price;
              return (
                <li key={item.id} className="flex flex-col gap-1.5 rounded-xl border-2 border-ink bg-cream p-3 text-sm font-bold">
                  <p className="flex items-center gap-2">
                    <span className="grow">{item.name}</span>
                    {have && <Badge className="bg-turquoise">Possédé</Badge>}
                  </p>
                  <p className="text-xs font-semibold text-ink/70">{item.description}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="font-display text-lg">
                      {item.price} {CURRENCY_NAME}
                    </span>
                    <Button className="!px-3 !py-0.5 !text-sm" variant="plain" aria-pressed={tryOn?.id === item.id} onClick={() => setTryOn(tryOn?.id === item.id ? null : item)}>
                      Essayer
                    </Button>
                    {!have &&
                      (confirming === item.id ? (
                        <Button className="!px-3 !py-0.5 !text-sm" variant="accent" disabled={busy || !canAfford} onClick={() => void buy(item)}>
                          Confirmer l'achat
                        </Button>
                      ) : (
                        <Button className="!px-3 !py-0.5 !text-sm" variant="calm" disabled={busy || !canAfford} onClick={() => setConfirming(item.id)}>
                          {canAfford ? `Acheter ${item.name}` : `Trop cher : ${item.name}`}
                        </Button>
                      ))}
                  </div>
                </li>
              );
            })}
        </ul>
        <p role="status" className="min-h-5 text-sm font-bold">
          {message}
        </p>
      </Card>
    </div>
  );
}

// ---------- Inventaire et portefeuille ----------

export function InventoryTab({ userId }: { userId: string }) {
  const { shop, inventory, balance, refresh } = useEconomy();
  const [wallet, setWallet] = useState<{ transactions: Transaction[]; rules: RecoveryRules } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    await refresh(userId);
    try {
      const { transactions, rules } = await loadWallet(userId);
      setWallet({ transactions, rules });
    } catch (e) {
      setMessage((e as Error).message);
    }
  }, [refresh, userId]);
  useEffect(() => void reload(), [reload]);

  const run = async (action: () => Promise<string | null>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await action());
    } catch (e) {
      setMessage((e as Error).message);
    }
    await reload();
    setBusy(false);
  };

  const owned = inventory.flatMap((o) => {
    const item = shop.find((s) => s.id === o.itemId);
    return item ? [{ ...o, item }] : [];
  });
  const nameOf = (id: string) => shop.find((s) => s.id === id)?.name ?? id;
  const lowBalance = wallet !== null && balance !== null && balance < wallet.rules.threshold;

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Card className="flex flex-col gap-3">
        <h3 className="text-2xl">Portefeuille</h3>
        <Balance balance={balance} />
        {wallet &&
          (lowBalance ? (
            <div className="rounded-xl border-2 border-ink bg-sun p-3 text-sm font-bold">
              <p>
                Votre solde est bas : une aide de {wallet.rules.amount} {CURRENCY_NAME} est disponible (une fois par {wallet.rules.cooldownHours} h).
              </p>
              <Button className="mt-2 !px-3 !py-1 !text-sm" variant="accent" disabled={busy} onClick={() => void run(async () => RECOVERY_MESSAGE[await claimRecovery()])}>
                Réclamer l'aide de reprise
              </Button>
            </div>
          ) : (
            <p className="text-xs font-semibold text-ink/70">
              Une aide de reprise est proposée si votre solde passe sous {wallet.rules.threshold} {CURRENCY_NAME}.
            </p>
          ))}
        <p role="status" className="min-h-5 text-sm font-bold">
          {message}
        </p>
      </Card>

      <Card className="flex flex-col gap-3">
        <h3 className="text-2xl">Mes objets ({owned.length})</h3>
        {owned.length === 0 && <p className="text-sm font-bold text-ink/70">Rien pour l'instant : la boutique vous attend.</p>}
        <ul className="flex flex-col gap-2">
          {owned.map(({ item, equipped }) => (
            <li key={item.id} className="flex items-center gap-2 rounded-xl border-2 border-ink bg-cream px-3 py-1.5 text-sm font-bold">
              <span className="grow">
                {item.name} <span className="text-xs text-ink/60">{CATEGORY_LABELS[item.category]}</span>
              </span>
              {item.category === "emote" ? (
                <Badge className="bg-turquoise">Débloquée</Badge>
              ) : (
                <Button
                  className="!px-3 !py-0.5 !text-sm"
                  variant={equipped ? "plain" : "calm"}
                  disabled={busy}
                  onClick={() => void run(async () => ((await setItemEquipped(item.id, !equipped)), null))}
                >
                  {equipped ? `Retirer ${item.name}` : `Équiper ${item.name}`}
                </Button>
              )}
            </li>
          ))}
        </ul>
        <p className="text-xs font-semibold text-ink/70">Les emotes débloquées s'utilisent dans les salons (touches 5 et 6).</p>
      </Card>

      <Card className="md:col-span-2">
        <h3 className="text-2xl">Historique</h3>
        {!wallet || wallet.transactions.length === 0 ? (
          <p className="mt-2 text-sm font-bold text-ink/70">Aucune transaction.</p>
        ) : (
          <table className="mt-2 w-full text-left text-sm font-bold">
            <thead className="text-xs uppercase text-ink/60">
              <tr>
                <th>Date</th>
                <th>Opération</th>
                <th className="text-right">Montant</th>
                <th className="text-right">Solde</th>
              </tr>
            </thead>
            <tbody>
              {wallet.transactions.map((t) => (
                <tr key={t.id}>
                  <td className="py-1">{new Date(t.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</td>
                  <td>
                    {KIND_LABEL[t.kind]}
                    {t.kind === "purchase" && ` : ${nameOf(t.ref)}`}
                  </td>
                  <td className={`text-right ${t.amount < 0 ? "text-coral" : "text-violet-deep"}`}>{t.amount > 0 ? `+${t.amount}` : t.amount}</td>
                  <td className="text-right">{t.balance_after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// ---------- Missions ----------

function MissionList({ title, missions }: { title: string; missions: Mission[] }) {
  return (
    <Card className="flex flex-col gap-3">
      <h3 className="text-2xl">{title}</h3>
      <ul className="flex flex-col gap-2">
        {missions.map((m) => (
          <li key={m.id} className={`rounded-xl border-2 border-ink p-3 text-sm font-bold ${m.completed ? "bg-sun" : "bg-cream"}`}>
            <p className="flex items-center gap-2">
              <span className="grow">{m.title}</span>
              <Badge className={m.completed ? "bg-turquoise" : "bg-white"}>{m.completed ? "Terminée" : `${m.reward} ${CURRENCY_NAME}`}</Badge>
            </p>
            <p className="text-xs font-semibold text-ink/70">{m.description}</p>
            <div
              role="progressbar"
              aria-label={`Progression : ${m.title}`}
              aria-valuemin={0}
              aria-valuemax={m.target}
              aria-valuenow={Math.min(m.progress, m.target)}
              className="mt-1.5 h-3 overflow-hidden rounded-full border-2 border-ink bg-white"
            >
              <div className="h-full bg-turquoise" style={{ width: `${(Math.min(m.progress, m.target) / m.target) * 100}%` }} />
            </div>
            <p className="mt-0.5 text-xs">
              {Math.min(m.progress, m.target)} / {m.target}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function MissionsTab({ userId }: { userId: string }) {
  const [missions, setMissions] = useState<Mission[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadMissions(userId).then(setMissions, (e: Error) => setError(e.message));
  }, [userId]);

  if (error) return <p role="alert" className="font-bold text-coral">{error}</p>;
  if (!missions) return <p aria-busy="true">Chargement des missions…</p>;
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <MissionList title="Missions du jour" missions={missions.filter((m) => m.kind === "daily")} />
      <MissionList title="Défis" missions={missions.filter((m) => m.kind === "challenge")} />
      <p className="text-xs font-bold text-ink/70 md:col-span-2">
        Les missions du jour repartent de zéro chaque jour (minuit UTC). Récompenses versées automatiquement à la fin d'une session, une seule fois par mission.
      </p>
    </div>
  );
}
