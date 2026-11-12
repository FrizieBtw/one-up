"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { normalizeRoomCode, type GameDefinition, type GameId, type PublicRoomInfo } from "@stepup/shared";
import { connectLobby, createLobby, describeJoinError, fetchPublicRooms } from "@/lib/lobby";
import { useNav } from "@/lib/nav";
import { Button, Input } from "./ui";

/** Les trois actions du dos de cartouche : chercher une partie, rejoindre par code, créer une partie. */
export function HomePanels({ game }: { game: GameDefinition }) {
  const panel = useNav((s) => s.panel);
  const setPanel = useNav((s) => s.setPanel);
  const enterLobby = useNav((s) => s.enterLobby);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setError(null), [panel]);

  // La transition vers le lobby ne démarre qu'une fois la connexion réellement établie.
  const run = async (connect: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      const code = await connect();
      enterLobby(code, null);
    } catch (e) {
      setError(describeJoinError(e));
      setBusy(false);
    }
  };
  const join = (code: string) => run(async () => (await connectLobby(code)).roomId);
  const create = (isPublic: boolean) => run(() => createLobby({ gameId: game.id as GameId, isPublic }));

  const submitCode = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const code = normalizeRoomCode(String(new FormData(e.currentTarget).get("code")));
    if (!code) return setError("Code invalide : 6 caractères attendus.");
    void join(code);
  };

  return (
    <div className="flex grow flex-col gap-3" aria-busy={busy}>
      {panel === "menu" && (
        <div className="flex grow flex-col justify-center gap-4">
          <p className="text-sm font-bold text-ink/70">{game.tagline}</p>
          <Button variant="calm" onClick={() => setPanel("search")}>
            Chercher une partie
          </Button>
          <Button variant="plain" onClick={() => setPanel("code")}>
            Rejoindre par code
          </Button>
          <Button variant="accent" onClick={() => setPanel("create")}>
            Créer une partie
          </Button>
        </div>
      )}

      {panel === "search" && <PublicRooms game={game} busy={busy} onJoin={join} />}

      {panel === "code" && (
        <form onSubmit={submitCode} className="flex grow flex-col justify-center gap-3">
          <label className="font-bold" htmlFor="join-code">
            Code du salon
          </label>
          <Input id="join-code" name="code" required maxLength={6} autoFocus placeholder="ABC234" autoComplete="off" className="text-center font-display text-2xl uppercase tracking-[0.3em]" />
          <Button type="submit" disabled={busy}>
            Rejoindre
          </Button>
        </form>
      )}

      {panel === "create" && (
        <div className="flex grow flex-col justify-center gap-4">
          <p className="text-sm font-bold text-ink/70">Les règles se choisissent ensuite, dans le salon.</p>
          <Button variant="accent" disabled={busy} onClick={() => void create(true)}>
            Salon public
          </Button>
          <p className="-mt-2 text-xs font-bold text-ink/70">Visible dans « Chercher une partie ».</p>
          <Button variant="plain" disabled={busy} onClick={() => void create(false)}>
            Salon privé
          </Button>
          <p className="-mt-2 text-xs font-bold text-ink/70">Accessible seulement par code ou lien.</p>
        </div>
      )}

      <p role="alert" className="min-h-5 text-sm font-bold text-coral">
        {error}
      </p>
    </div>
  );
}

function PublicRooms({ game, busy, onJoin }: { game: GameDefinition; busy: boolean; onJoin: (code: string) => void }) {
  const [rooms, setRooms] = useState<PublicRoomInfo[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [openOnly, setOpenOnly] = useState(false);

  const refresh = useCallback(() => {
    fetchPublicRooms(game.id).then(
      (list) => (setRooms(list), setFailed(false)),
      () => setFailed(true),
    );
  }, [game.id]);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const shown = rooms?.filter((room) => !openOnly || room.players < room.capacity);

  return (
    <div className="flex grow flex-col gap-2">
      <div className="flex items-center justify-between text-sm font-bold">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4 accent-violet" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
          Places libres seulement
        </label>
        <button type="button" className="underline" onClick={refresh}>
          Actualiser
        </button>
      </div>
      {failed ? (
        <p className="font-bold text-coral">Serveur de jeu injoignable.</p>
      ) : !shown ? (
        <p>Chargement…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-ink/70">Aucun salon public pour l'instant. Créez le vôtre !</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((room) => {
            const full = room.players >= room.capacity;
            return (
              <li key={room.code} className="flex items-center justify-between gap-2 rounded-xl border-2 border-ink bg-white px-3 py-2 text-sm font-bold">
                <span>
                  Salon de {room.hostName}
                  <span className="block text-xs text-ink/70">
                    {room.players}/{room.capacity} joueurs · {room.phase === "waiting" ? "En attente" : "En cours"}
                  </span>
                </span>
                <Button className="!px-3 !py-0.5 !text-sm" variant="calm" disabled={busy || full || room.phase !== "waiting"} onClick={() => onJoin(room.code)}>
                  {full ? "Complet" : "Rejoindre"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
