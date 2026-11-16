/**
 * Garde une valeur unique malgré le rechargement à chaud (développement) : le module qui la crée est réexécuté à chaque
 * modification, mais les écouteurs déjà posés (touche Échap, effets de chargement) pointent vers l'ancienne instance.
 * Sans ça, après une modification du code, les magasins repartent à vide (jetons « … ») et Échap n'agit plus sur l'interface.
 * Sans effet en production (le module n'est exécuté qu'une fois).
 */
export function keepAcrossReloads<T>(key: string, make: () => T): T {
  const store = globalThis as unknown as Record<string, unknown>;
  return (store[key] ??= make()) as T;
}
