import type { BrowserContext } from "@playwright/test";

/**
 * Bloque les modèles 3D KayKit : les joueurs s'affichent sans personnage (ombre et nom seulement). Les parcours de jeu (salon, Blackjack) testent la logique
 * et la synchronisation, pas le rendu : charger et animer des personnages en rendu logiciel les ralentit au point de faire
 * expirer les fenêtres de temps. Le rendu des personnages est couvert par avatarAssembly.spec.ts et avatarAnim.spec.ts.
 */
export async function noAvatarModels(context: BrowserContext) {
  await context.route("**/models/kaykit/**", (route) => route.abort());
}
