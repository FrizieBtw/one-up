-- Avatar v2 : personnage KayKit assemblé à partir de pièces (voir docs/ARCHITECTURE.md).
-- - La configuration désigne des pièces par identifiant : plus volumineuse que les anciennes couleurs, la limite de taille passe de 400 à 1000 octets.
--   Les anciennes configurations (v1) restent valides : elles sont converties à la lecture par le serveur de jeu et par le client.
-- - Les tenues de boutique ne sont plus des couleurs (les vêtements ne sont pas recolorables) mais des tenues complètes de personnages KayKit.
--   Les identifiants d'objets ne changent pas : les achats déjà faits restent valables.

alter table public.avatar_configurations drop constraint if exists avatar_configurations_config_check;
alter table public.avatar_configurations
  add constraint avatar_configurations_config_check check (jsonb_typeof(config) = 'object' and pg_column_size(config) < 1000);

update public.shop_items set name = 'Tenue de paladin', description = 'Une armure qui brille.', payload = '{"outfit": "Paladin"}' where id = 'outfit_gold';
update public.shop_items set name = 'Combinaison spatiale', description = 'Pour explorer les étoiles.', payload = '{"outfit": "SpaceRanger"}' where id = 'outfit_midnight';
update public.shop_items set name = 'Soldat de plomb', description = 'Au garde-à-vous.', payload = '{"outfit": "ToySoldier"}' where id = 'outfit_mint';

-- Les avatars n'utilisent plus que des pièces KayKit : retrait des objets dessinés à la main (nœud papillon, couronne, effets).
-- Personne ne les possédait au moment du retrait ; la suppression échouerait sinon (clé étrangère de l'inventaire).
delete from public.shop_items where id in ('acc_bow', 'acc_crown', 'fx_sparkles', 'fx_bubbles');
-- Casquette au même prix que les lunettes (100 jetons).
update public.shop_items set price = 100 where id = 'acc_cap';
