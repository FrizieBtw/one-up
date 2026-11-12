-- Phase 1 : profils liés aux comptes Supabase Auth.
-- L'adresse e-mail reste dans auth.users et n'est jamais exposée aux autres joueurs.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null
    constraint profiles_username_format check (username ~ '^[[:alnum:]_\- ]{3,16}$' and username = btrim(username)),
  -- Identifiant court et stable, utilisé pour la recherche d'amis.
  public_id text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  created_at timestamptz not null default now()
);

-- Unicité du pseudo insensible à la casse.
create unique index profiles_username_lower_key on public.profiles (lower(username));

alter table public.profiles enable row level security;

create policy "profiles are readable by everyone"
  on public.profiles for select
  to anon, authenticated
  using (true);

create policy "users update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Le client ne peut modifier que son pseudo ; création et suppression passent par le serveur.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (username) on public.profiles to authenticated;

-- Crée le profil à l'inscription. Le pseudo vient des métadonnées d'inscription ; s'il est absent
-- (OAuth), invalide ou déjà pris, un pseudo de repli est généré pour ne jamais bloquer l'inscription.
create function public.handle_new_user()
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
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
