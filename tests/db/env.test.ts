import { describe, expect, it } from 'vitest';
import {
  ANON_ENV,
  PUBLISHABLE_ENV,
  URL_ENV,
  missingPublicSupabaseEnv,
  readPublicSupabaseEnv,
} from '../../lib/db/env';

const URL_OK = 'https://proyecto.supabase.co';
const PUBLISHABLE = 'sb_publishable_ejemplo';
const ANON = 'eyJhbGciOiJIUzI1NiJ9.ejemplo.firma';

describe('readPublicSupabaseEnv', () => {
  it('devuelve null si no hay nada configurado', () => {
    expect(readPublicSupabaseEnv({})).toBeNull();
  });

  it('devuelve null si falta la clave', () => {
    expect(readPublicSupabaseEnv({ [URL_ENV]: URL_OK })).toBeNull();
  });

  it('prefiere la publishable key sobre la anon key', () => {
    const env = readPublicSupabaseEnv({
      [URL_ENV]: URL_OK,
      [PUBLISHABLE_ENV]: PUBLISHABLE,
      [ANON_ENV]: ANON,
    });
    expect(env).toEqual({ url: URL_OK, key: PUBLISHABLE, keySource: 'publishable' });
  });

  it('acepta la anon key heredada', () => {
    const env = readPublicSupabaseEnv({ [URL_ENV]: URL_OK, [ANON_ENV]: ANON });
    expect(env?.keySource).toBe('anon');
    expect(env?.key).toBe(ANON);
  });

  it('quita las barras finales de la URL', () => {
    const env = readPublicSupabaseEnv({ [URL_ENV]: `${URL_OK}/`, [ANON_ENV]: ANON });
    expect(env?.url).toBe(URL_OK);
  });

  it('rechaza una URL que no es http(s)', () => {
    expect(readPublicSupabaseEnv({ [URL_ENV]: 'proyecto.supabase.co', [ANON_ENV]: ANON })).toBeNull();
    expect(readPublicSupabaseEnv({ [URL_ENV]: 'ftp://x.test', [ANON_ENV]: ANON })).toBeNull();
  });

  it('ignora espacios en blanco', () => {
    const env = readPublicSupabaseEnv({
      [URL_ENV]: `  ${URL_OK}  `,
      [PUBLISHABLE_ENV]: `  ${PUBLISHABLE}  `,
    });
    expect(env).toEqual({ url: URL_OK, key: PUBLISHABLE, keySource: 'publishable' });
  });
});

describe('missingPublicSupabaseEnv', () => {
  it('enumera la URL y la clave cuando falta todo', () => {
    const missing = missingPublicSupabaseEnv({});
    expect(missing).toHaveLength(2);
    expect(missing[0]).toContain(URL_ENV);
    expect(missing[1]).toContain(PUBLISHABLE_ENV);
    expect(missing[1]).toContain(ANON_ENV);
  });

  it('no nombra la service_role: la UI nunca la pide', () => {
    expect(missingPublicSupabaseEnv({}).join(' ')).not.toContain('SERVICE_ROLE');
  });

  it('queda vacía con una configuración completa', () => {
    expect(
      missingPublicSupabaseEnv({ [URL_ENV]: URL_OK, [PUBLISHABLE_ENV]: PUBLISHABLE }),
    ).toEqual([]);
  });
});
