import { createClient } from '@supabase/supabase-js';
import { readPublicSupabaseEnv } from '@/lib/db/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE = { 'cache-control': 'no-store' } as const;

/**
 * `GET /api/health` — despierta el proyecto de Supabase (PLAN.md §5) y sirve
 * para comprobar desde fuera que la base responde. Usa la clave pública: RLS
 * devuelve 0 filas, que es suficiente para probar que hay conexión.
 */
export async function GET() {
  const env = readPublicSupabaseEnv();
  if (!env) {
    return Response.json(
      {
        ok: false,
        configured: false,
        detail: 'Faltan NEXT_PUBLIC_SUPABASE_URL y la clave pública.',
      },
      { status: 503, headers: NO_STORE },
    );
  }

  const started = Date.now();
  const supabase = createClient(env.url, env.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await supabase.from('matches').select('id', { head: true, count: 'exact' }).limit(1);
  const latencyMs = Date.now() - started;

  if (error) {
    return Response.json(
      { ok: false, configured: true, latencyMs, detail: error.code ?? 'db_error' },
      { status: 503, headers: NO_STORE },
    );
  }

  return Response.json({ ok: true, configured: true, latencyMs }, { headers: NO_STORE });
}
