import { NextResponse } from 'next/server';
import { currentSession } from '@/lib/db/auth';
import { matchModeOf, resolveMatchTurn } from '@/lib/db/matches';
import { resolveMultiMatchTurn } from '@/lib/db/multiplayer';
import { logError, logEvent } from '@/lib/server/log';
import { isSameOrigin } from '@/lib/server/origin';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, number> = {
  unconfigured: 503,
  not_found: 404,
  forbidden: 403,
  finished: 409,
  not_orders: 409,
  busy: 409,
  stale: 409,
  failed: 500,
};

/**
 * Cierra el turno. En el modo de un jugador resuelve con el plan que llega
 * aquí (rebanada de la Fase 3); en multijugador es el disparador de cierre:
 * resuelve si todos enviaron o si el temporizador venció (§5), y si no,
 * responde `waiting`. Dos clics simultáneos resuelven una sola vez
 * (AGENTS.md invariante 5).
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

  const mode = await matchModeOf(code);
  if (mode === 'unconfigured') {
    return NextResponse.json(
      { error: 'unconfigured' },
      { status: 503 },
    );
  }

  if (mode === 'multi') {
    const result = await resolveMultiMatchTurn(code, session.userId);
    if (!result.ok) {
      const status = result.waking ? 503 : (STATUS[result.reason] ?? 500);
      if (status === 500 || result.waking) {
        logError('turn_failed', result.detail, {
          code,
          mode: 'multi',
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
      logEvent('turn_resolved', {
        code,
        mode: 'multi',
        turn: result.turn,
        status: result.status,
        finished: result.finished,
      });
    }
    return NextResponse.json({
      status: result.status,
      turn: result.turn,
      finished: result.finished,
    });
  }

  const expectedTurn = Number(body.turn);
  const result = await resolveMatchTurn(
    code,
    session.userId,
    body.plan,
    body.problemOption,
    Number.isInteger(expectedTurn) ? expectedTurn : undefined,
  );

  if (!result.ok) {
    const status = result.waking ? 503 : (STATUS[result.reason] ?? 500);
    if (status === 500 || result.waking) {
      logError('turn_failed', result.detail, {
        code,
        mode: 'solo',
        reason: result.reason,
        waking: result.waking,
      });
    }
    return NextResponse.json(
      { error: result.reason, detail: result.detail, waking: result.waking },
      { status },
    );
  }

  logEvent('turn_resolved', {
    code,
    mode: 'solo',
    turn: result.turn,
    status: result.status,
    finished: result.finished,
  });
  return NextResponse.json(
    { status: result.status, turn: result.turn, finished: result.finished },
    { status: 200 },
  );
}
