# État du projet StepUp

Dernière mise à jour : 2026-11-12. À lire en premier pour reprendre le développement.
Cahier des charges : prompt maître du porteur de projet (23 sections). Architecture : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Phase en cours

- **Phase 1 — Fondations** : terminée ; comptes Supabase configurés (projet hébergé `OneUP`), inscription et connexion réelles non testées.
- **Phase 2 — Accueil et cartouches** : terminée. Sons de cartouche non faits.
- **Phase 3 — Lobbies sociaux** : terminée.
- **Phase 4 — Blackjack Battle** : terminée ; enregistrement des résultats vérifié en SQL et côté serveur (simulé), pas encore de bout en bout avec un vrai compte.
- **Phase 5 — Console et transitions** : terminée.
- **Phase 6 — Profils et progression** : terminée (branche `phase-6-profils`) sauf les invitations de salon entre amis et l'historique de parties affiché.
  Le critère « les données persistent entre les sessions » est vérifié en SQL et par tests simulés, pas avec un vrai compte.
- Prochaine : **phase 7** (jetons, missions, boutique, inventaire).

## Ce qui fonctionne réellement (vérifié)

- Monorepo npm workspaces : `apps/web`, `apps/game-server`, `packages/shared`.
- Serveur Colyseus : salon `lobby` autoritaire. Authentification obligatoire, création publique ou privée, code unique à 6 caractères,
  jointure par code, liste des salons publics par jeu, statut « prêt », chat limité en débit, réglages et capacité réservés à l'hôte
  et validés par le schéma du jeu, transfert d'hôte, siège conservé 60 s, refus des doublons d'identité.
- Accueil : grille de cartouches 3D (silhouette originale à marches, étiquette illustrée par code, survol, état « bientôt »).
- Clic sur une cartouche : elle s'avance, s'agrandit, se retourne ; son dos affiche trois actions réelles :
  chercher une partie (salons publics, actualisation toutes les 5 s, filtre « places libres »), rejoindre par code, créer une partie (public ou privé).
  Bouton Retour et touche Échap.
- Transition vers le lobby sans changement de page : la cartouche se réduit en haut à droite ; un clic la ré-agrandit et affiche les règles sur son dos
  (générées depuis le schéma du jeu, modifiables par l'hôte seul). Annonce visible à chaque changement de règle, statuts « prêt » conservés.
- Lien de partage `/lobby/CODE` : identification si besoin, puis entrée dans le salon. Bouton retour du navigateur : quitte le salon.
- Erreurs de jointure traitées : code invalide, salon introuvable, salon complet, session expirée, doublon.
- Lobby 3D : salle ronde stylisée, avatars chibi procéduraux avec nom, déplacement libre au clavier (ZQSD, WASD, flèches),
  simulation autoritaire côté serveur, prédiction locale, interpolation des autres joueurs.
- Emotes (salut, danse, bravo, rire) par boutons ou touches 1 à 4, diffusées à tous, limitées en débit.
- Propositions de règles par tout joueur, votes pour ou contre, décision de l'hôte (valider ou rejeter) ; le vote n'applique rien.
  Anti-spam : une proposition par joueur toutes les 10 s, cinq ouvertes au plus.
- Lancement de partie : réservé à l'hôte, minimum de joueurs et majorité stricte de prêts, compte à rebours de 5 s annulable,
  annulé d'office si la majorité disparaît. Plus d'entrée dans le salon et règles verrouillées dès le compte à rebours.
- Blackjack Battle jouable de bout en bout : distribution, tirer ou rester, as, naturel, croupier, tours séquentiels avec temps de décision,
  repli automatique au chrono, score 3/1/0, manches illimitées, manche suivante automatique après 15 s, fin de session par l'hôte,
  écran de résultats, retour au lobby. Table 3D avec croupier, cartes animées, avatars, classement en direct, chat en jeu.
  Commandes clavier (T, R) et manette.
- Console fictive originale et séquence de lancement : la cartouche quitte le coin, la console apparaît, la cartouche s'insère dans le port.
  La séquence démarre à la confirmation serveur et ne se termine que lorsque la scène de jeu est chargée.
  Bouton « Passer l'animation », qui ne fait jamais entrer avant que le jeu soit prêt.
- Effets sonores synthétisés (sélection, retournement, insertion, prêt) avec bouton muet et volume des effets, mémorisés.
- Modération de premier niveau : filtre de mots côté serveur, blocage local d'un joueur (messages masqués), signalement journalisé.
- Base Supabase `OneUP` : 5 migrations appliquées (profils, résultats, avatars, confidentialité, amis, progression, succès, rattrapage de profil).
  Un compte existait avant le déclencheur d'inscription et n'avait pas de profil : il a été rattrapé.
- Profil (`/profile`, comptes) : niveau et barre d'XP, statistiques par jeu, succès, identifiant court, aperçu 3D animé de l'avatar.
- Éditeur d'avatar : teint, coiffure, couleur de cheveux, yeux, tenue (options gratuites), aperçu 3D, enregistrement. Invitation facultative à
  personnaliser après l'inscription. L'avatar enregistré apparaît dans les lobbies et à la table de blackjack ; défaut dérivé de l'identité sinon.
- Amis : recherche par pseudo ou identifiant, demandes envoyées, reçues, acceptées, refusées, annulées, retrait, anti-spam (10 par heure, 30 en attente).
- Présence : en ligne, dans un lobby, en partie (avec le jeu), pour les amis, selon les réglages de confidentialité de chacun.
- Confidentialité : présence, statistiques et demandes d'ami réglables (tous, amis, personne).
- XP et niveaux calculés côté serveur à la fin d'une session ; succès (5) ; récompenses affichées sur l'écran de résultats ; classements mondial et entre amis.

Vérifications exécutées le 2026-11-12 :

- `npm test` : 33 tests réussis. Phase 6 : niveaux, avatars valides, présence masquée, et un fichier de comptes simulés
  (`accounts.test.ts`, authentification et base simulées) qui vérifie l'avatar relu et revalidé, le classement calculé par le serveur et transmis
  une seule fois, l'envoi des récompenses au bon compte, la présence tout au long d'une session et son filtrage par confidentialité, l'absence
  d'avatar et de présence pour un invité. Blackjack : règles pures (as, naturel, croupier, résolution) et une partie complète côté serveur
  avec paquet truqué (conditions de lancement, annulations, entrée refusée en cours de partie, carte cachée absente de l'état,
  action hors tour refusée, chrono, manche automatique, départ de l'hôte pendant son tour, résultats, retour au lobby).
- `npm run test:e2e` : trois parcours Playwright réussis (Chromium), exécutés en séquence (en parallèle, la charge les rendait intermittents).
  Le parcours du profil utilise une base Supabase simulée dans le navigateur : il vérifie l'interface et ses appels, pas la vraie base.
  Il couvre l'invitation d'avatar, le profil, l'édition et l'enregistrement de l'avatar, la recherche, l'envoi, l'acceptation et l'annulation de demandes,
  la présence, les classements, la confidentialité.
  Deux parcours existants : Blackjack à deux joueurs : recherche publique avec un salon listé,
  lancement bloqué puis permis, annulation, séquence de console regardée par un joueur et passée par l'autre, réglage du son, deux manches, chat en jeu, résultats, retour au lobby. Lobby avec 4 joueurs : dos de cartouche, Échap, création privée, code inconnu refusé,
  jointure par code, salon privé absent de la recherche, règles au dos de la mini cartouche, annonce reçue, proposition, votes et validation,
  déplacement au clavier vu par l'autre joueur, chat filtré, blocage et déblocage, signalement, lien de partage, rechargement sans doublon,
  départ de l'hôte et transfert du rôle.
- `npm run typecheck` et `npm run build` : sans erreur.
- Rendu contrôlé sur captures d'écran Playwright (grille, dos de cartouche, règles, propositions, salle 3D, table de blackjack,
  fin de manche, résultats, console avec cartouche insérée, profil, éditeur d'avatar, amis).
- Base hébergée : un bloc SQL volontairement annulé a exercé `record_match` (XP 65 et 25, idempotence, succès débloqués, statistiques non doublées),
  les fonctions d'amis (envoi, doublon, auto-demande, demande croisée acceptée, refus de réception, réponse réservée au destinataire),
  la confidentialité des statistiques et la recherche (jokers neutralisés). Rien n'est resté dans la base. Contrôle de sécurité Supabase relu.

## Écrit mais non vérifié

- **Parcours réel avec un compte** : inscription et connexion par e-mail, Google, Discord ; vérification du jeton par le serveur de jeu ;
  lecture et écriture du navigateur sous RLS avec un vrai jeton (profil, avatar, confidentialité, amis) ; appel réel de `record_match` par le serveur de jeu
  avec la clé secrète ; présence réelle entre deux comptes amis. Je ne crée pas de compte sur la base hébergée : à essayer par le porteur,
  idéalement avec deux comptes (e-mail avec confirmation activée par défaut chez Supabase).
- Droits d'écriture par colonne (avatar, confidentialité) : une première sauvegarde d'avatar réelle a échoué (« permission denied for table avatar_configurations »,
  403 PostgREST 42501) parce que l'insertion envoyait aussi `updated_at`, colonne non insérable par le client. Corrigé (`social.ts`) ; le simulacre du
  parcours de profil refuse désormais toute colonne non accordée et échoue avec l'ancien code. La sauvegarde corrigée n'a pas encore été retentée avec un vrai compte,
  et la confidentialité (insertion de toutes ses colonnes, accordées) non plus.
- Prédiction locale sous latence réelle : testée seulement en local, sans latence.
- Éditeur d'avatar : le rendu du profil et de l'éditeur a été vu sur captures fixes ; l'apparence dans le lobby d'un avatar enregistré est
  couverte par le test serveur (état) mais n'a pas été observée à l'écran.

## Limitations connues

- Kart Rush et Party Worlds marqués « bientôt » : leur salon existe, le lancement y est refusé.
- Pas de musique (seulement des effets) : le réglage de volume musique viendra avec elle.
- La console n'apparaît qu'au lancement ; pas d'animation de retour vers le lobby en fin de session.
- Écran de résultats : XP et succès (comptes), pas de jetons (phase 7).
- Pas d'invitation d'un ami dans un salon (cahier des charges 7.3) ni d'historique de parties affiché : les données existent
  (`session_participants`), l'interface non.
- Classements : mondial et entre amis par XP seulement ; pas de classement par jeu (les statistiques par jeu sont sur le profil).
- Cinq succès seulement, tous liés au volume de parties ou de manches gagnées.
- Présence « en ligne » uniquement quand le site est ouvert (signal toutes les 30 s) ; mémoire d'un seul processus.
- Blocage de joueurs toujours local à l'appareil, pas lié au compte.
- Pas d'outil de modération pour les signalements ; pas de suppression de compte.
- Blackjack : pas d'effets sonores propres au jeu ; la carte du croupier n'a pas d'animation de retournement.
- Filtre de chat : liste de mots courte, à remplacer avant ouverture publique. Signalements seulement journalisés, sans outil de modération.
  Blocage stocké dans le navigateur, pas dans le compte.
- Pas de collisions entre avatars ni avec le décor. Avatar : 4 teints, 3 coiffures, 6 couleurs de cheveux, 2 styles d'yeux, 6 tenues ; pas de visage
  morphologique ni de cosmétiques payants (phase 7). Un avatar modifié n'apparaît dans un salon déjà ouvert qu'à la prochaine connexion.
- Une seule salle de lobby, commune à tous les jeux (les salles thématiques restent possibles : le décor est un composant isolé).
- Pas de réglage de qualité graphique.
- Deux canvas WebGL rendent en continu dans le lobby : à mesurer et optimiser en phase 10.
- Limiteurs de débit en mémoire, un seul processus serveur.
- Tester à deux exige deux navigateurs distincts : deux onglets partagent la même identité invitée.

## Hypothèses prises (à confirmer par le porteur)

- Blackjack : 6 joueurs maximum.
- Rôle d'hôte : transfert si l'hôte part ou reste déconnecté plus de 10 s ; l'ancien hôte ne le récupère pas.
- Jeton invité valable 24 h ; progression des invités non conservée.
- Revenir à l'accueil (bouton Quitter ou retour du navigateur) quitte le salon.
- Un joueur déconnecté reste visible, estompé, pendant sa fenêtre de reconnexion.
- Au terme du compte à rebours, tous les joueurs connectés participent, prêts ou non : le compte à rebours visible leur laisse
  le temps de réagir ou de quitter. Les joueurs déconnectés à cet instant sont retirés du salon.
- Blackjack : croupier qui reste sur 17 souple, pas de doublement ni de séparation, paquet remélangé à chaque manche.
- Blackjack : sans décision de l'hôte, la manche suivante démarre après 15 s.
- Rejoindre par code depuis la cartouche d'un autre jeu est accepté : la cartouche affichée devient celle du jeu du salon.
- Motion n'est pas installé : les transitions DOM actuelles tiennent en CSS. À ajouter quand une transition le demandera.
- Drei n'est pas installé : aucun de ses composants n'est utilisé pour l'instant.

## En attente du porteur

1. Tester l'inscription et la connexion réelles (ci-dessus), avec idéalement deux comptes pour les amis et la présence.
2. Activer dans le tableau de bord Supabase la protection contre les mots de passe compromis (alerte restante du contrôle de sécurité).
3. Identifiants OAuth Google et Discord, et URL de redirection `http://localhost:3000`.
4. `GUEST_TOKEN_SECRET` à renseigner avant toute mise en production (vide en développement, le serveur refusera de démarrer en production).

## Prochaines étapes (phase 7)

1. Migrations : `wallets`, `wallet_transactions`, `shop_items`, `user_inventory`, `missions`, `mission_progress`.
2. Jetons : solde initial configurable, aide de reprise limitée côté serveur, récompenses de fin de session ajoutées à `record_match`
   dans la même transaction (idempotence déjà assurée par l'identifiant de session).
3. Missions quotidiennes et défis, progression calculée côté serveur.
4. Boutique cosmétique : achat transactionnel sans solde négatif ni double achat, inventaire, équipement ; l'éditeur d'avatar proposera les objets possédés.
5. Reporter ici, si souhaité : invitations de salon entre amis, historique de parties.

## Repères dans le code

| Sujet | Fichier |
| --- | --- |
| Nom du produit, constantes | `packages/shared/src/config.ts` |
| Catalogue des jeux et réglages | `packages/shared/src/games.ts` |
| Protocole réseau | `packages/shared/src/protocol.ts` |
| Salon de lobby | `apps/game-server/src/rooms/LobbyRoom.ts` |
| Routes HTTP du serveur | `apps/game-server/src/app.ts` |
| Jetons et vérification | `apps/game-server/src/auth.ts` |
| États de navigation et URL | `apps/web/src/lib/nav.ts` |
| Connexion lobby côté client | `apps/web/src/lib/lobby.ts` |
| Session (invité, Supabase) | `apps/web/src/lib/session.ts` |
| Scène 3D et modèle de cartouche | `apps/web/src/cartridge/CartridgeScene.tsx` |
| Étiquettes et couleurs des cartouches | `apps/web/src/cartridge/art.ts` |
| Ancres DOM suivies par la 3D | `apps/web/src/cartridge/anchors.ts` |
| Coquille de l'application | `apps/web/src/components/StepUpApp.tsx` |
| Dos de cartouche (accueil, règles) | `apps/web/src/components/CartridgeBack.tsx`, `HomePanels.tsx`, `LobbyScreen.tsx` |
| Salle 3D du lobby, déplacements | `apps/web/src/lobby3d/LobbyRoom3D.tsx` |
| Avatar chibi | `apps/web/src/avatar/Avatar.tsx` |
| Entrées clavier et manette | `apps/web/src/lib/input.ts` |
| Mouvement partagé client/serveur | `packages/shared/src/movement.ts` |
| Filtre de chat | `packages/shared/src/moderation.ts` |
| Règles du blackjack | `packages/games/blackjack/src/index.ts` |
| Partie de blackjack (serveur) | `apps/game-server/src/games/blackjack.ts` |
| Écran et table de blackjack | `apps/web/src/blackjack/` |
| Enregistrement des résultats | `apps/game-server/src/persistence.ts`, `supabase/migrations/20261112000100_match_results.sql` |
| Console et séquence de lancement | `apps/web/src/cartridge/CartridgeScene.tsx` (`Console`), `apps/web/src/components/LaunchSequence.tsx` |
| Effets sonores et réglages | `apps/web/src/lib/audio.ts` |
| Profil, amis, classements, confidentialité | `apps/web/src/components/profile/ProfileScreen.tsx`, `apps/web/src/lib/social.ts` |
| Éditeur et aperçu d'avatar | `apps/web/src/components/profile/AvatarEditor.tsx`, `packages/shared/src/avatar.ts` |
| Niveaux et XP | `packages/shared/src/progression.ts`, fonction SQL `record_match` |
| Présence | `apps/game-server/src/presence.ts`, `packages/shared/src/presence.ts` |
| Migrations de la phase 6 | `supabase/migrations/20261112000300_social_progression.sql`, `…000400_backfill_profiles.sql` |
| Design system | `apps/web/src/app/globals.css`, `apps/web/src/components/ui.tsx` |
| Tests de parcours | `tests/e2e/lobby.spec.ts`, `blackjack.spec.ts`, `profile.spec.ts` (base simulée) |
| Tests de comptes simulés | `apps/game-server/src/accounts.test.ts` |

## Notes techniques utiles

- Colyseus 0.18 : `defineServer`/`defineRoom`, schémas via `schema()` et `t` (pas de décorateurs), `onDrop`/`onReconnect`/`onLeave`.
  Un départ avec le code 4000 est « consenti » : pas de siège réservé.
- Un salon plein est verrouillé : la jointure renvoie « is locked » (traduit en « Salon complet » côté client).
- `@colyseus/sdk` reconnecte automatiquement après une coupure ; le jeton en sessionStorage couvre le rechargement de page.
- Cartouches : un seul canvas plein écran non interactif. Chaque cartouche s'aligne sur une ancre DOM (cellule, centre, coin).
  Le DOM porte clics, clavier et défilement ; le panneau du dos est du DOM calé sur la plaque claire du modèle.
- `<Outlines>` de drei casse sur la géométrie extrudée de la cartouche (polygones géants) : ne pas le réutiliser tel quel.
- Colyseus déconnecte un client dont un message échoue à la validation zod : l'interface doit toujours envoyer des charges valides.
- Tests de jeu : `tuning` (`apps/game-server/src/games/blackjack.ts`) permet un paquet truqué et un temps accéléré.
- En développement, `window.__lobbyRoom` expose la connexion du salon (utilisé par le test de parcours).
- Vérifier du SQL sans rien laisser dans la base : un bloc `do $$ … $$` qui insère des faux comptes, appelle les fonctions, puis se termine par
  `raise exception 'OK …'` est annulé en entier ; `set_config('request.jwt.claims', …, true)` simule `auth.uid()`.
- Les fonctions créées dans `public` sont exécutables par tous par défaut : toujours `revoke … from public, anon` puis `grant` explicite.
- `boot()` de `@colyseus/testing` ignore son paramètre de port quand on lui passe un serveur défini (toujours 2568) : pour un second fichier de test,
  appeler `server.listen(port)` puis `new ColyseusTestServer(server)`.
- Les parcours Playwright tournent en séquence (`workers: 1`) : en parallèle, la charge WebGL fait expirer les fenêtres de temps du jeu.
- Tables à droits par colonne : `social.ts` met à jour puis insère si aucune ligne, plutôt qu'un upsert (qui réécrirait `user_id`, colonne non modifiable). Raisonnement non vérifié avec un vrai client.
- Le volet navigateur de l'application Claude ne compose pas d'images quand il est masqué : passer par les captures Playwright.
