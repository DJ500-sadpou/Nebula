/**
 * Azar criptográfico para la capa de servidor, con APIs web estándar
 * (`crypto.getRandomValues` / `crypto.randomUUID`): funcionan igual en Node y
 * en Cloudflare Workers (Freebuff Sites vía OpenNext), sin depender de
 * `node:crypto`, cuyo soporte en Workers es parcial.
 *
 * El motor no usa nada de esto: su azar es determinista y sembrado
 * (`lib/engine/rng.ts`). Aquí solo se sortean códigos de mesa y semillas
 * iniciales, que viven en el lado del servidor.
 */

export function randomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 0x100000000) {
    throw new Error('randomInt exige un entero en (0, 2^32]');
  }
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  // Muestreo por rechazo contra el sesgo de módulo: nunca sesga el alfabeto
  // del código de mesa (32 símbolos no divide 2^32 exactamente).
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  let value = buffer[0] as number;
  while (value >= limit) {
    crypto.getRandomValues(buffer);
    value = buffer[0] as number;
  }
  return value % maxExclusive;
}

/** Equivalente a `randomInt(min, max)` de Node: entero en [min, max). */
export function randomIntRange(minInclusive: number, maxExclusive: number): number {
  const span = maxExclusive - minInclusive;
  if (!Number.isInteger(span) || span <= 0) {
    throw new Error('randomIntRange exige maxExclusive > minInclusive');
  }
  return minInclusive + randomInt(span);
}

export function randomUUID(): string {
  return crypto.randomUUID();
}
