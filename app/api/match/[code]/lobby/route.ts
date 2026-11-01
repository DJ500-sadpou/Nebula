import { NextResponse } from 'next/server';
import { currentSession } from '@/lib/db/auth';
import { lobbyAction } from '@/lib/db/multiplayer';
import { logError, logEvent } from '@/lib/server/log';
import { isSameOrigin } from '@/lib/server/origin';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, number> = {
  unconfigured: 503,
  not_found: 404,
  not_lobby: 409,
  full: 409,
  already_seated: 409,
  // §21.1: el jugador ya mantiene 3 mesas activas.
  seat_limit: 409,
  not_all_ready: 409,
  not_host: 403,
  not_seated: 409,
  bad_seat: 400,
  empty: 409,
  unknown_action: 400,
  failed: 500,
};

/**
 * Acciones del lobby (Fase 4): unirse, listo/no listo, expulsar, marcharse y
 * arrancar. Todas con `service_role`: el cliente nunca escribe estado.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'origen no permitido' }, { status: 403 });
  }

  const session = await currentSession();
  if (!session) {
    return NextResponse.json({ error: 'sesión requerida' }, { status: 401 });
  }

  const { code } = await context.params;
  let body: Record<string, unknown> = {};
  try {
    const parsed = (await request.json()) as unknown;
    if (typeof parsed === 'object' && parsed !== null) body = parsed as Record<string, unknown>;
  } catch {
    body = {};
  }

  const action = typeof body.action === 'string' ? body.action : '';
  const result = await lobbyAction(code, session.userId, action, {
    seat: body.seat,
    ready: body.ready,
  });

  if (!result.ok) {
    const status = result.waking ? 503 : (STATUS[result.reason] ?? 500);
    if (status === 500 || result.waking) {
      logError('lobby_action_failed', result.detail, {
        code,
        action,
        reason: result.reason,
        waking: result.waking,
      });
    }
    return NextResponse.json(
      {
        error: result.reason,
        detail: 'detail' in result ? result.detail : undefined,
        waking: result.waking,
      },
      { status },
    );
  }

  if (result.status === 'started') logEvent('match_started', { code });
  return NextResponse.json({ status: result.status, seat: result.seat });
}
