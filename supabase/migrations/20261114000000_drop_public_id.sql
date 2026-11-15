-- Le pseudo est unique et modifiable par son propriétaire : l'identifiant court public (public_id) ne sert plus.
-- La recherche d'amis se fait par pseudo (préfixe) uniquement.
drop function public.search_profiles(text);

create function public.search_profiles(p_query text)
returns table (id uuid, username text)
language sql
stable
set search_path = ''
as $$
  select p.id, p.username
  from public.profiles p
  where length(btrim(p_query)) >= 2
    and p.id <> (select auth.uid())
    and lower(p.username) like lower(replace(replace(replace(btrim(p_query), '\', '\'), '%', '\%'), '_', '\_')) || '%'
  order by p.username
  limit 10;
$$;

revoke execute on function public.search_profiles(text) from public, anon;
grant execute on function public.search_profiles(text) to authenticated;

alter table public.profiles drop column public_id;
