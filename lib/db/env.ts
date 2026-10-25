/**
 * Configuración pública de Supabase.
 *
 * La aplicación tiene que arrancar sin claves: en la nube no hay proyecto de
 * Supabase, y el criterio de la Fase 1 exige poder revisar la interfaz. Por eso
 * estas funciones devuelven `null`/listas en vez de lanzar.
 *
 * Solo variables `NEXT_PUBLIC_*`: la `service_role` vive en `lib/db/admin.ts`
 * y nunca debe entrar en un bundle de cliente.
 */

export const URL_ENV = 'NEXT_PUBLIC_SUPABASE_URL';
export const PUBLISHABLE_ENV = 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY';
export const ANON_ENV = 'NEXT_PUBLIC_SUPABASE_ANON_KEY';

export type EnvRecord = Record<string, string | undefined>;

export interface PublicSupabaseEnv {
  url: string;
  key: string;
  keySource: 'publishable' | 'anon';
}

function clean(value: string | undefined): string {
  return (value ?? '').trim();
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Supabase recomienda `publishable key`; se acepta `anon key` heredada. */
export function readPublicSupabaseEnv(env: EnvRecord = process.env): PublicSupabaseEnv | null {
  const url = clean(env[URL_ENV]).replace(/\/+$/, '');
  const publishable = clean(env[PUBLISHABLE_ENV]);
  const anon = clean(env[ANON_ENV]);
  const key = publishable || anon;

  if (!url || !key || !isHttpUrl(url)) return null;
  return { url, key, keySource: publishable ? 'publishable' : 'anon' };
}

/** Nombres de variables que faltan o están mal, para mostrarlos en la UI. */
export function missingPublicSupabaseEnv(env: EnvRecord = process.env): string[] {
  const missing: string[] = [];
  const url = clean(env[URL_ENV]);
  if (!url || !isHttpUrl(url)) missing.push(URL_ENV);
  if (!clean(env[PUBLISHABLE_ENV]) && !clean(env[ANON_ENV])) {
    missing.push(`${PUBLISHABLE_ENV} (o ${ANON_ENV})`);
  }
  return missing;
}
