import Link from 'next/link';
import { TurnScreen, type TurnChronicleLine } from '@/components/TurnScreen';
import { PEOR_CARTA, createSoloState, resolveSoloTurn } from '@/lib/match/solo';

/**
 * Vista de revisión de la pantalla de turno (§20) con datos de ejemplo.
 *
 * Existe para poder revisar la interfaz sin proyecto de Supabase: el estado se
 * genera con el motor real y tres turnos de bots, y no se escribe nada. El botón
 * de cerrar turno está desactivado a propósito.
 */

export default function TurnPreviewPage() {
  let state = createSoloState(2026);
  let lastChronicle: TurnChronicleLine | undefined;

  for (let i = 0; i < 3; i += 1) {
    const result = resolveSoloTurn(state, 0, [], undefined, PEOR_CARTA.turnLimit);
    state = result.state;
    lastChronicle = {
      turn: state.turn - 1,
      publicText: result.chronicle.publicText,
      privateText: result.chronicle.privateText,
    };
  }

  return (
    <div className="space-y-6">
      <section className="rounded border border-gold/40 bg-ink-soft px-4 py-3 text-sm">
        <p className="text-xs uppercase tracking-[0.22em] text-gold-soft">Vista de revisión</p>
        <p className="mt-1 text-parchment-dim">
          Datos de ejemplo generados por el motor, sin base de datos ni sesión. La partida real se
          crea desde el panteón con Supabase configurado.
        </p>
        <Link className="mt-2 inline-block text-gold underline-offset-4 hover:underline" href="/">
          Volver
        </Link>
      </section>

      <TurnScreen
        code="REV123"
        state={state}
        mySeat={0}
        turnLimit={PEOR_CARTA.turnLimit}
        finished={false}
        lastChronicle={lastChronicle}
        mode="review"
      />
    </div>
  );
}
