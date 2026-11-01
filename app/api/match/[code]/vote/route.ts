import { NextResponse } from 'next/server';
import { currentSession } from '@/lib/db/auth';
import { castMultiVote } from '@/lib/db/multiplayer';
import { logError } from '@/lib/server/log';
import { isSameOrigin } from '@/lib/server/origin';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, number> = {
  unconfigured: 503,
  not_found: 404,
  forbidden: 403,
  bot_seat: 409,
  not_orders: 409,
  forced_window: 409,
  illegal_window: 400,
  same_window: 409,
  failed: 500,
};

/**
 * Papeleta de ventana (§5-A.2, Fase 4). Sin papeleta abierta, el primer voto
 * humano legal abre la propuesta; con una abierta, se vota o se cambia el
 * voto propio hasta el cierre. Los votos son secretos hasta que el turno se
 * resuelve y se publican con la crónica (A.2.7).
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

  const result = await castMultiVote(code, session.userId, body.windowId);

  if (!result.ok) {
    const status = result.waking ? 503 : (STATUS[result.reason] ?? 500);
    if (status === 500 || result.waking) {
      logError('vote_failed', result.detail, {
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

  return NextResponse.json({ status: result.status, proposal: result.proposal });
}
