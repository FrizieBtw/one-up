-- Rattrape les comptes créés avant le déclencheur handle_new_user (ou si celui-ci a échoué) : sans profil,
-- le serveur de jeu refuse la connexion. Idempotent. Même règle que le déclencheur : pseudo des
-- métadonnées s'il est valide et libre, sinon pseudo de repli.
insert into public.profiles (id, username)
select u.id,
  case
    when u.meta ~ '^[[:alnum:]_\- ]{3,16}$' and u.meta = btrim(u.meta)
         and not exists (select 1 from public.profiles p where lower(p.username) = lower(u.meta))
      then u.meta
    else 'Joueur_' || substr(replace(u.id::text, '-', ''), 1, 8)
  end
from (select id, raw_user_meta_data ->> 'username' as meta from auth.users) u
where not exists (select 1 from public.profiles p where p.id = u.id);
