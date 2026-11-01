import { NextResponse } from 'next/server';
import { currentSession } from '@/lib/db/auth';
import { loadLobbyView, loadMultiTurnView } from '@/lib/db/multiplayer';
import { isSameOrigin } from '@/lib/server/origin';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, number> = {
  unconfigured: 503,
  not_found: 404,
  not_lobby: 409,
  forbidden: 403,
  lobby: 409,
  failed: 500,
};

/**
 * Vista ligera de la mesa (Fase 4). Es el respaldo de *polling* cuando Supabase
 * Realtime no llegue: devuelve fases, quién está sentado y quién ya envió,
 * PERO nunca las órdenes ni los votos ajenos. El cliente lo consulta con
 * calma (≥ 30 s) o al recargar; el ritmo fino lo lleva Realtime (D55).
 */
export async function GET(
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

  const lobby = await loadLobbyView(code, session.userId);
  if (lobby.ok) {
    return NextResponse.json({ phase: 'lobby', lobby: lobby.view });
  }
  // Si no está en lobby (o no existe), se prueba la vista de turno: un no
  // participante de una partida activa recibe `forbidden` allí.
  if (lobby.reason !== 'unconfigured' && lobby.reason !== 'failed') {
    const turnView = await loadMultiTurnView(code, session.userId);
    if (turnView.ok) {
      return NextResponse.json({ phase: turnView.view.phase, turn: turnView.view });
    }
    if (turnView.reason === 'lobby') {
      // La partida volvió al lobby entre ambas lecturas: se reintenta arriba.
      return NextResponse.json({ error: 'lobby' }, { status: 409 });
    }
    return NextResponse.json(
      { error: turnView.reason, waking: turnView.reason === 'failed' ? turnView.waking : undefined },
      { status: turnView.waking ? 503 : (STATUS[turnView.reason] ?? 500) },
    );
  }

  return NextResponse.json(
    { error: lobby.reason, waking: lobby.reason === 'failed' ? lobby.waking : undefined },
    { status: lobby.waking ? 503 : (STATUS[lobby.reason] ?? 500) },
  );
}
