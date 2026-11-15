-- L'aide de reprise (jetons offerts sous un seuil) est supprimée.
-- Le type de transaction 'recovery' reste autorisé pour l'historique des aides déjà versées.
drop function public.claim_recovery();

alter table public.economy_settings
  drop column recovery_threshold,
  drop column recovery_amount,
  drop column recovery_cooldown_hours;
