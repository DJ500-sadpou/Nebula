/**
 * Azar determinista. Todo pasa por aquí: no existe Math.random en el motor.
 * mulberry32 es pequeño, rápido y suficiente para un juego de este tamaño.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mezcla entera estable (xorshift) para derivar semillas por paso. */
export function hash3(seed: number, turn: number, step: number): number {
  let h = seed ^ Math.imul(turn + 1, 0x9e3779b1) ^ Math.imul(step + 1, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

export function rng(seed: number, turn: number, step: number): () => number {
  return mulberry32(hash3(seed, turn, step));
}

/** Entero uniforme en [0, n). */
export function pick(n: number, rand: () => number): number {
  return Math.min(n - 1, Math.floor(rand() * n));
}

/** Elige un elemento; exige lista no vacía. */
export function pickOne<T>(list: readonly T[], rand: () => number): T {
  const item = list[pick(list.length, rand)];
  if (item === undefined) throw new Error('pickOne sobre lista vacía');
  return item;
}
