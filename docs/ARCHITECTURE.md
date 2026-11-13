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
  games/blackjack/     règles pures du blackjack
supabase/
  config.toml          Supabase local
  migrations/          migrations SQL versionnées
docs/
```

Paquets prévus, créés quand leur phase commence (pas de coquilles vides) :
`packages/games/{kart,party}` (phases 8, 9), `packages/game-core` (quand un second jeu partagera le cycle de partie).

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
- Avatar unique (`apps/web/src/avatar/Avatar.tsx`, personnage KayKit assemblé depuis le chantier graphique ; avatar procédural d'origine supprimé) : apparence dérivée de l'identité en attendant l'éditeur (phase 6),
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
| `POST /presence/ping` | un compte se signale en ligne (jeton `Authorization: Bearer`, comptes seulement) |
| `GET /presence` | présence des amis du compte, filtrée par leurs réglages |

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
| `start` / `cancelStart` | `{}` | hôte seul ; lance ou annule le compte à rebours |
| `backToLobby` | `{}` | hôte seul, depuis l'écran de résultats |
| `bjAction` | `{ action: "hit" \| "stand" }` | joueur dont c'est le tour |
| `bjNext` / `bjEnd` | `{}` | hôte seul, entre deux manches |

Un message qui ne respecte pas son schéma zod déconnecte le client (comportement de Colyseus) : le client officiel n'en envoie jamais.

Serveur vers client : `chat` (texte filtré), `emote`, `notice` (`settingChanged`, `capacityChanged`, `hostChanged`, `proposalCreated`, `proposalResolved`), `error` (`RATE_LIMITED`, `INVALID`, `FORBIDDEN`).

État synchronisé (`LobbySnapshot`) : `code`, `gameId`, `isPublic`, `hostSessionId`, `capacity`, `phase`, `settings` (JSON), `players` (avec position `x`, `z` et direction `dx`, `dz`), `proposals`.

Règles de salon :

- Changer une règle ne réinitialise pas les statuts « prêt ».
- Déconnexion : siège conservé 60 s (`RECONNECT_WINDOW_SECONDS`). Le client reprend son siège après un rechargement grâce au jeton de reconnexion (sessionStorage).
- Hôte : s'il part, ou reste déconnecté plus de 10 s (`HOST_GRACE_SECONDS`), le rôle passe au joueur connecté le plus ancien. Un hôte revenu après transfert ne récupère pas le rôle.

## Profils, avatars, amis et présence

- Vue `profile` de la coquille unique (`/profile`, comptes seulement) : profil (niveau, statistiques, succès), éditeur d'avatar avec aperçu 3D,
  amis, classements (mondial et entre amis, par XP), confidentialité. Données : `apps/web/src/lib/social.ts`, sous RLS.
- Avatar : options gratuites définies dans `packages/shared/src/avatar.ts` (teint, coiffure, couleur de cheveux, yeux, tenue) ; un seul composant `Avatar`
  sert profil, lobby et table de jeu. À la connexion d'un compte, le serveur lit l'avatar enregistré, le revalide (`parseAvatarConfig`) et le place
  dans l'état du joueur ; invités et comptes sans avatar reçoivent l'apparence par défaut dérivée de leur identité.
- L'invitation à personnaliser l'avatar est facultative : « Plus tard » la masque sur l'appareil.
- Présence (`apps/game-server/src/presence.ts`, en mémoire) : « en ligne » tant que le navigateur d'un compte envoie `POST /presence/ping` (toutes les 30 s,
  valable 75 s), « dans un lobby » ou « en partie » tant qu'il occupe un salon. `GET /presence` renvoie la présence des seuls amis, filtrée par leur réglage :
  masqué = « hors ligne », sans autre indice.
- Récompenses : à la fin d'une session, le serveur calcule le classement, appelle `record_match`, puis envoie à chaque compte le message `rewards`
  (XP gagnée, XP totale, succès débloqués), affiché sur l'écran de résultats. Les invités n'ont ni progression ni récompenses.

## Cycle de partie

Phases du salon (`LobbySnapshot.phase`) : `waiting` → `countdown` → `playing` → `results` → `waiting`.

- Lancement : `launchBlocker` (partagé client/serveur) exige le jeu disponible, le minimum de joueurs connectés et une majorité stricte de prêts.
  Compte à rebours de 5 s, annulable par l'hôte, annulé d'office si une condition tombe.
- À zéro, tous les joueurs connectés participent ; les déconnectés sont retirés du salon.
- Dès le compte à rebours : plus d'entrée dans le salon (`IN_PROGRESS`, pas de spectateurs) et règles verrouillées.
- La partie tourne dans le même salon Colyseus : un contrôleur par jeu (`apps/game-server/src/games/`) écrit dans un sous-état dédié (`state.blackjack`).
- Fin de session : phase `results`, enregistrement des résultats, puis retour au lobby par l'hôte (statuts « prêt » remis à zéro).

## Console et séquence de lancement

- La console fictive vit dans le canvas des cartouches (`CartridgeScene.tsx`) et s'aligne, comme elles, sur des ancres DOM.
- Déclenchement : uniquement quand le client observe la transition serveur `countdown` → `playing`. Un rechargement en cours de partie
  ne rejoue pas l'animation ; si la partie s'arrête pendant la séquence, elle est abandonnée.
- Étapes (`nav.launch`) : `approach` (la cartouche quitte le coin, la console monte) → `insert` (descente dans le port, son) → `loading`.
- Fin : seulement quand `nav.gameReady` est vrai, c'est-à-dire scène de jeu chargée et contexte WebGL créé. Le jeu se charge derrière la séquence.
- « Passer l'animation » saute à `loading` : on n'entre donc jamais avant que le serveur et la scène soient prêts.

## Audio

Effets synthétisés par Web Audio (`apps/web/src/lib/audio.ts`), sans fichier : sélection, retournement, insertion, prêt.
Le contexte audio est créé au premier son, donc après une interaction. Réglages mémorisés : muet et volume des effets.

## Blackjack Battle

Règles (pures et testées, `packages/games/blackjack`) :

- 52 cartes remélangées à chaque manche. Actions : tirer ou rester. Pas de doublement, de séparation ni d'assurance.
- As = 11 tant que la main ne dépasse pas 21, sinon 1. Atteindre 21 fait rester automatiquement.
- Blackjack naturel (21 en deux cartes) : le joueur ne joue pas ; il bat un 21 en trois cartes ou plus, égalité contre un naturel du croupier.
- Croupier : tire jusqu'à 17, reste sur tout 17 (souple compris). Ne tire pas si tous les joueurs ont dépassé 21.
- Un joueur qui dépasse 21 perd, même si le croupier dépasse aussi.
- Score : victoire 3, égalité 1, défaite 0. Aucune mise, aucun jeton engagé.

Déroulement (serveur autoritaire, `apps/game-server/src/games/blackjack.ts`) :

- Tours séquentiels dans l'ordre d'arrivée ; un seul joueur actif. Temps de décision relancé après chaque tirage.
- Temps écoulé ou joueur déconnecté : il reste automatiquement. Départ définitif : il quitte la table, le tour passe au suivant.
- La carte cachée du croupier n'est envoyée aux clients qu'à sa révélation.
- Entre deux manches, l'hôte enchaîne ou termine ; sans décision, la manche suivante démarre après 15 s.
- Classement : score décroissant, ex æquo au même rang.

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

Projet Supabase hébergé `OneUP` (région eu-west-3) ; les migrations de `supabase/migrations` y ont été appliquées avec leur contenu
(les versions affichées par Supabase portent leur propre horodatage). Accès aux données : le navigateur lit et écrit sous RLS avec le jeton
de l'utilisateur ; le serveur de jeu écrit avec la clé `service_role`. Les fonctions d'aide aux politiques vivent dans le schéma `private`,
non exposé par l'API.

| Migration | Contenu |
| --- | --- |
| `…000000_profiles` | `profiles` (pseudo unique insensible à la casse, `public_id` court), déclencheur d'inscription |
| `…000100_match_results` | `game_sessions`, `session_participants`, `player_stats`, première `record_match` |
| `…000200_revoke_handle_new_user` | retire l'exécution publique du déclencheur d'inscription |
| `…000300_social_progression` | avatars, confidentialité, amis, progression, succès, nouvelle `record_match` |
| `…000400_backfill_profiles` | crée le profil des comptes antérieurs au déclencheur |
| `20261113000000_economy` | réglages d'économie, portefeuilles, boutique, inventaire, missions ; `record_match` verse jetons et missions |

Règles d'accès :

- `avatar_configurations` : lecture publique ; chacun écrit seulement sa ligne (forme et taille bornées ; contenu revalidé par le serveur de jeu).
- `user_privacy_settings` : visible et modifiable par son propriétaire seul. Réglages : `presence`, `friend_requests`, `show_stats`.
- `friend_requests`, `friendships` : visibles des seules parties. Aucune écriture directe : les fonctions `send_friend_request`,
  `respond_friend_request`, `remove_friend` valident tout (demande croisée acceptée d'office, doublons, refus de réception,
  10 demandes par heure et 30 en attente au plus). Un expéditeur peut annuler sa propre demande.
- `search_profiles` : préfixe de pseudo ou identifiant court exact, jokers LIKE neutralisés, 10 résultats au plus, soi-même exclu.
- `progression` (XP), `achievements`, `user_achievements`, `player_stats`, `session_participants` : lecture seule pour les clients.
  Les statistiques, parties et succès suivent `show_stats` (tous, amis, personne) via `private.can_view_stats` ; le niveau et l'XP restent publics (classements).
- `record_match` : exécutable par `service_role` seul. Idempotente (l'identifiant de session sert de clé). Enregistre la session et les statistiques,
  attribue l'XP et débloque les succès, et renvoie les récompenses de chaque joueur.

Progression (`packages/shared/src/progression.ts`) : le niveau n s'atteint à 50·n·(n−1) XP cumulés.
XP par session : 20 de participation, 10 par manche gagnée, 5 par égalité, 25 si premier d'une session à 2 joueurs ou plus.
Succès : première table, premier coup gagnant, habitué (5 sessions), main chanceuse (25 manches gagnées), champion de table (3 sessions gagnées).

Pas de table `match_results` séparée : `session_participants` porte le résultat de chaque joueur.

## Économie : jetons, boutique, missions

Les jetons sont fictifs, liés aux comptes, et n'achètent que des cosmétiques. Aucun objet ne donne d'avantage en jeu, et aucune partie n'engage de jetons.

Base (`supabase/migrations/20261113000000_economy.sql`) :

- `economy_settings` (une ligne, lecture seule côté client) : solde initial (200), aide de reprise (sous 20 jetons, +100, une fois par 24 h),
  jetons de session (10 + 2 par manche gagnée, plafonnés à 150 par jour UTC et par joueur). Tout est modifiable en base sans toucher au code.
- `wallets` (solde, jamais négatif : contrainte `check`) et `wallet_transactions` (historique). La clé unique `(compte, nature, référence)` interdit
  d'enregistrer deux fois la même récompense, le même achat ou la même mission.
- Aucune écriture directe par les clients. Tout passe par des fonctions :
  - `purchase_item` : verrouille le portefeuille (les achats d'un compte sont sérialisés), refuse un objet déjà possédé ou un solde insuffisant ;
    renvoie `ok`, `not_found`, `already_owned`, `insufficient`.
  - `set_equipped` : équipe ou retire un objet possédé, un seul équipé par catégorie.
  - `claim_recovery` : `ok`, `not_eligible` (solde suffisant) ou `cooldown`. Indépendante de tout jeu.
  - `record_match` (serveur de jeu seul) : en plus de l'XP, verse les jetons de session et fait avancer les missions.
- Création du portefeuille : par le déclencheur d'inscription (sans jamais le bloquer) et, au besoin, par toute fonction qui y touche.
- Boutique : `shop_items` (catégories tenues, accessoires, emotes, cartouches, cadres de profil ; prix et charge utile). `user_inventory` : objets possédés et équipés.
- Missions : `missions` (quotidiennes, remises à zéro à minuit UTC ; défis uniques) et `mission_progress`. Mesures : sessions, manches gagnées,
  première place, session parfaite (toutes les manches gagnées, au moins 3). Récompense versée une seule fois par mission et par période.
  Elles ne progressent qu'à l'enregistrement d'une session par le serveur : le client ne peut pas déclarer une mission accomplie.
- Anti-abus : plafond quotidien de jetons de session, une session de zéro manche ne rapporte rien, récompenses idempotentes par session.

Cosmétiques en jeu :

- À la connexion d'un compte, le serveur lit ses objets (`fetchCosmetics`) : apparence équipée (tenue premium, casquette ou lunettes) copiée dans l'état du joueur
  (`Player.cosmetics`) et rendue par le composant `Avatar` pour tous ; emotes possédées gardées côté serveur seulement.
- Emotes de boutique (`spin`, `bow`) : le serveur refuse (`FORBIDDEN`) toute emote qu'un joueur ne possède pas ; les quatre gratuites restent ouvertes à tous.
- Fini de cartouche et cadre de profil : appliqués côté client à partir des objets équipés du compte (état partagé `useEconomy`, `apps/web/src/lib/economy.ts`).
- Interface (profil, comptes seulement) : Boutique (essayage sur l'aperçu 3D, achat en deux temps), Inventaire (équipement, historique, aide de reprise), Missions.
  Le solde s'affiche dans l'en-tête et se rafraîchit après chaque achat et chaque récompense de session.

## Éditeur de personnage KayKit (chantier graphique, en cours)

Décision du porteur : remplacer l'avatar procédural par des personnages KayKit (CC0), assemblés à partir de pièces. Étapes 1 à 4 faites.

Constats mesurés sur les assets (dossier source hors dépôt) :

- Tous les personnages humanoïdes KayKit partagent le même squelette de 23 os (noms et matrices inverses identiques) : têtes, corps, bras, jambes et accessoires de personnages différents s'emboîtent.
  Pièces standard : `Head`, `Body`, `ArmLeft`, `ArmRight`, `LegLeft`, `LegRight`, plus des accessoires rigides (`Hat`, `Glasses`, `Cape`, `Backpack`…) accrochés à un os.
- Cheveux, yeux et barbe sont fondus dans le maillage `Head` et sa texture. Chaque pièce y est pourtant une coque de géométrie distincte, colorée par une case de palette.
- Textures : palettes de 8 colonnes × 4 lignes de dégradés verticaux. Convention constante : case 0 = peau, case 1 = couleur des cheveux, case 2 = noir des yeux.
  L'axe vertical des UV glTF a son origine en haut (`ligne = floor(v × 4)`).
- Aucune animation de danse dans les assets. Les animations viennent de fichiers de rig séparés (`Rig_Medium_*`) : repos, marche, course, saut, salut, applaudissements, assis.

Étape 1 — découpe des têtes (`apps/web/src/avatar/parts/`) :

- `splitHead.ts` : fonction pure (sans three.js). Soude les sommets par position, relie les triangles voisins de même case de palette, puis attribue un rôle à chaque coque :
  peau, oreille, nez, œil, sourcil, cheveux, barbe. Repères : convention de palette, puis position (yeux sombres devant, barbe sous les yeux, sourcils au-dessus).
- `catalogue.ts` : 29 têtes décrites. 22 utilisables (9 bases de crâne complètes, 13 sources de coiffure et de barbe), 7 écartées avec leur raison (capuches, masque, cache-œil, créatures, maquillage).
  Chaque entrée peut porter des corrections de palette (`overrides`) ; aucune n'a été nécessaire avec la convention de palette.
- `readGlb.node.ts` : lecteur de GLB pour Node (tests et scripts seulement) ; `pngjs` décode la palette.
- Planche de contrôle `/dev/avatar-parts?page=N` (404 en production) : rôles en couleurs et version chauve de chaque tête.
- Fichiers copiés dans `apps/web/public/models/kaykit/` (31 personnages et 3 fichiers d'animations, 13,9 Mo), crédits CC0 dans `apps/web/public/models/CREDITS.md`.

Limites connues de l'étape 1 : certaines têtes ont un crâne ouvert sous les cheveux (donc inutilisables comme base chauve) ; les yeux sont tous des ovales noirs ;
le nez est fondu dans la coque de peau sur quelques têtes.

Étape 2 — corps, accessoires, recoloration (faite) :

- `palette.ts` : recoloration pure (sans three.js). Une palette est lue en dégradés (haut, milieu, bas) par case ; `recolorGradient` remplace la teinte en gardant l'écart de luminosité
  et de saturation de la case d'origine ; `renderPalette` reconstruit l'image 256 × 128 avec les cases remplacées (peau = case 0, cheveux = case 1). Les UV des pièces ne changent pas.
- `partsCatalogue.ts` : 22 tenues (haut = `Body` + bras, bas = jambes, pris dans le même personnage) et 24 accessoires (chapeaux, lunettes, masque, bandeaux, capes, sacs).
  Écartés : armes et objets (Cigar, HolyWater, WindupKey, Quiver). Les tests vérifient fichiers, maillages, type (habillé ou rigide) et os d'accroche sur les vrais GLB.
- `assemble.ts` (three.js, navigateur) : assemble tête + haut + bas + accessoires sur le squelette d'un fichier. Deux pièges mesurés :
  1. l'ordre des 23 os diffère selon les fichiers (les poids de peau désignent les os par rang) : chaque pièce reçoit son propre `Skeleton` (ordre et matrices inverses du fichier source)
     qui pointe vers les os du personnage assemblé ;
  2. un maillage glTF à plusieurs matériaux devient plusieurs maillages three (`Nom_1`, `Nom_2`), dont certains sans texture (verres) : il faut tous les prendre.
- Planche d'essai `/dev/avatar-assembly` (404 en production) : 8 assemblages de pièces de fichiers différents avec peau et cheveux recolorés, dans une seule scène (comme un salon) ;
  capture dans `test-results/avatar-assembly.png`. Rendre plusieurs scènes l'une après l'autre dans un même rendu avec scissor a produit des pièces invisibles : ne pas le reproduire.

Étape 3 — moteur d'animation et branchement (faite) :

- `animations.ts` : charge les 3 fichiers `Rig_Medium_*` ; clips utilisés : `Idle_A` (repos), `Walking_A` (marche), `Waving` (salut), `Cheering` (bravo). Appliqués aux os par leur nom.
- `KayKitAvatar.tsx` : `useAssembledModel` assemble le personnage (asynchrone, libère matériaux et palettes au démontage) ; `KayKitBody` joue les clips avec fondu de 0,2 s
  et complète les emotes sans clip par des rotations d'os (danse : hanches et bras ; rire : tête ; révérence : colonne ; toupie : rotation du groupe).
  Échelle 0,48 pour garder la taille de l'ancien avatar.
- `lookMapping.ts` : passerelle temporaire de l'ancienne configuration (couleurs, style de cheveux) vers une pièce : style de cheveux → tête, couleur de tenue → tenue (par empreinte), lunettes et casquette de boutique → accessoires.
- `Avatar.tsx` : `Avatar` garde les mêmes propriétés ; il affiche le personnage KayKit ; l'avatar procédural d'origine (sphères et capsules) est supprimé. Pendant le chargement du modèle, seuls ombre, nom et effets sont dessinés.
  Plus aucun élément dessiné à la main sur les personnages : le nœud papillon, la couronne et les effets (étincelles, bulles) ont été retirés du code et de la boutique. Seule l'ombre de contact (disque sous les pieds) reste.
- Planche `/dev/avatar-anim` (404 en production) : 8 états côte à côte, capture `test-results/avatar-anim.png`.

Étape 4 — éditeur, format v2, boutique (faite) :

- Format (`packages/shared/src/avatar.ts`, source unique pour éditeur, rendu et serveur) : v2 à l'origine de l'étape 4 (`skull, hair, beard, eyes…`), remplacé par la v3 plus bas.
  Peau et cheveux sont des couleurs (6 teints, 8 couleurs) ; le reste désigne le personnage KayKit dont on prend la pièce. `acc` : un accessoire au plus par emplacement
  (chapeau, lunettes, masque, bandeau, cape, sac). Le serveur de jeu revalide tout (`parseAvatarConfig`) ; les anciennes configurations v1 sont converties à la lecture
  (style de cheveux → tête, couleur de tenue → tenue), sans réécriture en base avant le prochain enregistrement.
- Tête recomposée (`assemble.ts`) : crâne (peau, oreilles, nez) du « visage », cheveux, barbe, yeux et sourcils pris sur d'autres têtes par `splitHead`,
  un maillage par tête source, chacun lié à son propre squelette. 22 visages, 19 coiffures, 8 barbes, 22 sources d'yeux.
- Éditeur (`AvatarEditor.tsx`) : teint, visage, coiffure, couleur, barbe, yeux, haut, bas, un choix par emplacement d'accessoire ; aperçu 3D en direct.
- Boutique : les tenues ne sont plus des couleurs mais des tenues complètes (`{"outfit": "Paladin" | "SpaceRanger" | "ToySoldier"}`), absentes de l'éditeur gratuit.
  Casquette et lunettes de boutique prennent la place du chapeau et des lunettes choisis (`SHOP_ACCESSORY_PIECES`). Nœud papillon, couronne et effets ont été supprimés (migration, même fichier).
- Migration `20261113100000_avatar_v2.sql` (appliquée sur le projet OneUP) : limite de taille de la configuration 400 → 1000 octets ; trois objets de boutique renommés avec leur nouvelle charge utile.
- Tests : accord entre listes partagées et catalogue web (pièces, emplacements, rôles réellement présents dans les têtes), conversion v1, taille maximale, parcours profil et cosmétiques.

Limites : les vêtements ne sont pas recolorables ; le choix de visage, coiffure, barbe et yeux se fait par listes de noms (pas de vignettes) ; certains visages ont des coiffures fusionnées avec des détails (ex. Lorekeeper).

Retour au visage entier (décision du porteur, après relecture visuelle) :

- La recomposition par pièces (crâne, coiffure, barbe, yeux, nez, oreilles, bouche greffée) laissait des vides gênants : dessus du crâne ouvert, bas du visage manquant sur les têtes à barbe,
  jonctions visibles. Le visage se choisit désormais en un seul bloc : la tête d'origine d'un personnage, avec sa coiffure et sa barbe. Le format passe en v3 :
  `{ v: 3, skin, hairColor, face, outfit, legs, acc[] }` (`acc` n'est pas proposé par l'éditeur pour le moment). Les v2 (visage recomposé) et v1 sont converties à la lecture
  (v2 : le visage de base `skull` est gardé, coiffure et barbe choisies séparément sont perdues). Taille d'un avatar < 400 octets, donc sous la limite de la base.
- `splitHead.ts` et `capHead.ts` (découpe des têtes, calotte du crâne, tests sur les 22 têtes) sont conservés tels quels mais `assemble.ts` ne les utilise plus : ils serviront si la recomposition revient.
- Éditeur (`AvatarEditor.tsx`) : grilles de vignettes à choix unique (`role="radiogroup"` / `radio`) pour le visage (22), le haut (19) et le bas (19), plus les teintes de peau et de cheveux.
  Vignettes statiques dans `apps/web/public/models/kaykit/thumbs/{faces,tops,bottoms}/` (192 px, 1,7 Mo), générées par la page `/dev/avatar-thumbs` :
  `UPDATE_THUMBS=1 npx playwright test avatarThumbs` les réécrit. Elles montrent l'élément d'origine (couleurs d'origine), pas la peau ou les cheveux choisis.

À venir : relecture visuelle de l'éditeur et des vignettes. Avant : étape 3 (moteur d'assemblage et animations, remplace `Avatar.tsx`),
étape 4 (éditeur, nouveau format de configuration avec validation serveur et migration, boutique adaptée).

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
