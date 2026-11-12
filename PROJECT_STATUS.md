# État du projet StepUp

Dernière mise à jour : 2026-11-12. À lire en premier pour reprendre le développement.
Cahier des charges : prompt maître du porteur de projet (23 sections). Architecture : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Phase en cours

**Phase 1 — Fondations : terminée côté invité, comptes Supabase écrits mais non vérifiés.**
Prochaine : phase 2 (accueil et cartouches 3D).

## Ce qui fonctionne réellement (vérifié)

- Monorepo npm workspaces : `apps/web`, `apps/game-server`, `packages/shared`.
- Serveur Colyseus : salon `lobby` autoritaire. Authentification obligatoire, création publique ou privée, code unique à 6 caractères,
  jointure par code, liste des salons publics par jeu, statut « prêt », chat limité en débit, réglages et capacité réservés à l'hôte
  et validés par le schéma du jeu, transfert d'hôte, siège conservé 60 s, refus des doublons d'identité.
- Web : connexion invité, accueil (cartes de jeux provisoires, pas encore les cartouches 3D), création de salon, jointure par code,
  liste et jointure des salons publics, page de lobby en temps réel (joueurs, prêt, règles générées, chat, annonces).
- Design system : jetons de couleurs, typographies, relief « autocollant », focus visibles, respect de `prefers-reduced-motion`.

Vérifications exécutées le 2026-11-12 :

- `npm test` : 14 tests réussis (contrats partagés, jetons invités, limiteur, salon complet à deux clients, reconnexion).
- `npm run typecheck` et `npm run build` : sans erreur.
- Navigateur : invité « Alice » crée un salon Kart Rush ; un second client « Bob » (script SDK) rejoint, passe prêt et écrit ;
  Alice voit tout en direct, change le nombre de tours, recharge la page et retrouve son siège sans doublon.

## Écrit mais non vérifié

- **Comptes Supabase** (e-mail, Google, Discord) : formulaire web, vérification du jeton côté serveur et migration `profiles`.
  Docker était arrêté, donc Supabase local n'a pas pu démarrer : ni la migration SQL ni la connexion par compte n'ont été exécutées.
  Pour vérifier : démarrer Docker Desktop, `npm run db:start`, remplir les fichiers `.env` (voir README), tester inscription et connexion.
- Transfert d'hôte après 10 s de déconnexion : le cas « départ volontaire » est testé, l'expiration du délai de grâce ne l'est pas.

## Limitations connues

- Les trois jeux sont marqués « bientôt » : seul le salon existe. Pas de lancement de partie (phase 4).
- Lobby en 2D : pas de salle 3D, d'avatars, de déplacements, d'emotes, de propositions ni de votes (phase 3).
- Chat sans filtrage de contenu, blocage ni signalement (phase 3).
- Limiteurs de débit en mémoire, un seul processus serveur (Redis seulement si besoin réel).
- Pas de tests Playwright, pas d'audio, pas de manette.
- Tester à deux exige deux navigateurs distincts : deux onglets partagent la même identité invitée.

## Hypothèses prises (à confirmer par le porteur)

- Blackjack : 6 joueurs maximum.
- Rôle d'hôte : transfert si l'hôte part ou reste déconnecté plus de 10 s ; l'ancien hôte ne le récupère pas.
- Jeton invité valable 24 h ; progression des invités non conservée.
- Revenir à l'accueil quitte le salon en cours.

## En attente du porteur

1. Démarrer Docker Desktop pour activer et vérifier les comptes en local (ou décider d'utiliser un projet Supabase hébergé).
2. Identifiants OAuth Google et Discord (à créer chez chaque fournisseur).

## Prochaines étapes (phase 2)

1. Ajouter `three`, `@react-three/fiber`, `@react-three/drei`, `motion`.
2. `packages/cartridge` : géométrie originale de cartouche, étiquette par jeu, survol, sélection.
3. Accueil : grille 3D, retournement, trois actions au dos (chercher, code, créer) branchées sur `apps/web/src/lib/lobby.ts`.
4. Machine à états de navigation (accueil, cartouche sélectionnée, connexion, lobby) et lien de partage.
5. Premier test de parcours Playwright : créer et rejoindre un salon.

## Repères dans le code

| Sujet | Fichier |
| --- | --- |
| Nom du produit, constantes | `packages/shared/src/config.ts` |
| Catalogue des jeux et réglages | `packages/shared/src/games.ts` |
| Protocole réseau | `packages/shared/src/protocol.ts` |
| Salon de lobby | `apps/game-server/src/rooms/LobbyRoom.ts` |
| Routes HTTP du serveur | `apps/game-server/src/app.ts` |
| Jetons et vérification | `apps/game-server/src/auth.ts` |
| Connexion lobby côté client | `apps/web/src/lib/lobby.ts` |
| Session (invité, Supabase) | `apps/web/src/lib/session.ts` |
| Design system | `apps/web/src/app/globals.css`, `apps/web/src/components/ui.tsx` |

## Notes techniques utiles

- Colyseus 0.18 : `defineServer`/`defineRoom`, schémas via `schema()` et `t` (pas de décorateurs), `onDrop`/`onReconnect`/`onLeave`.
  Un départ avec le code 4000 est « consenti » : pas de siège réservé.
- Un salon plein est verrouillé : la jointure renvoie « is locked » (traduit en « Salon complet » côté client).
- `@colyseus/sdk` reconnecte automatiquement après une coupure ; le jeton en sessionStorage couvre le rechargement de page.
