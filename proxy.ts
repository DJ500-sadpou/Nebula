import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { readPublicSupabaseEnv } from '@/lib/db/env';

/**
 * Next 16 sustituyó `middleware.ts` por `proxy.ts`. Aquí solo se refresca el
 * token: los Server Components no pueden escribir cookies y, sin esto, la
 * sesión se perdería al caducar el access token.
 *
 * No se decide autorización aquí. Cada página y cada ruta comprueba la sesión
 * con `getClaims()`; el proxy es transporte, no una puerta de seguridad.
 */
export async function proxy(request: NextRequest) {
  const env = readPublicSupabaseEnv();
  if (!env) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.url, env.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  await supabase.auth.getClaims();

  return response;
}

export const config = {
  matcher: [
    // Todo excepto estáticos, imágenes y el health check (cron sin sesión).
    '/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
