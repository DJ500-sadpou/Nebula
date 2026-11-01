import { NextResponse } from 'next/server';
import { currentSession } from '@/lib/db/auth';
import { submitMultiOrders } from '@/lib/db/multiplayer';
import { logError, logEvent } from '@/lib/server/log';
import { isSameOrigin } from '@/lib/server/origin';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, number> = {
  unconfigured: 503,
  not_found: 404,
  forbidden: 403,
  not_orders: 409,
  stale: 409,
  bot_seat: 409,
  failed: 500,
};

/**
 * Envía las órdenes del asiento propio (Fase 4). Inmutables: repetir es
 * idempotente. Si con este envío ya están todos los humanos, el mismo request
 * cierra el turno (§5); si falta alguien, responde `waiting`.
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

  const expectedTurn = Number(body.turn);

  const result = await submitMultiOrders(
    code,
    session.userId,
    body.plan,
    body.problemOption,
    Number.isInteger(expectedTurn) ? expectedTurn : undefined,
  );

  if (!result.ok) {
    const status = result.waking ? 503 : (STATUS[result.reason] ?? 500);
    if (status === 500 || result.waking) {
      logError('orders_failed', result.detail, {
        code,
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

  if (result.status !== 'waiting') {
    logEvent('orders_submitted', { code, turn: result.turn, status: result.status });
  }
  return NextResponse.json({
    status: result.status,
    turn: result.turn,
    finished: result.finished,
  });
}
