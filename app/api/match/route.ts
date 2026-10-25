import { NextResponse } from 'next/server';
import { missingAdminEnv } from '@/lib/db/admin';
import { currentSession } from '@/lib/db/auth';
import { createSoloMatch } from '@/lib/db/matches';
import { isSameOrigin } from '@/lib/server/origin';

export const dynamic = 'force-dynamic';

/** Crea la mesa de iniciación: un humano y tres bots, 12 turnos (§19). */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'origen no permitido' }, { status: 403 });
  }

  const session = await currentSession();
  if (!session) {
    return NextResponse.json({ error: 'sesión requerida' }, { status: 401 });
  }

  const result = await createSoloMatch(session.userId);
  if (!result.ok) {
    const status = result.reason === 'unconfigured' ? 503 : 500;
    return NextResponse.json(
      { error: result.reason, missing: missingAdminEnv() },
      { status },
    );
  }

  return NextResponse.json({ code: result.code }, { status: 201 });
}
