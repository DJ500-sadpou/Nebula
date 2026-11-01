/**
 * Reintentos con *backoff* para la primera petición tras una pausa de
 * Supabase (PLAN.md §2.2.2 y §5, REGLAS.md §21.3).
 *
 * El proyecto gratuito pausa a los 7 días sin actividad y la primera lectura
 * puede fallar con un error de red o un 5xx mientras el proyecto despierta.
 * `withRetry` la repite con calma —solo los errores que parecen de despertar—
 * y devuelve el último error si no hay suerte, para que la UI pueda enseñar
 * el estado honesto en lugar de un error genérico.
 *
 * Reglas de uso (D70):
 *   · Solo se envuelven **lecturas** y mutaciones **idempotentes**
 *     (`apply_turn`, `release_turn`): reintentar una creación duplicaría la
 *     partida.
 *   · El *backoff* es corto (250 ms, 500 ms): no despierta un proyecto pausado
 *     por sí solo; la recuperación real la hace el ping diario (P-08) y el
 *     reintento tranquilo de la UI.
 */

/** Patrones de un servidor despertando o de un fallo transitorio de red. */
const WAKING_PATTERNS: readonly string[] = [
  'fetch failed',
  'network',
  'econnrefused',
  'enotfound',
  'etimedout',
  'etimeout',
  'econnreset',
  'ehostunreach',
  'eai_again',
  'connection refused',
  'connection reset',
  'connection closed',
  'connection terminated',
  'socket hang up',
  'socket disconnected',
  'terminated',
  'bad gateway',
  'service unavailable',
  'gateway timeout',
  'internal server error',
  'temporarily unavailable',
  'project is paused',
  'paused',
  'timeout',
  'timed out',
  '502',
  '503',
  '504',
];

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const status = (error as Error & { status?: unknown }).status;
    return [error.message, status !== undefined ? String(status) : ''].join(' ');
  }
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    return [record.message, record.code, record.status, record.detail]
      .filter((part) => part !== undefined && part !== null && part !== '')
      .map(String)
      .join(' ');
  }
  return String(error);
}

/**
 * ¿El error parece un servidor despertando o un fallo transitorio de red?
 * Clasifica de forma conservadora: un falso positivo solo cuesta un reintento
 * de una lectura idempotente; un falso negativo deja el error como hasta ahora.
 */
export function isWakingError(error: unknown): boolean {
  const text = errorText(error).toLowerCase();
  return WAKING_PATTERNS.some((pattern) => text.includes(pattern));
}

export interface RetryOptions {
  /** Intentos totales, incluido el primero. Por defecto 3. */
  attempts?: number;
  /** Retardo del primer reintento en ms; se duplica en cada uno. Por defecto 250. */
  baseMs?: number;
  /** Decide qué errores se reintentan. Por defecto, solo `isWakingError`. */
  retryOn?: (error: unknown) => boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ejecuta `fn` reintentando con *backoff* exponencial los errores clasificados
 * como de despertar. El último error se relanza tal cual: quien llama decide si
 * lo traduce a un `waking` en su resultado.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseMs = Math.max(0, options.baseMs ?? 250);
  const retryOn = options.retryOn ?? isWakingError;

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1 || !retryOn(error)) throw error;
      await sleep(baseMs * 2 ** attempt);
    }
  }
  throw lastError;
}
