-- Phase 7 : jetons, boutique cosmétique, inventaire, missions.
-- Les clients lisent leurs données sous RLS ; toute écriture passe par des fonctions qui valident tout
-- (achat, équipement, aide de reprise) ou par record_match (récompenses), appelée par le serveur de jeu seul.
-- Les jetons n'achètent que des éléments cosmétiques : aucun avantage compétitif.

-- ---------- Réglages de l'économie (configurables) ----------
create table public.economy_settings (
  id boolean primary key default true check (id), -- une seule ligne
  initial_balance integer not null default 200 check (initial_balance >= 0),
  -- Aide de reprise : possible sous ce solde, au plus une fois par délai, indépendante de tout jeu d'argent.
  recovery_threshold integer not null default 20 check (recovery_threshold >= 0),
  recovery_amount integer not null default 100 check (recovery_amount > 0),
  recovery_cooldown_hours integer not null default 24 check (recovery_cooldown_hours > 0),
  -- Jetons de fin de session : base + bonus par manche gagnée, plafonnés par jour (UTC) et par joueur.
  game_reward_base integer not null default 10 check (game_reward_base >= 0),
  game_reward_per_win integer not null default 2 check (game_reward_per_win >= 0),
  daily_game_reward_cap integer not null default 150 check (daily_game_reward_cap >= 0)
);
insert into public.economy_settings default values;
alter table public.economy_settings enable row level security;
revoke all on public.economy_settings from anon, authenticated;
grant select on public.economy_settings to authenticated;
create policy "settings are readable" on public.economy_settings for select to authenticated using (true);

-- ---------- Portefeuille ----------
create table public.wallets (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  balance integer not null default 0 check (balance >= 0), -- jamais négatif, garanti par la base
  created_at timestamptz not null default now()
);
create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount integer not null check (amount <> 0),
  balance_after integer not null check (balance_after >= 0),
  kind text not null check (kind in ('initial', 'game_reward', 'mission_reward', 'purchase', 'recovery')),
  -- Référence de l'opération (session, mission, objet…) : (compte, nature, référence) est unique, donc une
  -- même récompense ou un même achat ne peut jamais être enregistré deux fois.
  ref text not null,
  created_at timestamptz not null default now(),
  unique (user_id, kind, ref)
);
create index wallet_transactions_user_idx on public.wallet_transactions (user_id, created_at desc);
alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;
revoke all on public.wallets, public.wallet_transactions from anon, authenticated;
grant select on public.wallets, public.wallet_transactions to authenticated;
create policy "users read their wallet" on public.wallets for select to authenticated using ((select auth.uid()) = user_id);
create policy "users read their transactions" on public.wallet_transactions for select to authenticated using ((select auth.uid()) = user_id);

-- Crée le portefeuille d'un compte avec le solde initial (une seule fois).
create function private.ensure_wallet(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.wallets (user_id, balance)
  select p_user, initial_balance from public.economy_settings
  on conflict (user_id) do nothing;
  if found then
    insert into public.wallet_transactions (user_id, amount, balance_after, kind, ref)
    select p_user, initial_balance, initial_balance, 'initial', 'initial'
    from public.economy_settings where initial_balance > 0
    on conflict do nothing;
  end if;
end;
$$;

-- Applique un mouvement au portefeuille. Renvoie le nouveau solde, ou null si le solde deviendrait négatif
-- ou si l'opération (même compte, nature et référence) a déjà été enregistrée.
create function private.wallet_apply(p_user uuid, p_amount integer, p_kind text, p_ref text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance integer;
begin
  perform private.ensure_wallet(p_user);
  select balance into v_balance from public.wallets where user_id = p_user for update; -- sérialise les opérations d'un compte
  if v_balance + p_amount < 0 then return null; end if;
  begin
    insert into public.wallet_transactions (user_id, amount, balance_after, kind, ref)
    values (p_user, p_amount, v_balance + p_amount, p_kind, p_ref);
  exception when unique_violation then
    return null;
  end;
  update public.wallets set balance = v_balance + p_amount where user_id = p_user;
  return v_balance + p_amount;
end;
$$;

-- ---------- Boutique et inventaire ----------
create table public.shop_items (
  id text primary key,
  category text not null check (category in ('outfit', 'accessory', 'emote', 'cartridge', 'decoration', 'effect')),
  name text not null,
  description text not null,
  price integer not null check (price > 0),
  payload jsonb not null default '{}'::jsonb,
  active boolean not null default true
);
create table public.user_inventory (
  user_id uuid not null references public.profiles (id) on delete cascade,
  item_id text not null references public.shop_items (id),
  acquired_at timestamptz not null default now(),
  equipped boolean not null default false,
  primary key (user_id, item_id)
);
alter table public.shop_items enable row level security;
alter table public.user_inventory enable row level security;
revoke all on public.shop_items, public.user_inventory from anon, authenticated;
grant select on public.shop_items to anon, authenticated;
grant select on public.user_inventory to authenticated;
create policy "shop is public" on public.shop_items for select to anon, authenticated using (active);
create policy "users read their inventory" on public.user_inventory for select to authenticated using ((select auth.uid()) = user_id);

-- Achat atomique. Renvoie : ok, not_found, already_owned, insufficient.
-- Le verrou du portefeuille sérialise les achats d'un compte : un double clic ne peut ni débiter deux fois ni acheter deux fois.
create function public.purchase_item(p_item text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_item public.shop_items;
  v_balance integer;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  select * into v_item from public.shop_items where id = p_item and active;
  if not found then return 'not_found'; end if;
  perform private.ensure_wallet(v_me);
  select balance into v_balance from public.wallets where user_id = v_me for update;
  if exists (select 1 from public.user_inventory where user_id = v_me and item_id = p_item) then return 'already_owned'; end if;
  if v_balance < v_item.price then return 'insufficient'; end if;
  perform private.wallet_apply(v_me, -v_item.price, 'purchase', p_item);
  insert into public.user_inventory (user_id, item_id) values (v_me, p_item);
  return 'ok';
end;
$$;

-- Équipe ou déséquipe un objet possédé. Un seul objet équipé par catégorie. Renvoie false si l'objet n'est pas possédé.
create function public.set_equipped(p_item text, p_equipped boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_category text;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  select s.category into v_category
  from public.user_inventory i join public.shop_items s on s.id = i.item_id
  where i.user_id = v_me and i.item_id = p_item;
  if v_category is null then return false; end if;
  if p_equipped then
    update public.user_inventory i set equipped = false
    from public.shop_items s
    where i.item_id = s.id and i.user_id = v_me and s.category = v_category and i.item_id <> p_item;
  end if;
  update public.user_inventory set equipped = p_equipped where user_id = v_me and item_id = p_item;
  return true;
end;
$$;

-- Aide de reprise : sous le seuil de solde, une fois par délai. Renvoie : ok, not_eligible, cooldown.
create function public.claim_recovery()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_settings public.economy_settings;
  v_balance integer;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  select * into v_settings from public.economy_settings;
  perform private.ensure_wallet(v_me);
  select balance into v_balance from public.wallets where user_id = v_me for update;
  if v_balance >= v_settings.recovery_threshold then return 'not_eligible'; end if;
  if exists (
    select 1 from public.wallet_transactions
    where user_id = v_me and kind = 'recovery' and created_at > now() - make_interval(hours => v_settings.recovery_cooldown_hours)
  ) then return 'cooldown'; end if;
  perform private.wallet_apply(v_me, v_settings.recovery_amount, 'recovery', gen_random_uuid()::text);
  return 'ok';
end;
$$;

revoke execute on function public.purchase_item(text), public.set_equipped(text, boolean), public.claim_recovery() from public, anon;
grant execute on function public.purchase_item(text), public.set_equipped(text, boolean), public.claim_recovery() to authenticated;

-- ---------- Missions ----------
create table public.missions (
  id text primary key,
  kind text not null check (kind in ('daily', 'challenge')), -- quotidienne (remise à zéro chaque jour UTC) ou défi unique
  title text not null,
  description text not null,
  game_id text, -- null : tous les jeux
  metric text not null check (metric in ('sessions', 'rounds_won', 'session_win', 'perfect_session')),
  target integer not null check (target > 0),
  reward integer not null check (reward > 0),
  active boolean not null default true
);
create table public.mission_progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  mission_id text not null references public.missions (id),
  period date not null, -- le jour (UTC) pour une quotidienne, 2000-01-01 pour un défi unique
  progress integer not null default 0,
  completed boolean not null default false,
  primary key (user_id, mission_id, period)
);
alter table public.missions enable row level security;
alter table public.mission_progress enable row level security;
revoke all on public.missions, public.mission_progress from anon, authenticated;
grant select on public.missions to anon, authenticated;
grant select on public.mission_progress to authenticated;
create policy "missions are public" on public.missions for select to anon, authenticated using (active);
create policy "users read their progress" on public.mission_progress for select to authenticated using ((select auth.uid()) = user_id);

insert into public.missions (id, kind, title, description, game_id, metric, target, reward) values
  ('daily_play', 'daily', 'Une partie par jour', 'Terminer une session de jeu.', null, 'sessions', 1, 30),
  ('daily_wins', 'daily', 'Trois manches gagnées', 'Gagner 3 manches dans la journée.', null, 'rounds_won', 3, 40),
  ('daily_first', 'daily', 'Sur la plus haute marche', 'Finir premier d''une session à 2 joueurs ou plus.', null, 'session_win', 1, 50),
  ('bj_perfect', 'challenge', 'Session parfaite', 'Blackjack Battle : gagner toutes les manches d''une session d''au moins 3 manches.', 'blackjack', 'perfect_session', 1, 100),
  ('sessions_10', 'challenge', 'Joueur régulier', 'Terminer 10 sessions de jeu.', null, 'sessions', 10, 150);

insert into public.shop_items (id, category, name, description, price, payload) values
  ('outfit_gold', 'outfit', 'Tenue dorée', 'Une tenue qui brille.', 250, '{"color": "#e6b422"}'),
  ('outfit_midnight', 'outfit', 'Tenue minuit', 'Bleu nuit profond.', 150, '{"color": "#1b1f4a"}'),
  ('outfit_mint', 'outfit', 'Tenue menthe', 'Frais et doux.', 150, '{"color": "#7be0c3"}'),
  ('acc_glasses', 'accessory', 'Lunettes rondes', 'Pour un air studieux.', 100, '{"accessory": "glasses"}'),
  ('acc_bow', 'accessory', 'Nœud papillon', 'Toujours élégant.', 100, '{"accessory": "bow"}'),
  ('acc_cap', 'accessory', 'Casquette', 'Visière vers l''avant.', 120, '{"accessory": "cap"}'),
  ('acc_crown', 'accessory', 'Couronne', 'Pour les rois de la table.', 300, '{"accessory": "crown"}'),
  ('emote_spin', 'emote', 'Emote Toupie', 'Tourner sur soi-même.', 120, '{"emote": "spin"}'),
  ('emote_bow', 'emote', 'Emote Révérence', 'Saluer avec classe.', 120, '{"emote": "bow"}'),
  ('cart_gold', 'cartridge', 'Cartouches dorées', 'Un fini métallisé pour toutes vos cartouches.', 200, '{"body": "#e6b422", "metalness": 0.7}'),
  ('cart_neon', 'cartridge', 'Cartouches néon', 'Un fini vif et lumineux.', 200, '{"body": "#ff2fd0", "metalness": 0.2}'),
  ('deco_stars', 'decoration', 'Cadre étoilé', 'Un cadre doré pour votre profil.', 150, '{"decoration": "stars"}'),
  ('deco_flames', 'decoration', 'Cadre en flammes', 'Un cadre orangé pour votre profil.', 150, '{"decoration": "flames"}'),
  ('fx_sparkles', 'effect', 'Étincelles', 'Des étincelles autour de votre avatar.', 250, '{"effect": "sparkles"}'),
  ('fx_bubbles', 'effect', 'Bulles', 'Des bulles qui flottent autour de vous.', 250, '{"effect": "bubbles"}');

-- ---------- Création des portefeuilles ----------
-- Chaque nouveau compte reçoit le solde initial. Un échec ne doit jamais bloquer l'inscription : le portefeuille
-- sera alors créé au premier besoin (ensure_wallet est appelée par toutes les fonctions qui y touchent).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  fallback text := 'Joueur_' || substr(replace(new.id::text, '-', ''), 1, 8);
begin
  begin
    insert into public.profiles (id, username)
    values (new.id, btrim(coalesce(new.raw_user_meta_data ->> 'username', fallback)));
  exception when unique_violation or check_violation then
    insert into public.profiles (id, username) values (new.id, fallback);
  end;
  begin
    perform private.ensure_wallet(new.id);
  exception when others then
    null;
  end;
  return new;
end;
$$;

select private.ensure_wallet(id) from public.profiles;

-- ---------- Enregistrement des résultats : jetons et missions ----------
-- Remplace la version de la phase 6 (même signature). En plus de l'XP et des succès :
--   - jetons de session : base + bonus par manche gagnée, plafonnés par jour (UTC) et par joueur ;
--   - progression des missions applicables, avec récompense versée une seule fois par mission et par période.
-- Idempotente : un second appel avec le même identifiant de session ne change rien.
-- Renvoie { recorded, rewards: [{ user_id, xp_gained, xp, achievements, tokens_gained, balance, missions }] }.
create or replace function public.record_match(p_session_id uuid, p_game_id text, p_rounds integer, p_participants jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rewards jsonb := '[]'::jsonb;
  v_count integer := jsonb_array_length(p_participants);
  v_day date := (now() at time zone 'utc')::date;
  v_settings public.economy_settings;
  r record;
  m record;
  v_xp integer;
  v_total integer;
  v_sp bigint;
  v_sw bigint;
  v_rw bigint;
  v_new text[];
  v_tokens integer;
  v_today integer;
  v_inc integer;
  v_period date;
  v_progress integer;
  v_was_completed boolean;
  v_paid integer;
  v_missions text[];
  v_balance integer;
begin
  select * into v_settings from public.economy_settings;

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
    -- XP
    v_xp := 20 + 10 * r.wins + 5 * r.pushes + case when r.rank = 1 and v_count >= 2 then 25 else 0 end;
    insert into public.progression as g (user_id, xp) values (r.user_id, v_xp)
      on conflict (user_id) do update set xp = g.xp + excluded.xp
      returning g.xp into v_total;

    -- Succès
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

    -- Jetons de session, plafonnés par jour
    perform private.ensure_wallet(r.user_id);
    v_tokens := 0;
    if p_rounds >= 1 then
      select coalesce(sum(amount), 0) into v_today from public.wallet_transactions
        where user_id = r.user_id and kind = 'game_reward' and (created_at at time zone 'utc')::date = v_day;
      v_tokens := least(v_settings.game_reward_base + v_settings.game_reward_per_win * r.wins, greatest(0, v_settings.daily_game_reward_cap - v_today));
      if v_tokens > 0 and private.wallet_apply(r.user_id, v_tokens, 'game_reward', p_session_id::text) is null then
        v_tokens := 0;
      end if;
    end if;

    -- Missions
    v_missions := '{}';
    for m in select * from public.missions where active and (game_id is null or game_id = p_game_id) loop
      v_inc := case m.metric
        when 'sessions' then 1
        when 'rounds_won' then r.wins
        when 'session_win' then (r.rank = 1 and v_count >= 2)::integer
        when 'perfect_session' then (p_rounds >= 3 and r.wins = p_rounds)::integer
      end;
      continue when v_inc is null or v_inc <= 0;
      v_period := case when m.kind = 'daily' then v_day else date '2000-01-01' end;
      insert into public.mission_progress as mp (user_id, mission_id, period, progress)
        values (r.user_id, m.id, v_period, v_inc)
        on conflict (user_id, mission_id, period) do update set progress = mp.progress + excluded.progress
        returning mp.progress, mp.completed into v_progress, v_was_completed;
      if v_progress >= m.target and not v_was_completed then
        update public.mission_progress set completed = true
          where user_id = r.user_id and mission_id = m.id and period = v_period;
        -- Référence mission + période : la même mission ne se paie qu'une fois par période.
        v_paid := private.wallet_apply(r.user_id, m.reward, 'mission_reward', m.id || ':' || v_period::text);
        if v_paid is not null then
          v_tokens := v_tokens + m.reward;
          v_missions := v_missions || m.id;
        end if;
      end if;
    end loop;

    select balance into v_balance from public.wallets where user_id = r.user_id;
    v_rewards := v_rewards || jsonb_build_object(
      'user_id', r.user_id, 'xp_gained', v_xp, 'xp', v_total, 'achievements', to_jsonb(v_new),
      'tokens_gained', v_tokens, 'balance', v_balance, 'missions', to_jsonb(v_missions));
  end loop;

  return jsonb_build_object('recorded', true, 'rewards', v_rewards);
end;
$$;
