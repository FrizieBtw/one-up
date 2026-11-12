-- handle_new_user ne sert que de déclencheur sur auth.users : inutile de l'exposer en RPC (/rest/v1/rpc).
revoke execute on function public.handle_new_user() from public, anon, authenticated;
