import Link from 'next/link';
import type { ArchivedView } from '@/lib/db/matches';

const MODE_LABEL: Record<string, string> = {
  peor_carta: 'La peor carta',
  multi: 'Partida con amigos',
};

const ERA_LABEL: Record<string, string> = {
  tribal: 'Tribal',
  reinos: 'Grandes Reinos',
  modernidad: 'Modernidad',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Ficha de una partida archivada por la regla de retención (REGLAS.md §21.2):
 * quedan el resumen y los jugadores, no el detalle. El panteón sigue
 * enlazando aquí para que la memoria no desaparezca con la crónica.
 */
export function ArchivedMatch({ archived }: { archived: ArchivedView }) {
  const summary = archived.summary;
  const rows: { label: string; value: string }[] = summary
    ? [
        {
          label: 'Modo',
          value: MODE_LABEL[summary.mode ?? ''] ?? summary.mode ?? '—',
        },
        { label: 'Asientos', value: summary.seats !== null ? String(summary.seats) : '—' },
        { label: 'Turnos jugados', value: summary.turns !== null ? String(summary.turns) : '—' },
        {
          label: 'Ganador',
          value: summary.winnerName ?? (summary.winnerSeat !== null ? `Asiento ${summary.winnerSeat + 1}` : 'Sin ganador'),
        },
        { label: 'Era final', value: ERA_LABEL[summary.era ?? ''] ?? summary.era ?? '—' },
        { label: 'Cerrada', value: formatDate(archived.closedAt ?? summary.closedAt) },
      ]
    : [];

  return (
    <section className="space-y-6">
      <div className="space-y-3">
        <p className="text-xs uppercase tracking-[0.25em] text-gold-soft">Partida archivada</p>
        <h2 className="font-display text-3xl text-parchment">Mesa {archived.code}</h2>
      </div>

      {rows.length > 0 ? (
        <dl className="grid gap-3 rounded-lg border border-gold/25 bg-ink-soft p-6 text-sm sm:grid-cols-2">
          {rows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-4 sm:block">
              <dt className="text-xs uppercase tracking-widest text-gold-soft">{row.label}</dt>
              <dd className="mt-1 text-parchment-dim sm:mt-0">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="max-w-prose text-parchment-dim">
          Esta partida terminó hace más de treinta días y su crónica fue archivada.
        </p>
      )}

      <p className="max-w-prose text-sm text-parchment-dim">
        La retención del servicio gratuito guarda el resumen de cada partida cerrada y libera el
        detalle (crónica, eventos y órdenes) para que la base quepa en el plan gratuito
        (REGLAS.md §21.2). El *replay* completo ya no está disponible; la mesa y sus jugadores
        siguen en el registro.
      </p>

      <Link className="text-sm text-gold underline-offset-4 hover:underline" href="/">
        Volver al panteón
      </Link>
    </section>
  );
}
