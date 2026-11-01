'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MultiLobbyView } from '@/lib/db/multiplayer';

/**
 * Sala de espera (Fase 4): asientos, listo/no listo, código para invitar y el
 * botón de arranque del anfitrión. No conoce la base de datos: recibe la
 * vista del servidor y actúa por la ruta de API. El refresco fino lo lleva
 * Supabase Realtime cuando esté configurado; el respaldo es `AutoRefresh`.
 */
export function LobbyScreen({ view, review = false }: { view: MultiLobbyView; review?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const seated = view.seats.filter((seat) => seat.kind !== 'empty');
  const isHost = view.mySeat === view.hostSeat && view.mySeat >= 0;

  async function action(name: string, payload: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/match/${view.code}/lobby`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: name, ...payload }),
      });
      const payloadJson = (await response.json().catch(() => ({}))) as {
        error?: string;
        waking?: boolean;
      };
      if (!response.ok) {
        const reason = payloadJson.error ?? String(response.status);
        const text = payloadJson.waking
          ? 'El servidor está despertando: reintenta en unos segundos.'
          : reason === 'full'
            ? 'La sala está llena.'
            : reason === 'not_host'
              ? 'Solo el anfitrión puede hacer eso.'
              : reason === 'not_all_ready'
                ? 'Todos deben marcar «listo» antes de arrancar.'
                : reason === 'already_seated'
                  ? 'Ya tienes asiento en esta mesa.'
                  : reason === 'seat_limit'
                    ? 'Ya guías tres mundos a la vez (§21.1): termina o cierra uno antes de sentarte en otro.'
                    : `No se pudo hacer (${reason}).`;
        setError(text);
        router.refresh();
        return;
      }
      router.refresh();
      if (name === 'start') {
        // El arranque cambia la fase: la misma URL ahora enseña el turno 1.
        window.location.href = `/match/${view.code}`;
      }
    } catch {
      setError('No se pudo contactar con el servidor.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="space-y-3 border-b border-gold/25 pb-5">
        <p className="text-xs uppercase tracking-[0.25em] text-gold-soft">
          Sala de espera · modo mesa compartida
        </p>
        <h2 className="font-display text-3xl text-parchment">
          Mesa {view.code}
        </h2>
        <p className="max-w-prose text-sm text-parchment-dim">
          Comparte el código <span className="text-gold">{view.code}</span> con quien quieras
          invitar. Al arrancar, los asientos que queden libres se rellenan con bots y la partida
          juega turnos que esperan a todos (§5). {review && 'Vista de revisión: nada se envía.'}
        </p>
      </header>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between text-xs text-parchment-dim">
          <span>
            {seated.length} de {view.seatCount} asientos ocupados
          </span>
          <span>
            {seated.filter((seat) => seat.ready).length} listo
            {seated.filter((seat) => seat.ready).length === 1 ? '' : 's'}
          </span>
        </div>

        <ul className="grid gap-2 sm:grid-cols-2">
          {view.seats.map((seat) => (
            <li
              key={seat.seatIdx}
              className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${
                seat.mine
                  ? 'border-gold/60 bg-gold/10'
                  : seat.kind === 'empty'
                    ? 'border-gold/10 text-parchment-dim/60'
                    : 'border-gold/25 bg-ink-soft'
              }`}
            >
              <div>
                <p className={seat.kind === 'empty' ? '' : 'text-parchment'}>
                  {seat.kind === 'empty' ? 'Asiento libre' : seat.name}
                  {seat.mine && <span className="ml-2 text-xs text-gold">tú</span>}
                </p>
                <p className="text-xs text-parchment-dim">Asiento {seat.seatIdx}</p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                {seat.kind !== 'empty' &&
                  (seat.ready ? (
                    <span className="text-gold">listo</span>
                  ) : (
                    <span className="text-parchment-dim">esperando</span>
                  ))}
                {isHost && seat.kind === 'human' && !seat.mine && !review && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => action('kick', { seat: seat.seatIdx })}
                    className="cursor-pointer rounded border border-blood/40 px-2 py-1 text-xs text-blood transition-colors hover:border-blood disabled:opacity-50"
                  >
                    Expulsar
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {error && (
        <p className="rounded border border-blood/40 bg-ink-soft px-4 py-3 text-sm text-blood">
          {error}
        </p>
      )}

      <section className="flex flex-wrap items-center gap-3">
        {review ? (
          <span className="text-sm text-parchment-dim">Vista de revisión: los botones descansan.</span>
        ) : view.mySeat < 0 ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => action('join')}
            className="cursor-pointer rounded border border-gold bg-gold px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-parchment disabled:cursor-wait disabled:opacity-60"
          >
            Sentarme
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => action(view.seats[view.mySeat]?.ready ? 'unready' : 'ready')}
              className="cursor-pointer rounded border border-gold/50 px-5 py-2.5 text-sm text-parchment transition-colors hover:border-gold hover:text-gold disabled:cursor-wait disabled:opacity-60"
            >
              {view.seats[view.mySeat]?.ready ? 'No estoy listo' : 'Estoy listo'}
            </button>
            {isHost && (
              <button
                type="button"
                disabled={busy}
                onClick={() => action('start')}
                className="cursor-pointer rounded border border-gold bg-gold px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-parchment disabled:cursor-wait disabled:opacity-60"
              >
                Arrancar la partida
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => action('leave')}
              className="cursor-pointer rounded border border-blood/40 px-4 py-2 text-xs text-blood transition-colors hover:border-blood disabled:opacity-50"
            >
              Salir de la sala
            </button>
          </>
        )}
        <Link className="text-sm text-gold underline-offset-4 hover:underline" href="/">
          Volver al panteón
        </Link>
      </section>

      <p className="text-xs text-parchment-dim">
        Reglas de la sala: solo el anfitrión expulsa y arranca; hace falta que todos marquen
        «listo». Quien abandone una partida en curso deja su asiento a un bot, y sus fieles siguen
        (§2).
      </p>
    </div>
  );
}
