import { describe, expect, it } from 'vitest';
import { planFor } from '../../lib/bots/policy';
import { digestState } from '../../lib/engine/digest';
import { activeSeats } from '../../lib/engine/ic';
import {
  PROBLEMS,
  applyProblemChoice,
  problemFor,
  problemView,
  problemsForEra,
} from '../../lib/engine/problems';
import { createInitialState, resolveTurn } from '../../lib/engine/resolve';
import { ERAS } from '../../lib/engine/types';
import { makeSeat, makeState } from '../helpers';

describe('problemas de era (§15)', () => {
  it('hay seis problemas, dos por era y tres opciones por problema', () => {
    expect(PROBLEMS).toHaveLength(6);
    for (const era of ERAS) {
      const list = problemsForEra(era.id);
      expect(list).toHaveLength(2);
      for (const problem of list) {
        expect(problem.options).toHaveLength(3);
        expect(new Set(problem.options.map((option) => option.id)).size).toBe(3);
      }
    }
    expect(new Set(PROBLEMS.map((problem) => problem.id)).size).toBe(PROBLEMS.length);
  });

  it('el problema del turno es determinista y de la era correcta', () => {
    const state = makeState([makeSeat()], { seed: 9, turn: 4, era: 'reinos' });
    const first = problemFor(state);
    expect(first.era).toBe('reinos');
    expect(problemFor(structuredClone(state)).id).toBe(first.id);
  });

  it('la vista lleva los costes ya calculados y marca lo inasequible', () => {
    const poor = makeSeat({ fe: 0 });
    const state = makeState([poor], { seed: 3, turn: 1, era: 'tribal' });
    const view = problemView(state, poor);
    expect(view.options).toHaveLength(3);
    for (const option of view.options) {
      expect(option.cost).toBeGreaterThanOrEqual(0);
      expect(option.affordable).toBe(poor.fe >= option.cost);
    }
  });

  it('elegir una opción cobra su coste y aplica su efecto', () => {
    const seat = makeSeat({ fe: 100, believers: 500, fidelity: 0.6 });
    const state = makeState([seat], { seed: 3, turn: 1, era: 'tribal' });
    const problem = problemFor(state);
    const paid = problem.options.find((option) => option.cost > 0) ?? problem.options[0]!;

    const before = { fe: seat.fe, believers: seat.believers, fidelity: seat.fidelity };
    expect(applyProblemChoice(state, seat, paid.id)).toBe(true);
    expect(seat.fe).toBeLessThanOrEqual(before.fe);
    expect(seat.fidelity).toBeGreaterThanOrEqual(0.1);
    expect(seat.believers).toBeGreaterThanOrEqual(1);
  });

  it('sin Fe no se puede pagar la opción y el estado no cambia', () => {
    const seat = makeSeat({ fe: 0, believers: 500 });
    const state = makeState([seat], { seed: 3, turn: 1, era: 'tribal' });
    const problem = problemFor(state);
    const paid = problem.options.find((option) => option.cost > 0)!;
    const before = structuredClone(seat);
    expect(applyProblemChoice(state, seat, paid.id)).toBe(false);
    expect(seat).toEqual(before);
  });

  it('una opción que no es del problema del turno se descarta', () => {
    const seat = makeSeat({ fe: 1_000 });
    const state = makeState([seat], { seed: 3, turn: 1, era: 'reinos' });
    const before = structuredClone(seat);
    expect(applyProblemChoice(state, seat, 'huelga')).toBe(false);
    expect(seat).toEqual(before);
  });

  it('la orden aplica la elección durante la resolución', () => {
    const base = createInitialState({
      seats: 4,
      humans: 1,
      seed: 55,
      unlockEvery: 3,
      horizonYears: 30,
      tableVoters: 1,
    });
    const seat = base.seats[0]!;
    seat.fe = 5_000;
    const problem = problemFor(base);
    const paid = problem.options.find((option) => option.cost > 0)!;
    const orders = activeSeats(base).map((item) =>
      item.id === seat.id
        ? { seatId: item.id, plan: [], problemOption: paid.id }
        : planFor(base, item),
    );
    const withChoice = resolveTurn(base, orders);
    const withoutChoice = resolveTurn(base, [
      { seatId: seat.id, plan: [] },
      ...orders.slice(1),
    ]);

    expect(digestState(withChoice)).not.toBe(digestState(withoutChoice));
  });

  it('sin elección el turno se resuelve exactamente como antes de los problemas', () => {
    const base = createInitialState({
      seats: 4,
      humans: 0,
      seed: 77,
      unlockEvery: 5,
      horizonYears: 30,
    });
    const orders = activeSeats(base).map((seat) => planFor(base, seat));
    const first = resolveTurn(base, orders);
    const second = resolveTurn(base, orders);
    expect(digestState(first)).toBe(digestState(second));
  });
});
