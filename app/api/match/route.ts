import { NextResponse } from 'next/server';
import { missingAdminEnv } from '@/lib/db/admin';
import { currentSession } from '@/lib/db/auth';
import { createSoloMatch } from '@/lib/db/matches';
import { createLobbyMatch } from '@/lib/db/multiplayer';
import { logError, logEvent } from '@/lib/server/log';
import { isSameOrigin } from '@/lib/server/origin';

export const dynamic = 'force-dynamic';

/**
 * Crea una mesa. Con `mode: "solo"` (o sin cuerpo) arranca «La peor carta»:
 * un humano y tres bots, 12 turnos (§19). Con `mode: "multi"` abre una sala
 * de lobby (Fase 4) y devuelve el código para invitar al resto.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'origen no permitido' }, { status: 403 });
  }

  const session = await currentSession();
  if (!session) {
    return NextResponse.json({ error: 'sesión requerida' }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed = (await request.json()) as unknown;
    if (typeof parsed === 'object' && parsed !== null) body = parsed as Record<string, unknown>;
  } catch {
    body = {};
  }

  if (body.mode === 'multi') {
    const result = await createLobbyMatch(session.userId, body.config);
    if (!result.ok) {
      const status =
        result.reason === 'unconfigured' || result.waking
          ? 503
          : result.reason === 'bad_config'
            ? 400
            : result.reason === 'limit'
              ? 409
              : 500;
      if (status === 500 || result.waking) {
        logError('lobby_create_failed', result.detail, { reason: result.reason, waking: result.waking });
      }
      return NextResponse.json(
        {
          error: result.reason,
          detail: 'detail' in result ? result.detail : undefined,
          waking: result.waking,
          missing: missingAdminEnv(),
        },
        { status },
      );
    }
    logEvent('lobby_created', { code: result.code });
    return NextResponse.json({ code: result.code, mode: 'multi' }, { status: 201 });
  }

  const result = await createSoloMatch(session.userId);
  if (!result.ok) {
    const status =
      result.reason === 'unconfigured' || result.waking ? 503 : result.reason === 'limit' ? 409 : 500;
    if (status === 500 || result.waking) {
      logError('match_create_failed', result.detail, { reason: result.reason, waking: result.waking });
    }
    return NextResponse.json(
      {
        error: result.reason,
        waking: result.waking,
        missing: missingAdminEnv(),
      },
      { status },
    );
  }

  logEvent('match_created', { code: result.code });
  return NextResponse.json({ code: result.code, mode: 'solo' }, { status: 201 });
}
