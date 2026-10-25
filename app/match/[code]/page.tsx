import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SetupNotice } from '@/components/SetupNotice';
import { TurnScreen } from '@/components/TurnScreen';
import { createAdminSupabase, missingAdminEnv } from '@/lib/db/admin';
import { currentSession } from '@/lib/db/auth';
import { missingPublicSupabaseEnv, readPublicSupabaseEnv } from '@/lib/db/env';
import { loadMatchForUser } from '@/lib/db/matches';
import { PEOR_CARTA } from '@/lib/match/solo';

export const dynamic = 'force-dynamic';

export default async function MatchPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  if (!readPublicSupabaseEnv() || !createAdminSupabase()) {
    return <SetupNotice missing={[...missingPublicSupabaseEnv(), ...missingAdminEnv()]} />;
  }

  const session = await currentSession();
  if (!session) redirect('/login');

  const loaded = await loadMatchForUser(code, session.userId);
  if (!loaded.ok) {
    const message =
      loaded.reason === 'not_found'
        ? 'Esa mesa no existe.'
        : loaded.reason === 'forbidden'
          ? 'No tienes asiento en esa mesa.'
          : 'No se pudo leer la mesa. Revisa que las migraciones estén aplicadas.';
    return (
      <section className="space-y-4">
        <h2 className="font-display text-3xl text-parchment">Mesa {code}</h2>
        <p className="text-parchment-dim">{message}</p>
        <Link className="text-sm text-gold underline-offset-4 hover:underline" href="/">
          Volver al panteón
        </Link>
      </section>
    );
  }

  const { view } = loaded;
  const turnLimit = view.match.config?.turnLimit ?? PEOR_CARTA.turnLimit;
  const finished =
    view.match.status === 'finished' || view.match.status === 'closed' || view.state.finished;

  return (
    <TurnScreen
      code={view.match.code}
      state={view.state}
      mySeat={view.mySeat}
      turnLimit={turnLimit}
      finished={finished}
      lastChronicle={view.chronicle.at(-1)}
    />
  );
}
