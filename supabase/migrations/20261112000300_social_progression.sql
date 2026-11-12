-- Phase 6 : avatars, confidentialité, amis, progression (XP), succès.
-- Principe : les clients lisent (sous RLS) ; les écritures sensibles passent par des fonctions
-- ou par le serveur de jeu (clé service_role). Les fonctions utilitaires des politiques vivent dans
-- le schéma `private`, non exposé par l'API.

create schema if not exists private;
grant usage on schema private to anon, authenticated;

-- ---------- Avatars ----------
create table public.avatar_configurations (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  -- Forme validée par le serveur de jeu à la lecture (voir avatarConfigSchema) ; taille bornée ici.
  config jsonb not null check (jsonb_typeof(config) = 'object' and pg_column_size(config) < 400),
  updated_at timestamptz not null default now()
);
alter table public.avatar_configurations enable row level security;
revoke all on public.avatar_configurations from anon, authenticated;
grant select on public.avatar_configurations to anon, authenticated;
grant insert (user_id, config), update (config, updated_at) on public.avatar_configurations to authenticated;
create policy "avatars are readable" on public.avatar_configurations for select to anon, authenticated using (true);
create policy "users insert their avatar" on public.avatar_configurations for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "users update their avatar" on public.avatar_configurations for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------- Confidentialité ----------
create table public.user_privacy_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  -- Qui voit ma présence (en ligne, dans un lobby, en partie).
  presence text not null default 'friends' check (presence in ('everyone', 'friends', 'nobody')),
  -- Qui peut m'envoyer une demande d'ami.
  friend_requests text not null default 'everyone' check (friend_requests in ('everyone', 'nobody')),
  -- Qui voit mes statistiques, mes parties et mes succès (le niveau et l'XP restent publics : classements).
  show_stats text not null default 'everyone' check (show_stats in ('everyone', 'friends', 'nobody'))
);
alter table public.user_privacy_settings enable row level security;
revoke all on public.user_privacy_settings from anon, authenticated;
grant select on public.user_privacy_settings to authenticated;
grant insert (user_id, presence, friend_requests, show_stats), update (presence, friend_requests, show_stats)
  on public.user_privacy_settings to authenticated;
create policy "users read their privacy" on public.user_privacy_settings for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "users insert their privacy" on public.user_privacy_settings for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "users update their privacy" on public.user_privacy_settings for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------- Amis ----------
create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references public.profiles (id) on delete cascade,
  to_user uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (from_user <> to_user),
  unique (from_user, to_user)
);
create index friend_requests_to_idx on public.friend_requests (to_user);

create table public.friendships (
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b) -- une seule ligne par paire
);
create index friendships_b_idx on public.friendships (user_b);

alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
revoke all on public.friend_requests, public.friendships from anon, authenticated;
grant select on public.friend_requests, public.friendships to authenticated;
grant delete on public.friend_requests to authenticated;
create policy "parties read their requests" on public.friend_requests for select to authenticated
  using ((select auth.uid()) in (from_user, to_user));
-- L'expéditeur peut annuler sa demande ; le destinataire passe par respond_friend_request.
create policy "senders cancel their requests" on public.friend_requests for delete to authenticated
  using ((select auth.uid()) = from_user);
create policy "members read their friendships" on public.friendships for select to authenticated
  using ((select auth.uid()) in (user_a, user_b));

create function private.are_friends(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships
    where user_a = least(p_a, p_b) and user_b = greatest(p_a, p_b)
  );
$$;

-- Règle des statistiques : le propriétaire, ou selon son réglage `show_stats`.
create function private.can_view_stats(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_owner = (select auth.uid()) or coalesce(
    (select case s.show_stats
              when 'everyone' then true
              when 'friends' then private.are_friends(p_owner, (select auth.uid()))
              else false
            end
     from public.user_privacy_settings s where s.user_id = p_owner),
    true
  );
$$;
grant execute on function private.are_friends(uuid, uuid), private.can_view_stats(uuid) to anon, authenticated;

drop policy "participants are readable" on public.session_participants;
drop policy "stats are readable" on public.player_stats;
create policy "participants follow stats privacy" on public.session_participants for select to anon, authenticated
  using (private.can_view_stats(user_id));
create policy "stats follow stats privacy" on public.player_stats for select to anon, authenticated
  using (private.can_view_stats(user_id));

-- Envoi d'une demande. Renvoie : sent, accepted (demande croisée), already_friends, already_sent,
-- not_found, not_allowed (destinataire n'en accepte pas), limit (anti-spam).
create function public.send_friend_request(p_target uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if v_me = p_target or not exists (select 1 from public.profiles where id = p_target) then return 'not_found'; end if;
  if private.are_friends(v_me, p_target) then return 'already_friends'; end if;

  -- Demande croisée : on accepte directement.
  if exists (select 1 from public.friend_requests where from_user = p_target and to_user = v_me) then
    delete from public.friend_requests where from_user = p_target and to_user = v_me;
    insert into public.friendships (user_a, user_b) values (least(v_me, p_target), greatest(v_me, p_target))
      on conflict do nothing;
    return 'accepted';
  end if;

  if exists (select 1 from public.friend_requests where from_user = v_me and to_user = p_target) then return 'already_sent'; end if;
  if coalesce((select friend_requests from public.user_privacy_settings where user_id = p_target), 'everyone') = 'nobody' then
    return 'not_allowed';
  end if;
  -- Anti-spam : 10 demandes par heure, 30 en attente au plus.
  if (select count(*) from public.friend_requests where from_user = v_me and created_at > now() - interval '1 hour') >= 10
     or (select count(*) from public.friend_requests where from_user = v_me) >= 30 then
    return 'limit';
  end if;

  insert into public.friend_requests (from_user, to_user) values (v_me, p_target);
  return 'sent';
end;
$$;

create function public.respond_friend_request(p_request uuid, p_accept boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_from uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  delete from public.friend_requests where id = p_request and to_user = v_me returning from_user into v_from;
  if v_from is null then return false; end if;
  if p_accept then
    insert into public.friendships (user_a, user_b) values (least(v_me, v_from), greatest(v_me, v_from))
      on conflict do nothing;
  end if;
  return true;
end;
$$;

create function public.remove_friend(p_other uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  delete from public.friendships where user_a = least(v_me, p_other) and user_b = greatest(v_me, p_other);
end;
$$;

-- Recherche par pseudo (préfixe) ou par identifiant court exact. Les jokers LIKE saisis sont neutralisés.
create function public.search_profiles(p_query text)
returns table (id uuid, username text, public_id text)
language sql
stable
set search_path = ''
as $$
  select p.id, p.username, p.public_id
  from public.profiles p
  where length(btrim(p_query)) >= 2
    and p.id <> (select auth.uid())
    and (
      lower(p.username) like lower(replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_')) || '%'
      or p.public_id = upper(btrim(p_query))
    )
  order by p.username
  limit 10;
$$;

revoke execute on function public.send_friend_request(uuid), public.respond_friend_request(uuid, boolean),
  public.remove_friend(uuid), public.search_profiles(text) from public, anon;
grant execute on function public.send_friend_request(uuid), public.respond_friend_request(uuid, boolean),
  public.remove_friend(uuid), public.search_profiles(text) to authenticated;

-- ---------- Progression et succès ----------
create table public.progression (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  xp integer not null default 0 check (xp >= 0)
);
create index progression_xp_idx on public.progression (xp desc);
alter table public.progression enable row level security;
revoke all on public.progression from anon, authenticated;
grant select on public.progression to anon, authenticated;
create policy "progression is public" on public.progression for select to anon, authenticated using (true);

create table public.achievements (
  id text primary key,
  title text not null,
  description text not null
);
alter table public.achievements enable row level security;
revoke all on public.achievements from anon, authenticated;
grant select on public.achievements to anon, authenticated;
create policy "achievements are public" on public.achievements for select to anon, authenticated using (true);

create table public.user_achievements (
  user_id uuid not null references public.profiles (id) on delete cascade,
  achievement_id text not null references public.achievements (id),
  unlocked_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);
alter table public.user_achievements enable row level security;
revoke all on public.user_achievements from anon, authenticated;
grant select on public.user_achievements to anon, authenticated;
create policy "achievements follow stats privacy" on public.user_achievements for select to anon, authenticated
  using (private.can_view_stats(user_id));

insert into public.achievements (id, title, description) values
  ('first_session', 'Première table', 'Terminer une première session de jeu.'),
  ('first_round_win', 'Premier coup gagnant', 'Gagner une manche.'),
  ('sessions_5', 'Habitué', 'Terminer 5 sessions de jeu.'),
  ('rounds_25', 'Main chanceuse', 'Gagner 25 manches au total.'),
  ('sessions_won_3', 'Champion de table', 'Finir premier de 3 sessions.');

-- ---------- Enregistrement des résultats : XP et succès ----------
-- Remplace la version de la phase 4 (qui renvoyait un booléen). XP par joueur :
--   20 de participation + 10 par manche gagnée + 5 par égalité + 25 si premier d'une session à 2 joueurs ou plus.
-- Renvoie { recorded, rewards: [{ user_id, xp_gained, xp, achievements: [id] }] }.
drop function public.record_match(uuid, text, integer, jsonb);
create function public.record_match(p_session_id uuid, p_game_id text, p_rounds integer, p_participants jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rewards jsonb := '[]'::jsonb;
  v_count integer := jsonb_array_length(p_participants);
  r record;
  v_xp integer;
  v_total integer;
  v_sp bigint;
  v_sw bigint;
  v_rw bigint;
  v_new text[];
begin
  insert into public.game_sessions (id, game_id, rounds)
  values (p_session_id, p_game_id, p_rounds)
  on conflict (id) do nothing;
  if not found then
    return jsonb_build_object('recorded', false, 'rewards', v_rewards);
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

  for r in
    select * from jsonb_to_recordset(p_participants)
      as p(user_id uuid, rank integer, score integer, wins integer, pushes integer, losses integer)
  loop
    v_xp := 20 + 10 * r.wins + 5 * r.pushes + case when r.rank = 1 and v_count >= 2 then 25 else 0 end;
    insert into public.progression as g (user_id, xp) values (r.user_id, v_xp)
      on conflict (user_id) do update set xp = g.xp + excluded.xp
      returning g.xp into v_total;

    select coalesce(sum(sessions_played), 0), coalesce(sum(sessions_won), 0), coalesce(sum(rounds_won), 0)
      into v_sp, v_sw, v_rw
      from public.player_stats where user_id = r.user_id;

    with candidates (id, ok) as (
      values ('first_session'::text, v_sp >= 1), ('first_round_win', v_rw >= 1), ('sessions_5', v_sp >= 5),
             ('rounds_25', v_rw >= 25), ('sessions_won_3', v_sw >= 3)
    ), unlocked as (
      insert into public.user_achievements (user_id, achievement_id)
      select r.user_id, c.id from candidates c where c.ok
      on conflict do nothing
      returning achievement_id
    )
    select coalesce(array_agg(achievement_id), '{}') into v_new from unlocked;

    v_rewards := v_rewards || jsonb_build_object('user_id', r.user_id, 'xp_gained', v_xp, 'xp', v_total, 'achievements', to_jsonb(v_new));
  end loop;

  return jsonb_build_object('recorded', true, 'rewards', v_rewards);
end;
$$;

revoke execute on function public.record_match(uuid, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.record_match(uuid, text, integer, jsonb) to service_role;
