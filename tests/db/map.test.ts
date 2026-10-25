import { describe, expect, it } from 'vitest';
import { planFor } from '../../lib/bots/policy';
import { digestState } from '../../lib/engine/digest';
import { activeSeats } from '../../lib/engine/ic';
import { resolveTurn } from '../../lib/engine/resolve';
import { MatchState } from '../../lib/engine/types';
import { divinityBand, rowsFromState, stateFromRows } from '../../lib/db/map';
import { createSoloState } from '../../lib/match/solo';

/**
 * El mapeo tiene que ser reversible: si un campo del motor se pierde por el
 * camino, la partida deja de reproducirse al recargar. La huella exacta es la
 * prueba.
 */

function roundtrip(state: MatchState): MatchState {
  const rows = rowsFromState(state, { mode: 'peor_carta', turnLimit: 12 });
  return stateFromRows({
    match: {
      id: '00000000-0000-4000-8000-000000000000',
      code: 'ABC234',
      status: state.finished ? 'finished' : 'orders',
      phase: state.finished ? 'finished' : 'orders',
      resolving: false,
      ...rows.match,
    } as Parameters<typeof stateFromRows>[0]['match'],
    seats: rows.seats,
    states: rows.states,
    publics: rows.publics,
    milestones: state.milestones,
  });
}

function withNoEvents(state: MatchState): MatchState {
  return { ...state, events: [] };
}

describe('mapeo estado ↔ filas', () => {
  it('una partida recién creada vuelve idéntica', () => {
    const state = createSoloState(4242);
    expect(digestState(roundtrip(state))).toBe(digestState(withNoEvents(state)));
  });

  it('tras varios turnos —con guerras, buffs o debuff— vuelve idéntica', () => {
    let state = createSoloState(99);
    for (let i = 0; i < 6; i += 1) {
      state = resolveTurn(state, activeSeats(state).map((seat) => planFor(state, seat)));
    }
    expect(digestState(roundtrip(state))).toBe(digestState(withNoEvents(state)));
  });

  it('conserva la política de ventana y el modo', () => {
    const state = createSoloState(7);
    const copy = roundtrip(state);
    expect(copy.windowPolicy).toBe(state.windowPolicy);
    expect(copy.fixedWindow).toBe(state.fixedWindow);
  });

  it('la banda de Divinidad es pública y no revela el nivel exacto', () => {
    expect(divinityBand(1)).toBe('baja');
    expect(divinityBand(3)).toBe('baja');
    expect(divinityBand(4)).toBe('media');
    expect(divinityBand(7)).toBe('media');
    expect(divinityBand(8)).toBe('alta');
  });
});
