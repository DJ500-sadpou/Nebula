import { AutoRefresh } from './AutoRefresh';
import { RetryButton } from './RetryButton';

/**
 * Página de estado honesta (PLAN.md §2.2.2, §5 y §6 Fase 7; REGLAS.md §21.3):
 * cuando Supabase está despertando tras una pausa, la primera petición falla y
 * esto es lo que se ve en lugar de un error genérico.
 *
 * El reintento automático es más rápido que el de la mesa (15 s en vez de
 * 30 s) y se autoextingue: en cuanto la base responde, la página vuelve a su
 * versión normal y el refresco cesa (D70). Solo está activo mientras dura el
 * despertar, así que el presupuesto de requests de D55 queda intacto.
 */
export function WakingNotice({ seconds = 15 }: { seconds?: number }) {
  return (
    <section className="space-y-6">
      <AutoRefresh seconds={seconds} />
      <div className="space-y-4">
        <p className="text-xs uppercase tracking-[0.25em] text-gold-soft">Estado del servidor</p>
        <h2 className="font-display text-3xl leading-tight text-parchment sm:text-4xl">
          El servidor está despertando
        </h2>
        <p className="max-w-prose text-parchment-dim">
          El mundo duerme entre partidas y la primera visita de la temporada tiene que despertarlo
          (REGLAS.md §21.3). No es un error del juego ni de tus órdenes: la página se reintenta
          sola y, en unos segundos, la mesa vuelve a aparecer aquí tal como la dejaste.
        </p>
      </div>

      <div className="rounded-lg border border-gold/25 bg-ink-soft p-6">
        <h3 className="font-display text-lg text-gold">Qué está pasando</h3>
        <p className="mt-2 text-sm text-parchment-dim">
          La base de datos gratuita del proyecto se pausa tras siete días sin actividad. El ping
          diario la mantiene despierta; si aun así despierta ahora, lo que ves es el primer
          trago de café. Si pasados unos minutos no vuelve, el paso de restauración está
          documentado en el README: se reactiva el proyecto desde el panel de Supabase y se
          recarga esta página.
        </p>
        <div className="mt-4">
          <RetryButton />
        </div>
      </div>
    </section>
  );
}
