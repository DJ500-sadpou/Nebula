'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { WindowId } from '@/lib/engine/types';
import { WINDOWS } from '@/lib/engine/types';

export interface BallotPanelProps {
  code: string;
  /** Opciones legales de la papeleta (A.2.1: escalera + techo de guerra). */
  options: WindowId[];
  /** Ventana en curso. */
  current: WindowId;
  /** Ventana propuesta y asiento que la abrió, si la papeleta está abierta. */
  proposal: WindowId | null;
  proposerSeat: number | null;
  /** Voto propio en la papeleta abierta. */
  myVote: WindowId | null;
  /** Resultado del turno anterior, ya publicado con la crónica (A.2.7). */
  last: { turn: number; status: string; resultWindow: WindowId | null } | null;
  /** Un choque impone la ventana (A.11): no se vota. */
  forced: boolean;
  /** La vista de revisión no envía nada. */
  disabled?: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  passed: 'aprobada',
  rejected: 'rechazada',
  tie: 'empate',
  quorum_failed: 'sin votos',
};

/**
 * Papeleta de ventana (§5-A.2, Fase 4). Proponer abre la papeleta; los votos
 * son secretos hasta el cierre y el resultado se aplica al turno siguiente.
 */
export function BallotPanel({
  code,
  options,
  current,
  proposal,
  proposerSeat,
  myVote,
  last,
  forced,
  disabled = false,
}: BallotPanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const router = useRouter();

  if (forced) {
    return (
      <section className="rounded-lg border border-blood/40 bg-ink-soft p-5">
        <p className="text-xs uppercase tracking-[0.22em] text-gold-soft">Ventana forzada</p>
        <p className="mt-2 text-sm text-parchment-dim">
          El mundo se ha sobresaltado: un choque de civilizaciones detiene el tiempo y la ventana
          está fijada a 1 día, sin votación (§5-A.11). La papeleta volverá al agotarse.
        </p>
      </section>
    );
  }

  const canPropose = !proposal && options.filter((option) => option !== current).length > 0;

  async function vote(windowId: WindowId) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const response = await fetch(`/api/match/${code}/vote`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ windowId }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        status?: string;
        waking?: boolean;
      };
      if (!response.ok) {
        const reason = payload.error ?? 'failed';
        const text = payload.waking
          ? 'El servidor está despertando: el voto no llegó a guardarse, reintenta en unos segundos.'
          : reason === 'illegal_window'
            ? 'Esa ventana aún no está desbloqueada o la guerra la prohíbe (§5-A.11).'
            : reason === 'same_window'
              ? 'Proponer la ventana actual no abre papeleta: no hay nada que decidir.'
              : reason === 'forced_window'
                ? 'La ventana está forzada: este turno no se vota.'
                : `No se pudo votar (${reason}).`;
        setError(text);
        router.refresh();
        return;
      }
      setNote(
        payload.status === 'proposed'
          ? `Papeleta abierta: propones «${WINDOWS[windowId].label}». Los votos son secretos hasta el cierre.`
          : payload.status === 'changed'
            ? 'Voto cambiado. Se puede cambiar hasta que el turno se resuelva.'
            : 'Voto emitido. Se puede cambiar hasta que el turno se resuelva.',
      );
      router.refresh();
    } catch {
      setError('No se pudo contactar con el servidor.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-gold/25 bg-ink-soft p-5">
      <p className="text-xs uppercase tracking-[0.22em] text-gold-soft">
        Papeleta de ventana · juega «{WINDOWS[current].label}»
      </p>

      {last && (
        <p className="mt-2 text-sm text-parchment-dim">
          Turno {last.turn}: papeleta {STATUS_LABEL[last.status] ?? last.status}
          {last.resultWindow ? ` — la mesa juega «${WINDOWS[last.resultWindow].label}»` : ' — la ventana no cambió'}.
          Los votos se publican con la crónica.
        </p>
      )}

      {proposal ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-parchment">
            Papeleta abierta: el asiento {proposerSeat} propone «{WINDOWS[proposal].label}».
          </p>
          <div className="flex flex-wrap gap-2">
            {options.map((option) => (
              <button
                key={option}
                type="button"
                disabled={busy || disabled}
                onClick={() => vote(option)}
                className={`cursor-pointer rounded border px-3 py-1.5 text-xs transition-colors disabled:cursor-wait disabled:opacity-50 ${
                  myVote === option
                    ? 'border-gold bg-gold/15 text-gold'
                    : 'border-gold/30 text-parchment hover:border-gold hover:text-gold'
                }`}
              >
                {myVote === option ? '✓ ' : ''}
                {WINDOWS[option].label}
              </button>
            ))}
          </div>
          <p className="text-xs text-parchment-dim">
            Solo votan los humanos (A.2.3). Mayoría simple de los votos emitidos; empate o sin
            votos, se mantiene la actual (A.2.4). El resultado entra al turno siguiente (A.2.5).
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {canPropose ? (
            <>
              <p className="text-sm text-parchment-dim">
                Nadie ha propuesto. Puedes proponer ventana al inicio del turno (A.2.1); si nadie
                propone, todo sigue igual (A.2.8).
              </p>
              <div className="flex flex-wrap gap-2">
                {options
                  .filter((option) => option !== current)
                  .map((option) => (
                    <button
                      key={option}
                      type="button"
                      disabled={busy || disabled}
                      onClick={() => vote(option)}
                      className="cursor-pointer rounded border border-gold/30 px-3 py-1.5 text-xs text-parchment transition-colors hover:border-gold hover:text-gold disabled:cursor-wait disabled:opacity-50"
                    >
                      Proponer «{WINDOWS[option].label}»
                    </button>
                  ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-parchment-dim">
              No hay papeleta abierta y la escalera no ofrece otra ventana aún.
            </p>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-blood">{error}</p>}
      {note && <p className="mt-3 text-sm text-gold-soft">{note}</p>}
    </section>
  );
}
