-- Couleur choisie par le joueur : fond de sa pastille, pseudo dans le chat, etc. Nulle = couleur automatique (d'après le pseudo).
alter table public.profiles
  add column color text check (color is null or color ~ '^#[0-9a-f]{6}$');

grant update (color) on public.profiles to authenticated;
