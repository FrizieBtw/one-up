-- Mises à la table de blackjack : le serveur de jeu débite le portefeuille quand un joueur mise, puis verse les gains.
-- Les trois fonctions ne sont appelables que par le serveur de jeu (rôle service) : un client ne peut ni se verser des
-- jetons ni miser à la place d'un autre. Chaque mouvement est idempotent grâce à sa référence (compte, nature, référence).

alter table public.wallet_transactions drop constraint wallet_transactions_kind_check;
alter table public.wallet_transactions
  add constraint wallet_transactions_kind_check
  check (kind in ('initial', 'game_reward', 'mission_reward', 'purchase', 'recovery', 'bet', 'payout'));

-- Solde du compte (le portefeuille est créé au besoin, avec le solde initial).
create function public.table_balance(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance integer;
begin
  perform private.ensure_wallet(p_user);
  select balance into v_balance from public.wallets where user_id = p_user;
  return v_balance;
end;
$$;

-- Mise : débite le compte. Renvoie le nouveau solde, ou null si le solde est insuffisant ou si cette mise est déjà enregistrée.
create function public.table_bet(p_user uuid, p_amount integer, p_ref text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_amount <= 0 then return null; end if;
  return private.wallet_apply(p_user, -p_amount, 'bet', p_ref);
end;
$$;

-- Gain : crédite le compte (mise rendue + gain). Renvoie le nouveau solde, ou null si ce versement est déjà enregistré.
create function public.table_payout(p_user uuid, p_amount integer, p_ref text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_amount <= 0 then return null; end if;
  return private.wallet_apply(p_user, p_amount, 'payout', p_ref);
end;
$$;

revoke execute on function public.table_balance(uuid), public.table_bet(uuid, integer, text), public.table_payout(uuid, integer, text)
  from public, anon, authenticated;
