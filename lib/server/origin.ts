/**
 * Comprobación de mismo origen para las mutaciones por `app/api/*`.
 *
 * Las Server Actions de Next ya la hacen por dentro; un route handler, no. Sin
 * esto, la cookie de sesión viajaría en un POST de otro sitio (CSRF) y la ruta
 * resolvería un turno a nombre del jugador. Es defensa en profundidad: además
 * la sesión se verifica con `getClaims()`.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // navegación directa o cliente sin Origin
  const host = request.headers.get('host');
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
