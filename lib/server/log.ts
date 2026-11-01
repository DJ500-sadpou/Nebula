/**
 * Log estructurado mínimo (Fase 7): una línea JSON por evento, que el panel
 * del hosting recoge tal cual. Sin dependencias y sin secretos: nunca se
 * registran claves, tokens ni el contenido de las órdenes — solo el evento,
 * el código de mesa (que ya se comparte para invitar) y campos de contexto.
 */

function line(ev: string, level: 'info' | 'error', fields: Record<string, unknown>): string {
  return JSON.stringify({ ts: new Date().toISOString(), level, ev, ...fields });
}

/** Evento de negocio: creación de mesa, turno resuelto, partida terminada… */
export function logEvent(ev: string, fields: Record<string, unknown> = {}): void {
  console.info(line(ev, 'info', fields));
}

/** Fallo con su clasificación: `waking` separa el despertar del error real. */
export function logError(
  ev: string,
  error: unknown,
  fields: Record<string, unknown> = {},
): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(line(ev, 'error', { message, ...fields }));
}
