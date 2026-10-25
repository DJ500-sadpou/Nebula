import Link from 'next/link';
import { CreateMatch } from '@/components/CreateMatch';
import { SetupNotice } from '@/components/SetupNotice';
import { signOut } from './actions';
import { currentSession } from '@/lib/db/auth';
import { missingPublicSupabaseEnv, readPublicSupabaseEnv } from '@/lib/db/env';

// La sesión se lee de cookies: la página nunca puede ser estática.
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  lobby: 'En el vestíbulo',
  orders: 'Recibiendo órdenes',
  resolving: 'Resolviendo el turno',
  finished: 'Terminada',
  closed: 'Archivada',
};

const ERA_LABEL: Record<string, string> = {
  tribal: 'Tribal',
  reinos: 'Grandes Reinos',
  modernidad: 'Modernidad',
};

/**
 * Fila de `seats` con la partida anidada. Mientras no haya tipos generados de
 * la base (PENDIENTES.md P-07), se declara a mano y se convierte una sola vez.
 */
interface LobbySeat {
  seat_idx: number;
  name: string;
  matches: {
    code: string;
    status: string;
    turn: number;
    era: string;
  } | null;
}

export default async function HomePage() {
  const env = readPublicSupabaseEnv();
  if (!env) return <SetupNotice missing={missingPublicSupabaseEnv()} />;

  const session = await currentSession();
  if (!session) return <SignedOutHome />;

  const { data, error } = await session.supabase
    .from('seats')
    .select('seat_idx, name, matches(code, status, turn, era)')
    .eq('user_id', session.userId);

  const seats = (data ?? []) as unknown as LobbySeat[];

  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gold/15 pb-6">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-gold-soft">Tu panteón</p>
          <h2 className="mt-1 font-display text-3xl text-parchment">
            {session.nick}
            {session.isAnonymous && (
              <span className="ml-3 align-middle text-xs uppercase tracking-widest text-parchment-dim">
                invitado
              </span>
            )}
          </h2>
          <p className="mt-1 text-sm text-parchment-dim">
            {session.email ?? 'Sesión anónima: al cerrarla perderás el acceso a este perfil.'}
          </p>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="cursor-pointer rounded border border-gold/30 px-4 py-2 text-sm text-parchment-dim transition-colors hover:border-gold hover:text-gold"
          >
            Salir
          </button>
        </form>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-4">
            <h3 className="font-display text-xl text-parchment">Tus mesas</h3>
            <span className="text-xs text-parchment-dim">{seats.length} en total</span>
          </div>
          <CreateMatch />
        </div>

        {error && (
          <p className="rounded border border-blood/40 bg-ink-soft px-4 py-3 text-sm text-blood">
            No se pudieron leer tus mesas ({error.code ?? 'error de red'}). Revisa que las
            migraciones estén aplicadas.
          </p>
        )}

        {!error && seats.length === 0 && (
          <div className="rounded-lg border border-dashed border-gold/25 px-6 py-10 text-center">
            <p className="font-display text-lg text-parchment">Todavía no guías a nadie</p>
            <p className="mx-auto mt-2 max-w-prose text-sm text-parchment-dim">
              «La peor carta» es la iniciación: tú contra tres bots, doce turnos y la peor Área
              Pequeña como carta. Las partidas con amigos y los códigos de invitación llegan en la
              Fase 4.
            </p>
          </div>
        )}

        {seats.length > 0 && (
          <ul className="divide-y divide-gold/15 overflow-hidden rounded-lg border border-gold/25 bg-ink-soft">
            {seats.map((seat) => (
              <li key={`${seat.matches?.code ?? 'mesa'}-${seat.seat_idx}`} className="px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link
                    href={`/match/${seat.matches?.code ?? ''}`}
                    className="font-display text-lg text-parchment underline-offset-4 transition-colors hover:text-gold hover:underline"
                  >
                    Mesa {seat.matches?.code ?? '—'}
                  </Link>
                  <p className="text-xs uppercase tracking-widest text-gold-soft">
                    {STATUS_LABEL[seat.matches?.status ?? ''] ?? 'Sin estado'}
                  </p>
                </div>
                <p className="mt-1 text-sm text-parchment-dim">
                  Asiento {seat.seat_idx + 1} · {ERA_LABEL[seat.matches?.era ?? ''] ?? '—'} ·
                  turno {seat.matches?.turn ?? '—'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function SignedOutHome() {
  return (
    <section className="space-y-8">
      <div className="space-y-4">
        <p className="text-xs uppercase tracking-[0.25em] text-gold-soft">
          Un dios · un pueblo · treinta siglos
        </p>
        <h2 className="max-w-xl font-display text-4xl leading-tight text-parchment">
          Tu pueblo cree que mandas tú
        </h2>
        <p className="max-w-prose text-parchment-dim">
          Eliges señales, milagros y elegidos; pagas un impuesto cada vez que fuerzas la
          causalidad. La mesa vota cuánto tiempo pasa en el mundo y el mundo decide cuándo cambia
          de era. Gana quien somete a los demás dioses, o quien mejor puntúa al final del
          horizonte.
        </p>
        <p className="max-w-prose text-sm text-parchment-dim">
          Sin sprites: la interfaz es texto, opciones y crónica.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Link
          href="/login"
          className="rounded border border-gold bg-gold px-6 py-3 text-sm font-semibold text-ink transition-colors hover:bg-parchment"
        >
          Entrar en el mundo
        </Link>
        <p className="text-xs text-parchment-dim">
          Correo y contraseña, o una sesión de invitado sin registro.
        </p>
      </div>

      <dl className="grid gap-4 border-t border-gold/15 pt-6 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-widest text-gold-soft">Motor</dt>
          <dd className="mt-1 text-parchment-dim">
            Puro y determinista: mismo estado + mismas órdenes, misma huella byte a byte.
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-widest text-gold-soft">Mesa</dt>
          <dd className="mt-1 text-parchment-dim">
            Órdenes secretas por compás; nadie ve tu Fe ni tu fidelidad.
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-widest text-gold-soft">Mundo</dt>
          <dd className="mt-1 text-parchment-dim">
            Una barra de época pública empuja a todos de la tribu a la modernidad.
          </dd>
        </div>
      </dl>
    </section>
  );
}
