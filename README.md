# StepUp

Plateforme web de mini-jeux multijoueurs (nom provisoire, centralisé dans `packages/shared/src/config.ts`).

- État d'avancement et reprise du développement : [PROJECT_STATUS.md](PROJECT_STATUS.md)
- Architecture, protocole réseau, base de données, phases : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Prérequis

- Node.js 22 ou plus (développé avec Node 24), npm 11.
- Docker Desktop **uniquement** pour les comptes (Supabase local). L'accès invité fonctionne sans.

## Démarrage

```bash
npm install
npm run dev
```

- Web : http://localhost:3000
- Serveur de jeu (Colyseus) : http://localhost:2567 (`/health` pour vérifier)

Sans configuration, la plateforme tourne en mode invité : pseudo, cartouches 3D, création de salon, jointure par code, chat, réglages.

## Comptes (Supabase)

1. Démarrer Docker Desktop.
2. `npm run db:start` : lance Supabase en local et applique les migrations de `supabase/migrations`.
3. Copier l'URL de l'API et la clé `anon` affichées dans :
   - `apps/web/.env.local` (modèle : `apps/web/.env.example`)
   - `apps/game-server/.env.local` (modèle : `apps/game-server/.env.example`)
4. Relancer `npm run dev`.

Google et Discord : créer les identifiants OAuth chez chaque fournisseur, les placer dans `supabase/.env`
(`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`, `..._GOOGLE_SECRET`, `..._DISCORD_CLIENT_ID`, `..._DISCORD_SECRET`),
puis passer `enabled = true` dans les sections `[auth.external.google]` et `[auth.external.discord]` de `supabase/config.toml`.

## Commandes

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Serveur de jeu et web en parallèle |
| `npm test` | Tests Vitest (unitaires et intégration du serveur de jeu) |
| `npm run test:e2e` | Parcours Playwright (avant la première fois : `npx playwright install chromium`) |
| `npm run typecheck` | Vérification TypeScript de tous les paquets |
| `npm run build` | Build de production du web |
| `npm run db:start` / `npm run db:reset` | Supabase local / réapplication des migrations |

## Tester à plusieurs

Deux onglets du même navigateur partagent la même identité invitée (le serveur refuse le doublon dans un salon).
Pour un second joueur, utiliser une fenêtre de navigation privée ou un autre navigateur.
