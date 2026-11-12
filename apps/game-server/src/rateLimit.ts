/** Fenêtre glissante en mémoire. Renvoie false quand la clé dépasse `max` appels sur `windowMs`. */
export function createRateLimiter(max: number, windowMs: number, now: () => number = Date.now) {
  // shortcut: les clés ne sont jamais purgées et l'état est local au processus ; passer à Redis au multi-processus.
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const t = now();
    const recent = (hits.get(key) ?? []).filter((at) => t - at < windowMs);
    const allowed = recent.length < max;
    if (allowed) recent.push(t);
    hits.set(key, recent);
    return allowed;
  };
}
