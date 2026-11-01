import { describe, expect, it, vi } from 'vitest';
import { isWakingError, withRetry } from '../../lib/server/retry';

/**
 * Reintentos con backoff para el despertar de Supabase (REGLAS.md §21.3,
 * Fase 7A). Solo se reintenta lo que parece de red/5xx; el resto de errores
 * sube tal cual a la primera.
 */

describe('isWakingError', () => {
  it('clasifica los errores de red y 5xx como despertar', () => {
    expect(isWakingError(new TypeError('fetch failed'))).toBe(true);
    expect(isWakingError(new Error('connect ECONNREFUSED 127.0.0.1:5432'))).toBe(true);
    expect(isWakingError(new Error('socket hang up'))).toBe(true);
    expect(isWakingError(new Error('Bad Gateway'))).toBe(true);
    expect(isWakingError(new Error('Service Unavailable'))).toBe(true);
    expect(isWakingError(new Error('Project is paused'))).toBe(true);
    const status503 = new Error('algo pasó');
    (status503 as Error & { status?: number }).status = 503;
    expect(isWakingError(status503)).toBe(true);
  });

  it('los errores de la aplicación no son un despertar', () => {
    expect(isWakingError(new Error('relation "seats" does not exist'))).toBe(false);
    expect(isWakingError(new Error('duplicate key value violates unique constraint'))).toBe(false);
    expect(isWakingError(new Error('No se pudo leer la partida'))).toBe(false);
    expect(isWakingError(null)).toBe(false);
    expect(isWakingError(undefined)).toBe(false);
    expect(isWakingError('')).toBe(false);
  });

  it('también clasifica objetos con forma de error de PostgREST', () => {
    expect(isWakingError({ message: 'connection terminated', code: 'PGRST301' })).toBe(true);
    expect(isWakingError({ message: 'too_many_active', code: 'P0001' })).toBe(false);
    expect(isWakingError({ code: '23505' })).toBe(false);
  });
});

describe('withRetry', () => {
  it('reintenta un error de red y devuelve el resultado del segundo intento', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw new TypeError('fetch failed');
        return 'despierto';
      },
      { baseMs: 1 },
    );
    expect(result).toBe('despierto');
    expect(calls).toBe(2);
  });

  it('un error de aplicación no se reintenta', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error('duplicate key value violates unique constraint');
        },
        { baseMs: 1 },
      ),
    ).rejects.toThrow('duplicate key');
    expect(calls).toBe(1);
  });

  it('agota los intentos y relanza el último error', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error('Service Unavailable');
        },
        { attempts: 3, baseMs: 1 },
      ),
    ).rejects.toThrow('Service Unavailable');
    expect(calls).toBe(3);
  });

  it('el primer intento exitoso no espera nada', async () => {
    const result = await withRetry(async () => 42, { baseMs: 1 });
    expect(result).toBe(42);
  });

  it('el backoff espera entre reintentos', async () => {
    let calls = 0;
    vi.useFakeTimers();
    // Con temporizadores falsos hay que avanzar a mano los dos retardos
    // (250 ms y 500 ms del backoff por defecto).
    const attempt = withRetry(
      async () => {
        calls += 1;
        throw new TypeError('fetch failed');
      },
      { attempts: 3, baseMs: 250 },
    ).catch(() => 'failed');

    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(500);
    await expect(attempt).resolves.toBe('failed');
    expect(calls).toBe(3);
    vi.useRealTimers();
  });
});
