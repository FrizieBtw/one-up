# État du projet StepUp

Dernière mise à jour : 2026-11-12. À lire en premier pour reprendre le développement.
Cahier des charges : prompt maître du porteur de projet (23 sections). Architecture : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Phase en cours

- **Phase 1 — Fondations** : terminée côté invité ; comptes Supabase écrits mais non vérifiés.
- **Phase 2 — Accueil et cartouches** : terminée. Sons de cartouche non faits.
- **Phase 3 — Lobbies sociaux** : terminée (branche `phase-3-lobby`), sauf le lancement de partie, reporté à la phase 4 faute de jeu à lancer.
- Prochaine : **phase 4** (Blackjack Battle de bout en bout, avec lancement et compte à rebours).

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
- Modération de premier niveau : filtre de mots côté serveur, blocage local d'un joueur (messages masqués), signalement journalisé.

Vérifications exécutées le 2026-11-12 :

- `npm test` : 19 tests réussis (dont déplacement serveur borné en vitesse et en espace, emotes, propositions, votes, filtre,
  exclusion d'un client hors schéma).
- `npm run test:e2e` : parcours Playwright réussi (Chromium) avec 4 joueurs : dos de cartouche, Échap, création privée, code inconnu refusé,
  jointure par code, salon privé absent de la recherche, règles au dos de la mini cartouche, annonce reçue, proposition, votes et validation,
  déplacement au clavier vu par l'autre joueur, chat filtré, blocage et déblocage, signalement, lien de partage, rechargement sans doublon,
  départ de l'hôte et transfert du rôle.
- `npm run typecheck` et `npm run build` : sans erreur.
- Rendu contrôlé sur captures d'écran Playwright (grille, dos de cartouche, règles, propositions, salle 3D avec avatars).

## Écrit mais non vérifié

- **Comptes Supabase** (e-mail, Google, Discord) : formulaire web, vérification du jeton côté serveur et migration `profiles`.
  Docker était arrêté : ni la migration SQL ni la connexion par compte n'ont été exécutées.
  Pour vérifier : démarrer Docker Desktop, `npm run db:start`, remplir les fichiers `.env` (voir README), tester inscription et connexion.
- Transfert d'hôte après 10 s de déconnexion : seul le départ volontaire est testé.
- Fluidité des animations (cartouches, marche, emotes) : seules des images fixes ont été contrôlées, pas le mouvement ni la fréquence d'images.
- Animations d'emote : le message réseau est testé, le rendu de l'animation n'a pas été observé.
- Manette : code écrit (Gamepad API), aucune manette disponible pour l'essayer.
- Prédiction locale sous latence réelle : testée seulement en local, sans latence.
- Recherche publique avec des salons listés : le serveur est testé, l'interface n'a été vue qu'avec une liste vide.

## Limitations connues

- Les trois jeux sont marqués « bientôt » : seul le salon existe. Pas de lancement de partie (phase 4).
- Pas de lancement de partie ni de compte à rebours (phase 4).
- Filtre de chat : liste de mots courte, à remplacer avant ouverture publique. Signalements seulement journalisés, sans outil de modération.
  Blocage stocké dans le navigateur, pas dans le compte.
- Pas de collisions entre avatars ni avec le décor. Avatars sans éditeur : apparence dérivée de l'identité.
- Une seule salle de lobby, commune à tous les jeux (les salles thématiques restent possibles : le décor est un composant isolé).
- Pas de chat en jeu (aucun jeu encore).
- Aucun son, pas de réglage de qualité graphique.
- Deux canvas WebGL rendent en continu dans le lobby : à mesurer et optimiser en phase 10.
- Limiteurs de débit en mémoire, un seul processus serveur.
- Tester à deux exige deux navigateurs distincts : deux onglets partagent la même identité invitée.

## Hypothèses prises (à confirmer par le porteur)

- Blackjack : 6 joueurs maximum.
- Rôle d'hôte : transfert si l'hôte part ou reste déconnecté plus de 10 s ; l'ancien hôte ne le récupère pas.
- Jeton invité valable 24 h ; progression des invités non conservée.
- Revenir à l'accueil (bouton Quitter ou retour du navigateur) quitte le salon.
- Un joueur déconnecté reste visible, estompé, pendant sa fenêtre de reconnexion.
- Le lancement de partie (5.5) est traité en phase 4, avec le premier jeu.
- Rejoindre par code depuis la cartouche d'un autre jeu est accepté : la cartouche affichée devient celle du jeu du salon.
- Motion n'est pas installé : les transitions DOM actuelles tiennent en CSS. À ajouter quand une transition le demandera.
- Drei n'est pas installé : aucun de ses composants n'est utilisé pour l'instant.

## En attente du porteur

1. Démarrer Docker Desktop pour activer et vérifier les comptes en local (ou décider d'utiliser un projet Supabase hébergé).
2. Identifiants OAuth Google et Discord.

## Prochaines étapes (phase 4)

1. Lancement : minimum de joueurs, majorité de prêts, compte à rebours de 5 s, gestion des non prêts, annulation propre.
2. `packages/games/blackjack` : règles pures et testées (distribution, as, croupier, résolution, score 3/1/0).
3. Salon de jeu autoritaire : tours séquentiels, temps de décision, repli sur déconnexion, arrêt par l'hôte entre deux manches.
4. Table 3D, cartes animées, avatars, tableau de score, écran de résultats.
5. Migrations `game_sessions`, `session_participants`, `match_results`, `player_stats` (exige Supabase démarré).

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
- En développement, `window.__lobbyRoom` expose la connexion du salon (utilisé par le test de parcours).
- Le volet navigateur de l'application Claude ne compose pas d'images quand il est masqué : passer par les captures Playwright.
