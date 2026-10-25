import { NextResponse } from 'next/server';
import { currentSession } from '@/lib/db/auth';
import { resolveMatchTurn } from '@/lib/db/matches';
import { isSameOrigin } from '@/lib/server/origin';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, number> = {
  unconfigured: 503,
  not_found: 404,
  forbidden: 403,
  finished: 409,
  busy: 409,
  stale: 409,
  failed: 500,
};

/**
 * Cierra el turno del jugador: sanea el plan, resuelve con el motor y aplica el
 * resultado con claim atómico. Dos clics simultáneos resuelven una sola vez
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
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const payload = body as { plan?: unknown; problemOption?: unknown; turn?: unknown };
  const expectedTurn = Number(payload.turn);

  const result = await resolveMatchTurn(
    code,
    session.userId,
    payload.plan,
    payload.problemOption,
    Number.isInteger(expectedTurn) ? expectedTurn : undefined,
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason, detail: result.detail },
      { status: STATUS[result.reason] ?? 500 },
    );
  }

  return NextResponse.json(
    { status: result.status, turn: result.turn, finished: result.finished },
    { status: 200 },
  );
}
