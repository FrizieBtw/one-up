# Architecture StepUp

## Vue d'ensemble

```
Navigateur (Next.js, React, Tailwind)
   │  HTTP : /auth/guest, /rooms          WebSocket : salons Colyseus
   ▼                                       ▼
Serveur de jeu (Node, Colyseus) ── autorité sur salons, règles, résultats
   │  vérifie les jetons, lira/écrira la progression (phases 6-7)
   ▼
Supabase (Auth + PostgreSQL + Storage) ── données persistantes uniquement
```

- **Le serveur de jeu fait autorité.** Le client envoie des intentions ; le serveur valide chaque message (zod) et diffuse l'état.
- **État éphémère** (salons, positions, chat) : mémoire du serveur Colyseus. **État persistant** (profils, plus tard jetons, XP, stats) : PostgreSQL.
- **Contrats partagés** dans `packages/shared`, consommés en TypeScript source par le web et le serveur (pas d'étape de build).

## Arborescence

```
apps/
  web/                 Next.js 16 (App Router). src/app, src/components, src/lib
  game-server/         Colyseus 0.18. src/app.ts (serveur + routes HTTP), src/rooms, src/auth.ts
packages/
  shared/              config, catalogue des jeux, schémas de réglages, protocole, codes de salon
supabase/
  config.toml          Supabase local
  migrations/          migrations SQL versionnées
docs/
```

Paquets prévus, créés quand leur phase commence (pas de coquilles vides) :
`packages/avatar` (phase 3), `packages/games/{blackjack,kart,party}` (phases 4, 8, 9),
`packages/game-core` (phase 4, récompenses et cycle de partie), `assets/` (phase 2).

Écarts assumés par rapport au cahier des charges :

| Prévu | Retenu | Raison |
| --- | --- | --- |
| `database/migrations` | `supabase/migrations` | emplacement imposé par la CLI Supabase |
| `packages/ui` | `apps/web/src/components/ui.tsx` | un seul consommateur ; à extraire si un second apparaît |
| pnpm | npm workspaces | pnpm est cassé sur la machine de développement |
| `packages/cartridge` | `apps/web/src/cartridge` | un seul consommateur |
| Motion, Drei | non installés | rien ne les utilise encore ; transitions DOM en CSS |

## Navigation et scène 3D

États (`apps/web/src/lib/nav.ts`) : `home` → `cartridge` (dos visible, panneau `menu`, `search`, `code` ou `create`) → `lobby` (avec `settingsOpen`).
Les routes `/` et `/lobby/[code]` rendent la même coquille ; l'URL suit l'état via `history.pushState` et `popstate`.
La transition vers le lobby ne démarre qu'après une connexion réussie au salon : pas d'animation sur un refus du serveur.

Un seul canvas plein écran, non interactif, contient toutes les cartouches. Chacune s'aligne à chaque image sur une ancre DOM
(cellule de grille, centre de l'écran, coin supérieur droit) : le DOM garde la mise en page, le clavier et le défilement.
Le dos de cartouche est un panneau DOM (`role="dialog"`) calé sur la plaque claire du modèle 3D.

## Salle de lobby 3D

- Second canvas plein écran sous l'interface (`apps/web/src/lobby3d/LobbyRoom3D.tsx`) ; le canvas des cartouches reste au-dessus.
- Déplacement : le client envoie une direction, le serveur simule à 20 Hz avec `stepLobbyPosition` (`packages/shared/src/movement.ts`).
  Le joueur local est prédit avec la même fonction puis rappelé doucement vers la position serveur ; les autres sont interpolés.
- Les positions sont lues à chaque image dans l'état Colyseus, sans rendu React (l'interface ignore `x`, `z`, `dx`, `dz`).
- Avatar chibi procédural unique (`apps/web/src/avatar/Avatar.tsx`) : apparence dérivée de l'identité en attendant l'éditeur (phase 6),
  animations repos, marche, salut, danse, bravo, rire.
- Entrées (`apps/web/src/lib/input.ts`) : actions abstraites lues au clavier (codes physiques, donc ZQSD et WASD) ou à la manette (Gamepad API).

## Authentification

| Mode | Jeton | Vérification côté serveur de jeu |
| --- | --- | --- |
| Invité | `POST /auth/guest {name}` renvoie `<payload>.<HMAC-SHA256>`, valable 24 h | `verifyGuestToken` (secret `GUEST_TOKEN_SECRET`) |
| Compte | jeton d'accès Supabase (e-mail, Google, Discord) | `supabase.auth.getUser` puis lecture du pseudo dans `profiles` |

Le client place le jeton dans `client.auth.token` ; `LobbyRoom.onAuth` refuse toute connexion sans identité valide.
Une identité occupe un seul siège par salon.

## Protocole réseau (salon `lobby`)

Définitions : `packages/shared/src/protocol.ts`.

HTTP :

| Route | Rôle |
| --- | --- |
| `GET /health` | état du serveur |
| `POST /auth/guest` | jeton invité (limité à 10/min par IP) |
| `GET /rooms?game=<id>` | salons publics d'un jeu (`PublicRoomInfo[]`) |

Création : `client.create("lobby", { gameId, isPublic })`. Le code du salon (6 caractères) est l'identifiant de salle : jointure par `client.joinById(code)`.

Client vers serveur :

| Message | Charge utile | Règle serveur |
| --- | --- | --- |
| `ready` | `{ ready }` | tout joueur |
| `chat` | `{ text }` 1 à 200 caractères | 5 messages / 10 s par joueur |
| `setSetting` | `{ key, value }` | hôte seul, validé par le schéma du jeu |
| `setCapacity` | `{ capacity }` | hôte seul, entre max(min du jeu, joueurs présents) et max du jeu |
| `move` | `{ x, z }` direction | normalisée ; le serveur simule la position (vitesse et limites de salle) |
| `emote` | `{ id }` parmi `EMOTES` | 2 par 3 s, rediffusée à tous |
| `propose` | `{ key, value }` (`capacity` ou réglage du jeu) | validée par le schéma ; 1 par 10 s et par joueur, 5 ouvertes au plus |
| `vote` | `{ id, approve }` | un vote par identité, modifiable ; n'applique rien |
| `resolveProposal` | `{ id, accept }` | hôte seul ; la valeur est revalidée avant application |
| `report` | `{ sessionId, reason? }` | 3 par minute ; journalisé côté serveur |

Un message qui ne respecte pas son schéma zod déconnecte le client (comportement de Colyseus) : le client officiel n'en envoie jamais.

Serveur vers client : `chat` (texte filtré), `emote`, `notice` (`settingChanged`, `capacityChanged`, `hostChanged`, `proposalCreated`, `proposalResolved`), `error` (`RATE_LIMITED`, `INVALID`, `FORBIDDEN`).

État synchronisé (`LobbySnapshot`) : `code`, `gameId`, `isPublic`, `hostSessionId`, `capacity`, `phase`, `settings` (JSON), `players` (avec position `x`, `z` et direction `dx`, `dz`), `proposals`.

Règles de salon :

- Changer une règle ne réinitialise pas les statuts « prêt ».
- Déconnexion : siège conservé 60 s (`RECONNECT_WINDOW_SECONDS`). Le client reprend son siège après un rechargement grâce au jeton de reconnexion (sessionStorage).
- Hôte : s'il part, ou reste déconnecté plus de 10 s (`HOST_GRACE_SECONDS`), le rôle passe au joueur connecté le plus ancien. Un hôte revenu après transfert ne récupère pas le rôle.

## Paramètres de jeux

Déclarés dans `packages/shared/src/games.ts` (`GAMES`). Chaque réglage est un `SettingDef` (`select`, `int`, `bool`).
L'interface du lobby est générée à partir de ces schémas et le serveur valide avec `isValidSetting`. Ajouter un jeu = ajouter une entrée au catalogue.

| Jeu | Joueurs | Réglages |
| --- | --- | --- |
| Blackjack Battle | 1 à 6 | temps de décision 10/20/30/60 s |
| Kart Rush | 1 à 8 | tours 1 à 10, collisions, bots 0 à 7, sélection du circuit (direct, vote, aléatoire) |
| Party Worlds | 2 à 8 | mode (plateau, mini-jeux), tours 5 à 30 |

Hypothèse à confirmer : capacité maximale du blackjack fixée à 6.

## Base de données

Migration actuelle : `profiles` (pseudo unique insensible à la casse, `public_id` court pour la recherche d'amis),
créé automatiquement à l'inscription par le déclencheur `handle_new_user`. RLS : lecture publique (aucun e-mail), mise à jour du seul pseudo par son propriétaire.

Tables à venir, chacune dans la migration de sa phase :

- Phase 4 : `game_sessions`, `session_participants`, `match_results`, `player_stats`
- Phase 6 : `avatar_configurations`, `friendships`, `friend_requests`, `user_privacy_settings`, `progression`, `achievements`, `user_achievements`
- Phase 7 : `wallets`, `wallet_transactions`, `shop_items`, `user_inventory`, `missions`, `mission_progress`

## Phases et dépendances

```
1 Fondations ──► 2 Cartouches ──► 3 Lobbies 3D ──► 4 Blackjack ──► 5 Console
                                        │               │
                                        │               ├──► 6 Profils/progression ──► 7 Économie
                                        │               └──► 8 Kart Rush
                                        │               └──► 9 Party Worlds
                                        └─────────────────────────────────────────► 10 Stabilisation
```

- 4 fixe le cycle de partie (lancement, résultats, récompenses idempotentes) que 8 et 9 réutilisent.
- 6 et 7 dépendent des résultats de partie produits par 4.
- 8 et 9 sont indépendants entre eux.

## Principales difficultés techniques

1. **Kart Rush en réseau** : simulation autoritaire à pas fixe, prédiction locale et réconciliation ; la physique doit être déterministe et partagée client/serveur.
2. **Continuité cartouche → lobby → console** : une seule scène 3D persistante entre les états, pilotée par une machine à états alignée sur l'état serveur.
3. **Récompenses idempotentes** : une transaction SQL par résultat de partie, clé d'idempotence = identifiant de session de jeu.
4. **Avatar unique réutilisable** : un seul composant paramétré, animations partagées, coût de rendu maîtrisé à 8 joueurs.
5. **Modération pour public jeune** : filtrage, blocage, signalement dès le chat de la phase 3.

## Procédures de test

- `npm test` : unitaires (`packages/shared`) et intégration du serveur (`apps/game-server/src/server.test.ts`, vrais clients Colyseus contre un vrai serveur).
- Manuel : `npm run dev`, deux navigateurs distincts, créer un salon, rejoindre par code, vérifier chat, « prêt », réglages, rechargement de page.
- `npm run test:e2e` : parcours Playwright multi-joueurs (`tests/e2e/lobby.spec.ts`). Lance les serveurs ou réutilise ceux de `npm run dev`.
  Première fois : `npx playwright install chromium`. Captures dans `test-results/`.
