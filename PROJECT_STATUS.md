# État du projet StepUp

Dernière mise à jour : 2026-11-12. À lire en premier pour reprendre le développement.
Cahier des charges : prompt maître du porteur de projet (23 sections). Architecture : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Phase en cours

- **Phase 1 — Fondations** : terminée côté invité ; comptes Supabase écrits mais non vérifiés.
- **Phase 2 — Accueil et cartouches** : terminée. Sons de cartouche non faits.
- **Phase 3 — Lobbies sociaux** : terminée.
- **Phase 4 — Blackjack Battle** : terminée pour les invités ; sauvegarde des statistiques écrite mais non vérifiée.
- **Phase 5 — Console et transitions** : terminée (branche `phase-5-console`).
- Prochaine : **phase 6** (profils, éditeur d'avatar, amis, présence, XP, succès, classements). Elle exige Supabase, donc Docker démarré.

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

Vérifications exécutées le 2026-11-12 :

- `npm test` : 25 tests réussis. Blackjack : règles pures (as, naturel, croupier, résolution) et une partie complète côté serveur
  avec paquet truqué (conditions de lancement, annulations, entrée refusée en cours de partie, carte cachée absente de l'état,
  action hors tour refusée, chrono, manche automatique, départ de l'hôte pendant son tour, résultats, retour au lobby).
- `npm run test:e2e` : deux parcours Playwright réussis (Chromium). Blackjack à deux joueurs : recherche publique avec un salon listé,
  lancement bloqué puis permis, annulation, séquence de console regardée par un joueur et passée par l'autre, réglage du son, deux manches, chat en jeu, résultats, retour au lobby. Lobby avec 4 joueurs : dos de cartouche, Échap, création privée, code inconnu refusé,
  jointure par code, salon privé absent de la recherche, règles au dos de la mini cartouche, annonce reçue, proposition, votes et validation,
  déplacement au clavier vu par l'autre joueur, chat filtré, blocage et déblocage, signalement, lien de partage, rechargement sans doublon,
  départ de l'hôte et transfert du rôle.
- `npm run typecheck` et `npm run build` : sans erreur.
- Rendu contrôlé sur captures d'écran Playwright (grille, dos de cartouche, règles, propositions, salle 3D, table de blackjack,
  fin de manche, résultats, console avec cartouche insérée).

## Écrit mais non vérifié

- **Comptes Supabase** (e-mail, Google, Discord) : formulaire web, vérification du jeton côté serveur et migration `profiles`.
  Docker était arrêté : ni la migration SQL ni la connexion par compte n'ont été exécutées.
  Pour vérifier : démarrer Docker Desktop, `npm run db:start`, remplir les fichiers `.env` (voir README), tester inscription et connexion.
- **Sauvegarde des statistiques** : migration `match_results` et appel `record_match` écrits, jamais exécutés (Docker arrêté).
  Elle ne concerne que les comptes ; avec des invités, rien n'est enregistré.
- Effets sonores : le code s'exécute sans erreur, mais aucun son n'a été écouté (navigateur de test sans sortie audio).
- Séquence de lancement quand le jeu charge lentement (état « Chargement du jeu… ») : en local le jeu est prêt avant la fin de l'animation.
- Commandes de jeu au clavier (T, R) : branchées, mais le parcours automatisé clique sur les boutons.
- Blackjack à plus de 2 joueurs dans le navigateur : la logique serveur est générique, l'affichage à 6 n'a pas été vu.
- Transfert d'hôte après 10 s de déconnexion : seul le départ volontaire est testé.
- Fluidité des animations (cartouches, marche, emotes) : seules des images fixes ont été contrôlées, pas le mouvement ni la fréquence d'images.
- Animations d'emote : le message réseau est testé, le rendu de l'animation n'a pas été observé.
- Manette : code écrit (Gamepad API), aucune manette disponible pour l'essayer.
- Prédiction locale sous latence réelle : testée seulement en local, sans latence.

## Limitations connues

- Kart Rush et Party Worlds marqués « bientôt » : leur salon existe, le lancement y est refusé.
- Pas de musique (seulement des effets) : le réglage de volume musique viendra avec elle.
- La console n'apparaît qu'au lancement ; pas d'animation de retour vers le lobby en fin de session.
- Écran de résultats sans XP ni jetons (phases 6 et 7).
- Blackjack : pas d'effets sonores propres au jeu ; la carte du croupier n'a pas d'animation de retournement.
- Filtre de chat : liste de mots courte, à remplacer avant ouverture publique. Signalements seulement journalisés, sans outil de modération.
  Blocage stocké dans le navigateur, pas dans le compte.
- Pas de collisions entre avatars ni avec le décor. Avatars sans éditeur : apparence dérivée de l'identité.
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

1. Démarrer Docker Desktop pour activer et vérifier les comptes en local (ou décider d'utiliser un projet Supabase hébergé).
2. Identifiants OAuth Google et Discord.

## Prochaines étapes (phase 6)

Préalable : Docker démarré, `npm run db:start`, fichiers `.env` remplis ; vérifier d'abord les migrations et la connexion par compte
écrites en phases 1 et 4, jamais exécutées.

1. Migrations : `avatar_configurations`, `friendships`, `friend_requests`, `user_privacy_settings`, `progression`, `achievements`, `user_achievements`.
2. Éditeur d'avatar (visage, coiffure, yeux, couleurs, tenue) avec aperçu 3D ; `lookFromId` devient le repli des invités.
3. Page de profil, recherche et demandes d'amis, présence avec réglages de confidentialité.
4. XP et niveaux attribués côté serveur dans `record_match`, succès, classements mondial et entre amis.

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
| Design system | `apps/web/src/app/globals.css`, `apps/web/src/components/ui.tsx` |
| Test de parcours | `tests/e2e/lobby.spec.ts` |

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
- Le volet navigateur de l'application Claude ne compose pas d'images quand il est masqué : passer par les captures Playwright.
