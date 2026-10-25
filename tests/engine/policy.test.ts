import { describe, expect, it } from 'vitest';
import { ACTIONS, isWindowAllowed } from '../../lib/engine/content';
import { activeSeats } from '../../lib/engine/ic';
import { createInitialState, resolveTurn } from '../../lib/engine/resolve';
import { BEATS_PER_TURN, Order } from '../../lib/engine/types';
import { planFor } from '../../lib/bots/policy';

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
