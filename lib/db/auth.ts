import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabase } from './server';

export interface SessionInfo {
  supabase: SupabaseClient;
  userId: string;
  email: string | null;
  nick: string;
  isAnonymous: boolean;
}

/**
 * Sesión verificada con `getClaims()` (firma comprobada), nunca `getSession()`
 * a secas: la cookie puede ser falsificada. El nick se lee del perfil, que
 * crea el trigger `on_auth_user_created`.
 */
export async function currentSession(): Promise<SessionInfo | null> {
  const supabase = await createServerSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims || typeof claims.sub !== 'string') return null;

  const userId = claims.sub;
  const { data: profile } = await supabase
    .from('profiles')
    .select('nick')
    .eq('id', userId)
    .maybeSingle();

  // Sin tipos generados de la base todavía (PENDIENTES.md P-07).
  const nick = (profile as { nick?: string } | null)?.nick;

  return {
    supabase,
    userId,
    email: typeof claims.email === 'string' ? claims.email : null,
    nick: nick && nick.length > 0 ? nick : 'Invitado',
    isAnonymous: claims.is_anonymous === true,
  };
}
