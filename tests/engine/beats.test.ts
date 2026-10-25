import { describe, expect, it } from 'vitest';
import { planFor } from '../../lib/bots/policy';
import { copyState } from '../../lib/engine/resolve';
import { digestState } from '../../lib/engine/digest';
import { activeSeats } from '../../lib/engine/ic';
import { capFe, incomeTurn } from '../../lib/engine/economy';
import {
  applyBeat,
  createInitialState,
  planBeatPhase,
  resolveBeats,
  resolveTurn,
} from '../../lib/engine/resolve';
import { BEATS_PER_TURN, MatchState, WINDOW_LADDER, WINDOWS, WindowId } from '../../lib/engine/types';
import { makeSeat, makeState } from '../helpers';

/**
 * §5-A.3/§5-A.12: el turno son ocho compases.
 *
 * La equivalencia se comprueba en la fase de compases (ingreso + acciones), que
 * es la única que se reparte por compás: el crecimiento (§4.4), el evento
 * mundial y la época son por turno, por diseño.
 */

function fixedMatch(windowId: WindowId, seed = 77): MatchState {
  return createInitialState({
    seats: 6,
    humans: 3,
    seed,
    unlockEvery: 5,
    horizonYears: 30,
    tableVoters: 3,
    fixedWindow: windowId,
  });
}

function richSeat() {
  // Divinidad 11 y 100 fieles: el tope (≈152 000) no recorta el ingreso de un
  // trienio (5 548), así que se mide la liberación por compás sin ruido.
  return makeSeat({ fe: 0, divinity: 11, believers: 100, fidelity: 0.8 });
}

describe('compases (§5-A.3)', () => {
  it('un trienio de 8 compases da el mismo estado que 8 sub-turnos de un compás', () => {
    for (const windowId of WINDOW_LADDER) {
      const state = fixedMatch(windowId);
      const orders = activeSeats(state).map((seat) => planFor(state, seat));
      const days = WINDOWS[windowId].days;
      expect(orders.some((order) => order.plan.length > 0)).toBe(true);

      const inOneGo = copyState(state);
      resolveBeats(inOneGo, orders, planBeatPhase(inOneGo, days));

      const inSubTurns = copyState(state);
      const phase = planBeatPhase(inSubTurns, days);
      for (let beat = 0; beat < BEATS_PER_TURN; beat += 1) {
        resolveBeats(inSubTurns, orders, phase, [beat]);
      }

      expect(digestState(inSubTurns), `ventana ${windowId}`).toBe(digestState(inOneGo));
    }
  });

  it('la misma fase de compases es idéntica en un turno real y partida en dos mitades', () => {
    const state = fixedMatch('3y');
    const orders = activeSeats(state).map((seat) => planFor(state, seat));
    const days = WINDOWS['3y'].days;

    const whole = copyState(state);
    resolveBeats(whole, orders, planBeatPhase(whole, days));

    const split = copyState(state);
    const phase = planBeatPhase(split, days);
    resolveBeats(split, orders, phase, [0, 1, 2, 3]);
    resolveBeats(split, orders, phase, [4, 5, 6, 7]);

    expect(digestState(split)).toBe(digestState(whole));
  });

  it('el sobrante del ingreso entra en el último compás y no se pierde Fe', () => {
    const state = makeState([richSeat()], { windowId: '3y' });
    const phase = { income: new Map([[0, 10]]), busyUntil: new Map<string, number>() };
    const seen: number[] = [];
    for (let beat = 0; beat < BEATS_PER_TURN; beat += 1) {
      applyBeat(state, beat, [], phase);
      seen.push(state.seats[0]!.fe);
    }
    // 10 / 8 = 1 por compás y 2 de sobrante: el último compás cobra 3.
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 10]);
  });

  it('ninguna ventana pierde Fe al repartir el ingreso en compases', () => {
    for (const windowId of WINDOW_LADDER) {
      const state = makeState([richSeat()], { windowId });
      const seat = state.seats[0]!;
      const days = WINDOWS[windowId].days;
      resolveBeats(state, [], planBeatPhase(state, days));
      expect(seat.fe, `ventana ${windowId}`).toBe(Math.floor(incomeTurn(seat, days)));
    }
  });

  it('en un compás cabe una sola acción por canal', () => {
    const state = makeState([makeSeat({ fe: 1_000, divinity: 11 })]);
    const phase = { income: new Map([[0, 0]]), busyUntil: new Map<string, number>() };
    const orders = [
      {
        seatId: 0,
        plan: [
          { beat: 0, channel: 'milagro' as const, action: 'milagro' },
          { beat: 0, channel: 'milagro' as const, action: 'milagro' },
        ],
      },
    ];
    applyBeat(state, 0, orders, phase);
    expect(state.seats[0]!.fame).toBe(2);
    expect(state.seats[0]!.fe).toBe(990);
  });

  it('una obra de dos compases ocupa el canal y libera el siguiente', () => {
    // `templo` pide ventana de 30d o más (§5-A.4).
    const state = makeState([makeSeat({ fe: 1_000, divinity: 11 })], { windowId: '30d' });
    const phase = { income: new Map([[0, 0]]), busyUntil: new Map<string, number>() };
    const plan = (beat: number) => [
      { seatId: 0, plan: [{ beat, channel: 'obra' as const, action: 'templo' }] },
    ];

    applyBeat(state, 1, plan(1), phase);
    expect(state.seats[0]!.temples).toBe(1);

    applyBeat(state, 2, plan(2), phase);
    expect(state.seats[0]!.temples).toBe(1);

    applyBeat(state, 3, plan(3), phase);
    expect(state.seats[0]!.temples).toBe(2);
  });

  it('la rejilla de 8 compases es la misma en la ventana más corta y en la más larga', () => {
    const run = (windowId: WindowId) => {
      const state = makeState([makeSeat({ fe: 5_000, divinity: 11 })], { windowId });
      const orders = [
        {
          seatId: 0,
          plan: Array.from({ length: BEATS_PER_TURN }, (_, beat) => ({
            beat,
            channel: 'palabra' as const,
            action: 'investigar',
          })),
        },
      ];
      resolveBeats(state, orders, planBeatPhase(state, WINDOWS[windowId].days));
      return state.seats[0]!;
    };

    expect(run('1d').techs).toHaveLength(BEATS_PER_TURN);
    expect(run('3y').techs).toHaveLength(BEATS_PER_TURN);
  });

  it('cada compás respeta el tope de Fe', () => {
    const seat = makeSeat({ fe: 0, divinity: 3, believers: 300, fidelity: 1 });
    const cap = capFe(seat);
    const state = makeState([seat], { windowId: '3y' });
    const phase = { income: new Map([[0, cap * 5]]), busyUntil: new Map<string, number>() };
    resolveBeats(state, [], phase);
    expect(state.seats[0]!.fe).toBe(cap);
  });

  it('un turno de 3y avanza 1 095 días y ninguno de sus compases se pierde', () => {
    const state = fixedMatch('3y');
    const next = resolveTurn(state, activeSeats(state).map((seat) => planFor(state, seat)));
    expect(next.fictionDay - state.fictionDay).toBe(WINDOWS['3y'].days);
    expect(WINDOWS['3y'].days % BEATS_PER_TURN).not.toBe(0); // 136,875 días por compás
    expect((WINDOWS['3y'].days / BEATS_PER_TURN) * BEATS_PER_TURN).toBe(WINDOWS['3y'].days);
  });
});
