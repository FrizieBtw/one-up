// Comblement du dessus du crâne. Pure (sans three.js), testable dans Node.
//
// Sur toutes les têtes KayKit, la coque de peau s'arrête à la naissance des cheveux : le dessus du crâne est ouvert (les cheveux le
// recouvrent). Sans cheveux, ou avec une coiffure d'une autre tête, on verrait l'intérieur. On repère la boucle de bord qui entoure
// le dessus de la tête (la plus grande, centrée sur l'axe, à hauteur de front) et on la ferme par une calotte : des anneaux qui se
// resserrent vers un sommet, un peu au-dessus de la boucle.

export interface CapInput {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
  /** Numéros de triangles de la coque de peau (peau, oreilles, nez). */
  triangles: readonly number[];
}

export interface Cap {
  /** Nouveaux sommets (positions xyz). */
  positions: number[];
  /** Pour chaque nouveau sommet, l'indice d'un sommet d'origine dont copier les poids de peau (os). */
  source: number[];
  /** Normales des nouveaux sommets. */
  normals: number[];
  /** Triangles, avec des indices à partir de 0 dans les nouveaux sommets. */
  indices: number[];
  /** Boucle fermée (nombre de sommets) et hauteur du sommet de la calotte, pour les tests. */
  loopSize: number;
  apexY: number;
}

/** Clé de soudure : positions arrondies au millième, sans « -0.000 » (une valeur toute proche de zéro ne doit pas changer de clé selon son signe). */
const r3 = (v: number) => (Math.round(v * 1000) / 1000 + 0).toFixed(3);
const key = (p: ArrayLike<number>, i: number) => `${r3(p[3 * i]!)},${r3(p[3 * i + 1]!)},${r3(p[3 * i + 2]!)}`;

/** Boucles de bord (arêtes utilisées une seule fois) de l'ensemble de triangles, sommets soudés par position. */
export function boundaryLoops(input: CapInput): { vertex: number; x: number; y: number; z: number }[][] {
  const { positions, indices, triangles } = input;
  const count = new Map<string, number>();
  const edges: { e: string; ka: string; kb: string; a: number; b: number }[] = [];
  for (const t of triangles) {
    const v = [indices[3 * t]!, indices[3 * t + 1]!, indices[3 * t + 2]!];
    for (let k = 0; k < 3; k++) {
      const [a, b] = [v[k]!, v[(k + 1) % 3]!];
      const [ka, kb] = [key(positions, a), key(positions, b)];
      if (ka === kb) continue;
      const e = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      count.set(e, (count.get(e) ?? 0) + 1);
      edges.push({ e, ka, kb, a, b });
    }
  }
  // Arêtes de bord, orientées comme dans leur triangle : chaque arête est consommée une fois, donc les boucles sont exactes
  // même là où deux boucles se touchent en un sommet.
  const out = new Map<string, { kb: string; used: boolean }[]>();
  const vertexOf = new Map<string, number>();
  for (const { e, ka, kb, a, b } of edges) {
    if (count.get(e) !== 1) continue;
    vertexOf.set(ka, a);
    vertexOf.set(kb, b);
    (out.get(ka) ?? out.set(ka, []).get(ka)!).push({ kb, used: false });
  }
  const loops: { vertex: number; x: number; y: number; z: number }[][] = [];
  for (const [start, list] of out) {
    for (const first of list) {
      if (first.used) continue;
      const loop: string[] = [start];
      let edge: { kb: string; used: boolean } | undefined = first;
      while (edge && !edge.used) {
        edge.used = true;
        if (edge.kb === start) break;
        loop.push(edge.kb);
        edge = out.get(edge.kb)?.find((x) => !x.used);
      }
      loops.push(loop.map((k) => {
        const [x, y, z] = k.split(",").map(Number) as [number, number, number];
        return { vertex: vertexOf.get(k)!, x, y, z };
      }));
    }
  }
  return loops;
}

/**
 * Calotte qui ferme le dessus du crâne, ou null si la coque n'a pas de boucle de ce genre (crâne déjà fermé : tête chauve d'origine).
 * `lift` : hauteur du sommet au-dessus du point le plus haut de la boucle.
 */
export function capCrown(input: CapInput, lift = 0.1, rings = 4): Cap | null {
  const { positions, indices, triangles } = input;
  let skinTop = -Infinity;
  for (const t of triangles) for (let k = 0; k < 3; k++) skinTop = Math.max(skinTop, positions[3 * indices[3 * t + k]! + 1]!);

  let best: ReturnType<typeof boundaryLoops>[number] | null = null;
  let bestRadius = 0;
  for (const loop of boundaryLoops(input)) {
    if (loop.length < 12) continue;
    const c = [0, 0, 0].map((_, k) => loop.reduce((s, p) => s + [p.x, p.y, p.z][k]!, 0) / loop.length) as [number, number, number];
    const radius = Math.max(...loop.map((p) => Math.hypot(p.x - c[0], p.z - c[2])));
    const top = Math.max(...loop.map((p) => p.y));
    // Dessus de la tête : large, centré sur l'axe, à hauteur de front, et rien de la peau au-dessus (sinon le crâne est déjà fermé).
    if (radius > 0.3 && Math.abs(c[0]) < 0.1 && c[1] > 1.5 && skinTop < top + 0.1 && radius > bestRadius) {
      best = loop;
      bestRadius = radius;
    }
  }
  if (!best) return null;

  const n = best.length;
  const cx = best.reduce((s, p) => s + p.x, 0) / n;
  const cz = best.reduce((s, p) => s + p.z, 0) / n;
  const loopTop = Math.max(...best.map((p) => p.y));
  const apexY = loopTop + lift;
  // Les anneaux : le premier est la boucle elle-même ; l'anneau j se resserre vers l'axe et monte vers le sommet.
  const out: Cap = { positions: [], source: [], normals: [], indices: [], loopSize: n, apexY };
  const ringStart: number[] = [];
  for (let j = 0; j < rings; j++) {
    const phi = (j / rings) * (Math.PI / 2);
    ringStart.push(out.positions.length / 3);
    for (const p of best) {
      out.positions.push(cx + (p.x - cx) * Math.cos(phi), p.y + (apexY - p.y) * Math.sin(phi), cz + (p.z - cz) * Math.cos(phi));
      out.source.push(p.vertex);
    }
  }
  const apex = out.positions.length / 3;
  out.positions.push(cx, apexY, cz);
  out.source.push(best[0]!.vertex);
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < n; i++) {
      const a = ringStart[j]! + i;
      const b = ringStart[j]! + ((i + 1) % n);
      if (j + 1 < rings) {
        const c = ringStart[j + 1]! + i;
        const d = ringStart[j + 1]! + ((i + 1) % n);
        out.indices.push(a, b, d, a, d, c);
      } else out.indices.push(a, b, apex);
    }
  }
  // Orientation vers l'extérieur : le premier triangle doit regarder à l'opposé du centre de la tête.
  const at = (i: number) => [out.positions[3 * i]!, out.positions[3 * i + 1]!, out.positions[3 * i + 2]!] as const;
  const [p0, p1, p2] = [at(out.indices[0]!), at(out.indices[1]!), at(out.indices[2]!)];
  const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const v = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
  const normal = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
  const outward = [p0[0] - cx, p0[1] - (loopTop - 0.3), p0[2] - cz];
  if (normal[0]! * outward[0]! + normal[1]! * outward[1]! + normal[2]! * outward[2]! < 0) {
    for (let i = 0; i < out.indices.length; i += 3) [out.indices[i + 1], out.indices[i + 2]] = [out.indices[i + 2]!, out.indices[i + 1]!];
  }
  // Normales : direction du centre de la calotte vers chaque sommet.
  for (let i = 0; i < out.positions.length; i += 3) {
    const d = [out.positions[i]! - cx, out.positions[i + 1]! - (loopTop - 0.3), out.positions[i + 2]! - cz];
    const len = Math.hypot(d[0]!, d[1]!, d[2]!) || 1;
    out.normals.push(d[0]! / len, d[1]! / len, d[2]! / len);
  }
  return out;
}
