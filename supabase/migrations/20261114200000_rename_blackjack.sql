-- Le jeu s'appelle désormais « Blackjack » (et non plus « Blackjack Battle »).
update public.achievements
  set description = replace(description, 'Blackjack Battle', 'Blackjack')
  where description like '%Blackjack Battle%';
