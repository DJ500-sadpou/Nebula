import { MatchState } from './types';

/**
 * Huella determinista de una partida.
 *
 * Serializa en orden canónico (claves ordenadas, sin `undefined`) y resume con
 * FNV-1a de 64 bits en dos mitades. No usa criptografía: el objetivo es
 * comparar dos ejecuciones byte a byte, no resistir ataques.
 */

export function canonical(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Número no finito en el estado');
    return Number.isInteger(value) ? String(value) : value.toFixed(6);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  throw new Error(`Valor no serializable: ${typeof value}`);
}

/** FNV-1a de 64 bits sobre la representación canónica. Devuelve 16 hex chars.
 *
 *  Dos pasadas con puntos de partida distintos: en la primera versión metía el
 *  byte alto de cada carácter en un acumulador aparte, y en ASCII ese byte es
 *  siempre 0, así que media huella solo dependía de la longitud del texto.
 */
export function digestOf(value: unknown): string {
  const text = canonical(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x7feb352d;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ code, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/**
 * Huella del estado **sin** la lista de eventos: los eventos contienen el mismo
 * contenido en texto y crecen sin límite, así que se comparan aparte.
 */
export function digestState(state: MatchState): string {
  const { events, ...rest } = state;
  return digestOf({ ...rest, eventCount: events.length });
}
