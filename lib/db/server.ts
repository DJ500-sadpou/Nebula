import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { readPublicSupabaseEnv } from './env';

/**
 * Cliente de Supabase para Server Components, Server Actions y Route Handlers.
 * Devuelve `null` si el proyecto no está configurado: la UI lo trata como
 * "modo sin configurar" en vez de romperse.
 */
export async function createServerSupabase() {
  const env = readPublicSupabaseEnv();
  if (!env) return null;

  const cookieStore = await cookies();

  return createServerClient(env.url, env.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Un Server Component no puede escribir cookies. `proxy.ts` refresca
          // el token en cada petición, así que ignorarlo aquí es seguro.
        }
      },
    },
  });
}
