import { describe, expect, it } from 'vitest';
import { ACTIONS, isWindowAllowed } from '../../lib/engine/content';
import { activeSeats } from '../../lib/engine/ic';
import { problemFor } from '../../lib/engine/problems';
import { createInitialState, resolveTurn } from '../../lib/engine/resolve';
import { BEATS_PER_TURN, Order } from '../../lib/engine/types';
import { chooseProblemOption, personalityOf, planFor } from '../../lib/bots/policy';

const base = () => createInitialState({ seats: 8, humans: 0, seed: 3, unlockEvery: 5, horizonYears: 30 });

describe('política de los bots', () => {
  it('solo emite acciones legales', () => {
    let state = base();
    for (let turn = 0; turn < 25 && !state.finished; turn += 1) {
      const orders: Order[] = activeSeats(state).map((seat) => planFor(state, seat));
      for (const order of orders) {
        const seat = state.seats.find((s) => s.id === order.seatId);
        expect(seat).toBeDefined();
        const busyUntil: Record<string, number> = {};
        for (const item of order.plan) {
          const def = ACTIONS[item.action];
          expect(def, `acción desconocida: ${item.action}`).toBeDefined();
          expect(def?.channel).toBe(item.channel);
          expect(item.beat).toBeGreaterThanOrEqual(0);
          expect(item.beat).toBeLessThan(BEATS_PER_TURN);
          expect(isWindowAllowed(def!.minWindow, state.windowId)).toBe(true);
          if (def?.available) expect(def.available(seat!, state)).toBe(true);
          expect(busyUntil[item.channel] ?? -1).toBeLessThan(item.beat);
          busyUntil[item.channel] = item.beat + def!.beats - 1;
        }
      }
      state = resolveTurn(state, orders);
    }
  });

  it('es determinista: mismo estado, mismas órdenes', () => {
    const state = base();
    const seat = activeSeats(state)[2]!;
    expect(planFor(state, seat)).toEqual(planFor(state, seat));
  });

  it('no conoce el Fe de los rivales', () => {
    const state = base();
    const seat = activeSeats(state)[0]!;
    const clone = structuredClone(state);
    for (const other of clone.seats) if (other.id !== seat.id) other.fe = 999_999;
    expect(planFor(clone, clone.seats[0]!)).toEqual(planFor(state, seat));
  });

  it('usa al menos tres compases por turno', () => {
    const state = base();
    const plans = activeSeats(state).map((seat) => planFor(state, seat));
    const average = plans.reduce((acc, p) => acc + p.plan.length, 0) / plans.length;
    expect(average).toBeGreaterThanOrEqual(3);
  });
});

describe('dificultades (§17.1, D63)', () => {
  it('el Corrupto solo ve bandas: dentro de la misma banda el plan no cambia', () => {
    const state = base();
    const seat = activeSeats(state)[3]!;
    const rival = state.seats.find((s) => s.id !== seat.id)!;
    rival.divinity = 4; // banda media
    const withFour = planFor(state, seat, 'corrupto');
    rival.divinity = 7; // sigue siendo banda media
    const withSeven = planFor(state, seat, 'corrupto');
    expect(withSeven).toEqual(withFour);
  });

  it('el Normal no mira a los rivales ni siquiera en banda', () => {
    const state = base();
    const seat = activeSeats(state)[0]!;
    const clone = structuredClone(state);
    for (const other of clone.seats) if (other.id !== seat.id) other.divinity = 10;
    expect(planFor(clone, clone.seats[0]!, 'normal')).toEqual(planFor(state, seat, 'normal'));
  });
});

describe('sabores acotados (D65)', () => {
  it('ninguna acción con tope supera su máximo por turno', () => {
    let state = base();
    for (let turn = 0; turn < 12 && !state.finished; turn += 1) {
      const orders: Order[] = activeSeats(state).map((seat) => planFor(state, seat));
      for (const order of orders) {
        const counts: Record<string, number> = {};
        for (const item of order.plan) counts[item.action] = (counts[item.action] ?? 0) + 1;
        // Topes de sabor: la expansión y el farol, 1; el milagro, 2. La
        // bendición no lleva tope: solo rellena y la limita el canal obra.
        expect(counts.expandir ?? 0).toBeLessThanOrEqual(1);
        expect(counts.milagro ?? 0).toBeLessThanOrEqual(2);
        expect(counts.profecia ?? 0).toBeLessThanOrEqual(1);
        expect(counts.bendicion ?? 0).toBeLessThanOrEqual(4);
      }
      state = resolveTurn(state, orders);
    }
  });
});

describe('problemas de era (D64, cierra D51)', () => {
  it('elige una opción asequible del problema del turno y es determinista', () => {
    const state = base();
    const seat = activeSeats(state)[1]!;
    const problem = problemFor(state);
    const choice = chooseProblemOption(state, seat);
    expect(choice).toBeDefined();
    const option = problem.options.find((item) => item.id === choice);
    expect(option).toBeDefined();
    expect(seat.fe).toBeGreaterThanOrEqual(option!.cost);
    expect(chooseProblemOption(state, seat)).toBe(choice);
  });

  it('sin Fe solo puede elegir opciones gratis', () => {
    const state = base();
    const seat = { ...activeSeats(state)[2]!, fe: 0 };
    const choice = chooseProblemOption(state, seat);
    if (choice !== undefined) {
      const option = problemFor(state).options.find((item) => item.id === choice);
      expect(option?.cost).toBe(0);
    }
  });

  it('las personalidades no eligen todas lo mismo', () => {
    let differ = false;
    let state = base();
    for (let turn = 0; turn < 30 && !differ && !state.finished; turn += 1) {
      const seats = activeSeats(state);
      const choices = new Map<string, string | undefined>();
      for (const seat of seats) {
        const personality = personalityOf(seat);
        if (!choices.has(personality)) choices.set(personality, chooseProblemOption(state, seat));
      }
      if (choices.size >= 2 && new Set([...choices.values()].filter(Boolean)).size >= 2) differ = true;
      state = resolveTurn(state, seats.map((seat) => planFor(state, seat)));
    }
    expect(differ).toBe(true);
  });
});
