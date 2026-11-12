-- Phase 4 : résultats de parties et statistiques par jeu.
-- Écrits uniquement par le serveur de jeu (clé service_role) via record_match ; les clients lisent seulement.

create table public.game_sessions (
  -- Identifiant généré par le serveur de jeu au lancement : sert de clé d'idempotence.
  id uuid primary key,
  game_id text not null,
  rounds integer not null check (rounds >= 0),
  ended_at timestamptz not null default now()
);

create table public.session_participants (
  session_id uuid not null references public.game_sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  rank integer not null check (rank >= 1),
  score integer not null,
  wins integer not null,
  pushes integer not null,
  losses integer not null,
  primary key (session_id, user_id)
);
create index session_participants_user_idx on public.session_participants (user_id);

create table public.player_stats (
  user_id uuid not null references public.profiles (id) on delete cascade,
  game_id text not null,
  sessions_played integer not null default 0,
  sessions_won integer not null default 0,
  rounds_won integer not null default 0,
  rounds_pushed integer not null default 0,
  rounds_lost integer not null default 0,
  total_score integer not null default 0,
  primary key (user_id, game_id)
);

alter table public.game_sessions enable row level security;
alter table public.session_participants enable row level security;
alter table public.player_stats enable row level security;

-- Lecture ouverte (classements) ; les réglages de confidentialité affineront en phase 6.
create policy "sessions are readable" on public.game_sessions for select to anon, authenticated using (true);
create policy "participants are readable" on public.session_participants for select to anon, authenticated using (true);
create policy "stats are readable" on public.player_stats for select to anon, authenticated using (true);

revoke insert, update, delete on public.game_sessions, public.session_participants, public.player_stats from anon, authenticated;

-- Enregistre une session terminée. Idempotent : un second appel avec le même identifiant ne change rien
-- et renvoie false. p_participants : [{ "user_id", "rank", "score", "wins", "pushes", "losses" }].
create function public.record_match(p_session_id uuid, p_game_id text, p_rounds integer, p_participants jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.game_sessions (id, game_id, rounds)
  values (p_session_id, p_game_id, p_rounds)
  on conflict (id) do nothing;
  if not found then
    return false;
  end if;

  insert into public.session_participants (session_id, user_id, rank, score, wins, pushes, losses)
  select p_session_id, p.user_id, p.rank, p.score, p.wins, p.pushes, p.losses
  from jsonb_to_recordset(p_participants)
    as p(user_id uuid, rank integer, score integer, wins integer, pushes integer, losses integer);

  insert into public.player_stats as s
    (user_id, game_id, sessions_played, sessions_won, rounds_won, rounds_pushed, rounds_lost, total_score)
  select p.user_id, p_game_id, 1, (p.rank = 1)::integer, p.wins, p.pushes, p.losses, p.score
  from jsonb_to_recordset(p_participants)
    as p(user_id uuid, rank integer, score integer, wins integer, pushes integer, losses integer)
  on conflict (user_id, game_id) do update set
    sessions_played = s.sessions_played + 1,
    sessions_won = s.sessions_won + excluded.sessions_won,
    rounds_won = s.rounds_won + excluded.rounds_won,
    rounds_pushed = s.rounds_pushed + excluded.rounds_pushed,
    rounds_lost = s.rounds_lost + excluded.rounds_lost,
    total_score = s.total_score + excluded.total_score;

  return true;
end;
$$;

revoke execute on function public.record_match(uuid, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.record_match(uuid, text, integer, jsonb) to service_role;
