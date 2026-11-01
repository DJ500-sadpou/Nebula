import { describe, expect, it } from 'vitest';
import { planFor } from '../../lib/bots/policy';
import { digestState } from '../../lib/engine/digest';
import { activeSeats } from '../../lib/engine/ic';
import { createInitialState, resolveTurn } from '../../lib/engine/resolve';
import { MatchState, WINDOW_LADDER, WindowId } from '../../lib/engine/types';

/**
 * Golden tests: huella de partidas completas con semilla fija.
 *
 * Si un número, una regla o un orden de resolución cambia sin querer, estas
 * huellas cambian y el test revienta. Regenerarlas es una decisión consciente:
 * hay que decir por qué cambió la partida, no borrar el valor.
 *
 * Regeneradas en Fase 2 al añadir `windowPolicy` y `fixedWindow` al estado: la
 * huella cubre el estado serializado, así que dos campos nuevos la cambian
 * aunque la partida sea idéntica.
 *
 * Regeneradas de nuevo en Fase 6 (DECISIONES D65, D66 y D67) por el reequilibrio
 * de personalidades (sabores acotados, problemas de era para bots, costes de
 * `investigar`/`hito cultural`) y por el campo `awakened` del asiento, que
 * entra en la huella. La partida se movió poco y nada al azar: mismas turnadas
 * (39/41/43), mismas eras, mismas ventanas y mismo ganador en 1 y 42; el cambio
 * de verdad es el ganador de la semilla 7 (asiento 0 → 1) y un evento más en
 * la 42. La banda §18 se re-midió completa con la nueva política (REGLAS §18.1).
 */

function play(seed: number) {
  let state = createInitialState({
    seats: 6,
    humans: 3,
    seed,
    unlockEvery: 5,
    horizonYears: 30,
    tableVoters: 3,
  });
  for (let i = 0; i < 60 && !state.finished; i += 1) {
    state = resolveTurn(state, activeSeats(state).map((seat) => planFor(state, seat)));
  }
  return state;
}

const GOLDEN: Record<number, { digest: string; turns: number; era: string; events: number; winner: number }> = {
  1: { digest: '52eac5ae4f885ad6', turns: 39, era: 'modernidad', events: 55, winner: 3 },
  7: { digest: '2cb7b59b4ce4972b', turns: 41, era: 'modernidad', events: 57, winner: 1 },
  42: { digest: 'f1b6ed780e787d70', turns: 43, era: 'modernidad', events: 60, winner: 3 },
};

describe('golden: partidas completas', () => {
  for (const [seedText, expected] of Object.entries(GOLDEN)) {
    const seed = Number(seedText);
    it(`semilla ${seed} reproduce su huella exacta`, () => {
      const state = play(seed);
      expect(digestState(state)).toBe(expected.digest);
      expect(state.turn - 1).toBe(expected.turns);
      expect(state.era).toBe(expected.era);
      expect(state.events).toHaveLength(expected.events);
      expect(state.winnerSeat).toBe(expected.winner);
      expect(state.finished).toBe(true);
    });
  }

  it('las tres semillas producen partidas distintas entre sí', () => {
    const digests = Object.keys(GOLDEN).map((seed) => digestState(play(Number(seed))));
    expect(new Set(digests).size).toBe(digests.length);
  });

  it('una partida completa nunca deja Fe fraccionario ni fuera de tope', () => {
    for (const seed of Object.keys(GOLDEN).map(Number)) {
      const state = play(seed);
      for (const seat of state.seats) {
        expect(Number.isInteger(seat.fe), `semilla ${seed}, asiento ${seat.id}`).toBe(true);
        expect(seat.fe).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

/**
 * Un golden por ventana: misma semilla, misma mesa y mismas decisiones; lo único
 * que cambia es el ritmo. Prueba que las siete ventanas son jugables de punta a
 * punta y que la ventana pesa en el resultado (§5-A.6).
 */
const WINDOW_SEED = 2026;
const WINDOW_TURNS = 24;

function playWindow(windowId: WindowId): { state: MatchState; turns: number } {
  let state = createInitialState({
    seats: 6,
    humans: 3,
    seed: WINDOW_SEED,
    unlockEvery: 5,
    horizonYears: 30,
    tableVoters: 3,
    fixedWindow: windowId,
  });
  let turns = 0;
  while (!state.finished && turns < WINDOW_TURNS) {
    state = resolveTurn(state, activeSeats(state).map((seat) => planFor(state, seat)));
    turns += 1;
  }
  return { state, turns };
}

const WINDOW_GOLDEN: Record<WindowId, { digest: string; turns: number; fictionDay: number; era: string }> = {
  '1d': { digest: '3d7c0acfc349678f', turns: 24, fictionDay: 24, era: 'tribal' },
  '7d': { digest: '547b2c830b505a6b', turns: 24, fictionDay: 168, era: 'reinos' },
  '30d': { digest: '804b3f2b270a9923', turns: 24, fictionDay: 720, era: 'modernidad' },
  '3m': { digest: 'd44f0ed0bb0ead48', turns: 24, fictionDay: 2184, era: 'modernidad' },
  '6m': { digest: '8d3ae3b391ab0c03', turns: 24, fictionDay: 4368, era: 'modernidad' },
  '1y': { digest: 'a566d87b1bea4eb3', turns: 24, fictionDay: 8760, era: 'modernidad' },
  '3y': { digest: '5d4ba7bccb1e67c4', turns: 10, fictionDay: 10950, era: 'reinos' },
};

describe('golden: una partida por ventana', () => {
  for (const windowId of WINDOW_LADDER) {
    const expected = WINDOW_GOLDEN[windowId];
    it(`la ventana ${windowId} reproduce su huella exacta`, () => {
      const { state, turns } = playWindow(windowId);
      expect(digestState(state)).toBe(expected.digest);
      expect(turns).toBe(expected.turns);
      expect(state.fictionDay).toBe(expected.fictionDay);
      expect(state.era).toBe(expected.era);
      expect(state.windowId).toBe(windowId);
    });
  }

  it('las siete ventanas dan partidas distintas entre sí', () => {
    const digests = WINDOW_LADDER.map((windowId) => digestState(playWindow(windowId).state));
    expect(new Set(digests).size).toBe(WINDOW_LADDER.length);
  });

  it('la ventana corta apenas mueve el calendario y la larga cierra el horizonte', () => {
    const short = playWindow('1d').state;
    const long = playWindow('3y').state;
    expect(short.fictionDay).toBeLessThan(365);
    expect(long.finished).toBe(true);
    expect(long.fictionDay).toBeGreaterThanOrEqual(30 * 365);
  });
});
