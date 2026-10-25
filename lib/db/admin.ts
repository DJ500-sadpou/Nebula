import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente con `service_role`. Solo se importa desde código de servidor: rutas,
 * Server Actions y páginas. Nunca lleva prefijo `NEXT_PUBLIC_` (AGENTS.md) y
 * nunca se registra en un log.
 *
 * Devuelve `null` cuando falta configuración, igual que el cliente público: la
 * aplicación arranca sin claves y lo cuenta en pantalla.
 */

export const SERVICE_ROLE_ENV = 'SUPABASE_SERVICE_ROLE_KEY';

function clean(value: string | undefined): string {
  return (value ?? '').trim();
}

export function createAdminSupabase(): SupabaseClient | null {
  const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/+$/, '');
  const key = clean(process.env[SERVICE_ROLE_ENV]);
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function missingAdminEnv(): string[] {
  const missing: string[] = [];
  if (!clean(process.env.NEXT_PUBLIC_SUPABASE_URL)) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!clean(process.env[SERVICE_ROLE_ENV])) missing.push(SERVICE_ROLE_ENV);
  return missing;
}
