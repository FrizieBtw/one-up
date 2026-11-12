"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { APP_NAME, GAMES, normalizeRoomCode, type GameDefinition, type PublicRoomInfo } from "@stepup/shared";
import { AuthPanel } from "@/components/AuthPanel";
import { Badge, Button, Card, Input } from "@/components/ui";
import { createLobby, describeJoinError, fetchPublicRooms, leaveLobby } from "@/lib/lobby";
import { logout, useSession } from "@/lib/session";

const cardColors = ["bg-violet text-white", "bg-turquoise", "bg-orange"];

export default function HomePage() {
  const session = useSession();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  // Revenir à l'accueil, c'est quitter le salon en cours.
  useEffect(() => void leaveLobby(), []);

  const joinByCode = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const code = normalizeRoomCode(String(new FormData(e.currentTarget).get("code")));
    if (!code) return setError("Code invalide : 6 caractères attendus.");
    router.push(`/lobby/${code}`);
  };

  const create = async (game: GameDefinition, isPublic: boolean) => {
    try {
      router.push(`/lobby/${await createLobby({ gameId: game.id as never, isPublic })}`);
    } catch (e) {
      setError(describeJoinError(e));
    }
  };

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-5 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-5xl text-violet [text-shadow:0_4px_0_var(--color-sun)]">{APP_NAME}</h1>
        {session.name && (
          <div className="flex items-center gap-3">
            <span className="font-bold">{session.name}</span>
            <Badge className={session.kind === "guest" ? "bg-sun" : "bg-turquoise"}>{session.kind === "guest" ? "Invité" : "Compte"}</Badge>
            <Button variant="plain" onClick={() => void logout()}>
              Déconnexion
            </Button>
          </div>
        )}
      </header>

      {!session.loaded ? (
        <p aria-busy="true">Chargement…</p>
      ) : !session.name ? (
        <AuthPanel />
      ) : (
        <>
          <Card className="bg-sun">
            <form onSubmit={joinByCode} className="flex flex-wrap items-end gap-3">
              <div className="grow">
                <label className="text-sm font-bold" htmlFor="join-code">
                  Rejoindre par code
                </label>
                <Input id="join-code" name="code" required maxLength={6} placeholder="ABC234" className="uppercase tracking-widest" autoComplete="off" />
              </div>
              <Button type="submit">Rejoindre</Button>
            </form>
          </Card>

          <p role="alert" className="font-bold text-coral">
            {error}
          </p>

          <section aria-label="Jeux" className="grid gap-6 md:grid-cols-3">
            {GAMES.map((game, i) => (
              <GameCard key={game.id} game={game} color={cardColors[i % cardColors.length]!} onCreate={create} onJoin={(code) => router.push(`/lobby/${code}`)} />
            ))}
          </section>
        </>
      )}
    </main>
  );
}

function GameCard({
  game,
  color,
  onCreate,
  onJoin,
}: {
  game: GameDefinition;
  color: string;
  onCreate: (game: GameDefinition, isPublic: boolean) => void;
  onJoin: (code: string) => void;
}) {
  const [rooms, setRooms] = useState<PublicRoomInfo[] | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(() => {
    fetchPublicRooms(game.id).then(
      (list) => (setRooms(list), setFailed(false)),
      () => setFailed(true),
    );
  }, [game.id]);
  useEffect(refresh, [refresh]);

  return (
    <Card className="flex flex-col gap-4">
      <div className={`rounded-2xl border-3 border-ink p-4 ${color}`}>
        <h2 className="text-2xl">{game.title}</h2>
        <p className="text-sm font-semibold opacity-90">{game.tagline}</p>
      </div>
      {game.status === "soon" && (
        <p className="text-xs font-bold text-ink/70">Le jeu arrive : seul le salon est disponible pour l'instant.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="accent" onClick={() => onCreate(game, true)}>
          Créer (public)
        </Button>
        <Button variant="plain" onClick={() => onCreate(game, false)}>
          Créer (privé)
        </Button>
      </div>
      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-lg">Salons publics</h3>
          <button type="button" className="text-sm font-bold underline" onClick={refresh}>
            Actualiser
          </button>
        </div>
        {failed ? (
          <p className="text-sm font-bold text-coral">Serveur de jeu injoignable.</p>
        ) : !rooms ? (
          <p className="text-sm">Chargement…</p>
        ) : rooms.length === 0 ? (
          <p className="text-sm text-ink/70">Aucun salon ouvert.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {rooms.map((room) => {
              const full = room.players >= room.capacity;
              return (
                <li key={room.code} className="flex items-center justify-between gap-2 rounded-xl border-2 border-ink bg-cream px-3 py-1.5 text-sm font-bold">
                  <span>
                    Salon de {room.hostName} · {room.players}/{room.capacity}
                  </span>
                  <Button className="!px-3 !py-0.5 !text-sm" variant="calm" disabled={full} onClick={() => onJoin(room.code)}>
                    {full ? "Complet" : "Rejoindre"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
