# État du projet StepUp

Dernière mise à jour : 2026-11-12. À lire en premier pour reprendre le développement.
Cahier des charges : prompt maître du porteur de projet (23 sections). Architecture : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Phase en cours

- **Phase 1 — Fondations** : terminée côté invité ; comptes Supabase écrits mais non vérifiés.
- **Phase 2 — Accueil et cartouches** : terminée (branche `phase-2-cartouches`). Sons de cartouche non faits.
- Prochaine : **phase 3** (lobbies sociaux 3D).

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

Vérifications exécutées le 2026-11-12 :

- `npm test` : 14 tests réussis.
- `npm run test:e2e` : parcours Playwright réussi (Chromium) avec 4 joueurs : dos de cartouche, Échap, création privée, code inconnu refusé,
  jointure par code, salon privé absent de la recherche, règles au dos de la mini cartouche, annonce reçue, lien de partage,
  rechargement sans doublon, départ de l'hôte et transfert du rôle.
- `npm run typecheck` et `npm run build` : sans erreur.
- Rendu contrôlé sur captures d'écran Playwright (grille, dos de cartouche, lobby, règles).

## Écrit mais non vérifié

- **Comptes Supabase** (e-mail, Google, Discord) : formulaire web, vérification du jeton côté serveur et migration `profiles`.
  Docker était arrêté : ni la migration SQL ni la connexion par compte n'ont été exécutées.
  Pour vérifier : démarrer Docker Desktop, `npm run db:start`, remplir les fichiers `.env` (voir README), tester inscription et connexion.
- Transfert d'hôte après 10 s de déconnexion : seul le départ volontaire est testé.
- Fluidité des animations de cartouche : seules les images de fin ont été contrôlées (captures), pas le mouvement ni la fréquence d'images.
- Recherche publique avec des salons listés : le serveur est testé, l'interface n'a été vue qu'avec une liste vide.

## Limitations connues

- Les trois jeux sont marqués « bientôt » : seul le salon existe. Pas de lancement de partie (phase 4).
- Lobby encore en 2D : pas de salle 3D, d'avatars, de déplacements, d'emotes, de propositions ni de votes (phase 3).
- Chat sans filtrage de contenu, blocage ni signalement (phase 3).
- Aucun son (les sons mécaniques de cartouche restent à faire), pas de manette, pas de réglage de qualité graphique.
- La scène 3D rend en continu (pas de rendu à la demande) : à mesurer et optimiser en phase 10.
- Limiteurs de débit en mémoire, un seul processus serveur.
- Tester à deux exige deux navigateurs distincts : deux onglets partagent la même identité invitée.

## Hypothèses prises (à confirmer par le porteur)

- Blackjack : 6 joueurs maximum.
- Rôle d'hôte : transfert si l'hôte part ou reste déconnecté plus de 10 s ; l'ancien hôte ne le récupère pas.
- Jeton invité valable 24 h ; progression des invités non conservée.
- Revenir à l'accueil (bouton Quitter ou retour du navigateur) quitte le salon.
- Rejoindre par code depuis la cartouche d'un autre jeu est accepté : la cartouche affichée devient celle du jeu du salon.
- Motion n'est pas installé : les transitions DOM actuelles tiennent en CSS. À ajouter quand une transition le demandera.
- Drei n'est pas installé : aucun de ses composants n'est utilisé pour l'instant.

## En attente du porteur

1. Démarrer Docker Desktop pour activer et vérifier les comptes en local (ou décider d'utiliser un projet Supabase hébergé).
2. Identifiants OAuth Google et Discord.

## Prochaines étapes (phase 3)

1. Salle 3D du lobby dans la scène existante, avatar chibi réutilisable (`packages/avatar`).
2. Déplacements synchronisés (entrées clavier et manette, interpolation), emotes.
3. Propositions de règles, votes, décision de l'hôte, anti-spam.
4. Lancement : majorité de prêts, compte à rebours de 5 s, gestion des non prêts.
5. Modération du chat : filtrage, blocage, signalement.

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
- Le volet navigateur de l'application Claude ne compose pas d'images quand il est masqué : passer par les captures Playwright.
