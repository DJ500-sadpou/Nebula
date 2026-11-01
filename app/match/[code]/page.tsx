import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArchivedMatch } from '@/components/ArchivedMatch';
import { AutoRefresh } from '@/components/AutoRefresh';
import { LobbyScreen } from '@/components/LobbyScreen';
import { SetupNotice } from '@/components/SetupNotice';
import { TurnScreen } from '@/components/TurnScreen';
import { WakingNotice } from '@/components/WakingNotice';
import type { MultiTurnProps } from '@/components/TurnScreen';
import { createAdminSupabase, missingAdminEnv } from '@/lib/db/admin';
import { currentSession } from '@/lib/db/auth';
import { missingPublicSupabaseEnv, readPublicSupabaseEnv } from '@/lib/db/env';
import { loadMatchForUser } from '@/lib/db/matches';
import { loadLobbyView, loadMultiTurnView } from '@/lib/db/multiplayer';
import { PEOR_CARTA } from '@/lib/match/solo';

export const dynamic = 'force-dynamic';

export default async function MatchPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  if (!readPublicSupabaseEnv() || !createAdminSupabase()) {
    return <SetupNotice missing={[...missingPublicSupabaseEnv(), ...missingAdminEnv()]} />;
  }

  const session = await currentSession();
  if (!session) redirect('/login');

  // Fase de lobby: la sala se ve aunque aún no tenga asiento (para sentarse).
  const lobby = await loadLobbyView(code, session.userId);
  if (lobby.ok) {
    return (
      <>
        <AutoRefresh seconds={30} />
        <LobbyScreen view={lobby.view} />
      </>
    );
  }

  const loaded = await loadMatchForUser(code, session.userId);
  if (!loaded.ok) {
    // §21.2: la partida terminó hace más de 30 días y solo queda su resumen.
    if (loaded.reason === 'archived') {
      return <ArchivedMatch archived={loaded.archived} />;
    }
    // §21.3: la primera petición tras una pausa de Supabase no es un error.
    if (loaded.reason === 'failed' && loaded.waking) {
      return <WakingNotice />;
    }
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
  const config = view.match.config ?? {};
  const isMulti = config.mode === 'multi';
  const turnLimit =
    Number(config.turnLimit) || (isMulti ? 24 : PEOR_CARTA.turnLimit);
  const finished =
    view.match.status === 'finished' || view.match.status === 'closed' || view.state.finished;

  // Datos multijugador visibles: quién envió, papeleta y reloj del turno.
  let multi: MultiTurnProps | undefined;
  if (isMulti && !finished) {
    const turnView = await loadMultiTurnView(code, session.userId);
    if (turnView.ok) {
      multi = {
        seats: turnView.view.seats,
        mySubmitted: turnView.view.mySubmitted,
        ballot: turnView.view.ballot,
        turnEndsAt: turnView.view.turnEndsAt,
      };
    }
  }

  return (
    <TurnScreen
      code={view.match.code}
      state={view.state}
      mySeat={view.mySeat}
      turnLimit={turnLimit}
      finished={finished}
      lastChronicle={view.chronicle.at(-1)}
      multi={multi}
    />
  );
}
