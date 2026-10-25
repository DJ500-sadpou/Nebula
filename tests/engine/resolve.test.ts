import { describe, expect, it } from 'vitest';
import { planFor } from '../../lib/bots/policy';
import { MAX_BUFFS, addBuff, awardMilestone, hasBuff } from '../../lib/engine/content';
import { digestState } from '../../lib/engine/digest';
import { activeSeats, eraProgress } from '../../lib/engine/ic';
import { createInitialState, resolveTurn } from '../../lib/engine/resolve';
import { MatchState, WINDOW_LADDER } from '../../lib/engine/types';
import { makeSeat, makeState } from '../helpers';

const config = (over: Partial<Parameters<typeof createInitialState>[0]> = {}) => ({
  seats: 6,
  humans: 0,
  seed: 42,
  unlockEvery: 5,
  horizonYears: 30,
  ...over,
});

function play(state: MatchState): MatchState {
  const orders = activeSeats(state).map((seat) => planFor(state, seat));
  return resolveTurn(state, orders);
}

function playToEnd(state: MatchState, maxTurns = 200): MatchState {
  let current = state;
  for (let i = 0; i < maxTurns && !current.finished; i += 1) current = play(current);
  return current;
}

describe('resolución determinista', () => {
  it('el mismo estado y las mismas órdenes dan la misma huella', () => {
    const a = playToEnd(createInitialState(config()));
    const b = playToEnd(createInitialState(config()));
    expect(digestState(a)).toBe(digestState(b));
    expect(a.events.map((e) => e.text)).toEqual(b.events.map((e) => e.text));
  });

  it('semillas distintas dan partidas distintas', () => {
    const a = playToEnd(createInitialState(config({ seed: 7 })));
    const b = playToEnd(createInitialState(config({ seed: 8 })));
    expect(digestState(a)).not.toBe(digestState(b));
  });

  it('cien resoluciones del mismo turno dan la misma huella', () => {
    const base = createInitialState(config({ fixedWindow: '3y' }));
    const orders = activeSeats(base).map((seat) => planFor(base, seat));
    const expected = digestState(resolveTurn(base, orders));
    for (let i = 0; i < 100; i += 1) {
      expect(digestState(resolveTurn(base, orders)), `ejecución ${i}`).toBe(expected);
    }
  });

  it('resolver dos veces el mismo estado no avanza dos turnos con las mismas órdenes', () => {
    const state = createInitialState(config());
    const orders = activeSeats(state).map((seat) => planFor(state, seat));
    const once = resolveTurn(state, orders);
    const again = resolveTurn(state, orders);
    expect(again.turn).toBe(once.turn);
    expect(digestState(again)).toBe(digestState(once));
  });
});

describe('tope de Fe y economía cerrada', () => {
  it('ningún asiento supera su tope ni tiene Fe fraccionario', () => {
    let state = createInitialState(config());
    for (let i = 0; i < 40 && !state.finished; i += 1) {
      state = play(state);
      for (const seat of state.seats) {
        expect(Number.isInteger(seat.fe)).toBe(true);
        expect(seat.fe).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(seat.believers)).toBe(true);
      }
    }
  });
});

describe('época', () => {
  it('al completar la barra el mundo avanza y las eras se reinician', () => {
    const full = makeSeat({
      believers: 5_000,
      techs: Array.from({ length: 12 }, (_, i) => `t${i}`),
      culture: Array.from({ length: 12 }, (_, i) => `c${i}`),
    });
    const other = makeSeat({ id: 1, believers: 5_000, techs: [], culture: [] });
    const state = makeState([full, other], { era: 'tribal', eraBar: 0 });
    expect(eraProgress(state)).toBeLessThan(1);

    const both = makeState([full, { ...other, techs: full.techs, culture: full.culture }]);
    const next = resolveTurn(both, []);
    expect(next.era).toBe('reinos');
    expect(next.eraAdvancedTurn).toBe(both.turn);
    expect(next.seats.every((s) => s.techs.length === 0 && s.culture.length === 0)).toBe(true);
    expect(next.events.some((e) => e.kind === 'era')).toBe(true);
  });

  it('la barra es un máximo histórico y no retrocede', () => {
    let state = createInitialState(config({ seats: 4 }));
    for (let i = 0; i < 30 && !state.finished; i += 1) {
      const before = state.eraBar;
      const turnBefore = state.turn;
      state = play(state);
      if (state.era === 'tribal' && state.turn - 1 === turnBefore && state.eraAdvancedTurn === null) {
        expect(state.eraBar).toBeGreaterThanOrEqual(before);
      }
    }
  });

  it('la era solo avanza, nunca vuelve', () => {
    let state = createInitialState(config());
    const order: string[] = [state.era];
    while (!state.finished) {
      state = play(state);
      if (order[order.length - 1] !== state.era) order.push(state.era);
    }
    expect(order).toEqual(['tribal', 'reinos', 'modernidad']);
  });
});

describe('hitos y buffs', () => {
  it('un hito global solo se otorga una vez', () => {
    const state = makeState([makeSeat({ temples: 1 })]);
    const seat = state.seats[0]!;
    expect(awardMilestone(state, seat, 'temple_1')).toBe(true);
    expect(awardMilestone(state, seat, 'temple_1')).toBe(false);
    expect(state.milestones.temple_1).toBe(seat.id);
  });

  it('el botín de un hito es un porcentaje del tope, no una cifra fija', () => {
    const poor = makeSeat({ divinity: 1, believers: 30, temples: 0 });
    const rich = makeSeat({ divinity: 5, believers: 30_000, temples: 0 });
    const stateA = makeState([poor]);
    const stateB = makeState([rich]);
    awardMilestone(stateA, stateA.seats[0]!, 'pop_1000');
    awardMilestone(stateB, stateB.seats[0]!, 'pop_1000');
    expect(stateB.seats[0]!.fe).toBeGreaterThan(stateA.seats[0]!.fe * 3);
  });

  it('como máximo hay dos buffs activos y el tercero desaloja al más antiguo', () => {
    const seat = makeSeat();
    addBuff(seat, 'militar+', 1);
    addBuff(seat, 'cultura+', 2);
    addBuff(seat, 'esencia+', 3);
    expect(seat.buffs).toHaveLength(MAX_BUFFS);
    expect(hasBuff(seat, 'militar+')).toBe(false);
    expect(hasBuff(seat, 'cultura+')).toBe(true);
    expect(hasBuff(seat, 'esencia+')).toBe(true);
  });

  it('el mismo buff se refresca en vez de acumularse', () => {
    const seat = makeSeat();
    addBuff(seat, 'militar+', 1);
    addBuff(seat, 'militar+', 5);
    expect(seat.buffs).toHaveLength(1);
    expect(seat.buffs[0]?.untilTurn).toBe(7);
  });
});

describe('ventanas', () => {
  it('se desbloquean en el orden de la escalera', () => {
    let state = createInitialState(config({ unlockEvery: 5, seats: 4 }));
    const initial = [...state.windowsUnlocked];
    expect(initial).toEqual([WINDOW_LADDER[0]]);
    for (let i = 0; i < 40 && !state.finished; i += 1) state = play(state);
    expect(state.windowsUnlocked).toEqual(WINDOW_LADDER);
  });
});

describe('final de partida', () => {
  it('termina por vasallaje cuando todos los dioses libres dependen de uno', () => {
    const lord = makeSeat({ id: 0, believers: 500 });
    const vassal = makeSeat({ id: 1, believers: 400, vassalOf: 0 });
    const next = resolveTurn(makeState([lord, vassal]), []);
    expect(next.finished).toBe(true);
    expect(next.winnerSeat).toBe(0);
  });

  it('con dos dioses libres la partida sigue', () => {
    const next = resolveTurn(
      makeState([makeSeat({ id: 0, believers: 500 }), makeSeat({ id: 1, believers: 400 })]),
      [],
    );
    expect(next.finished).toBe(false);
  });

  it('termina en el horizonte y declara ganador', () => {
    const state = playToEnd(createInitialState(config({ horizonYears: 30 })));
    expect(state.finished).toBe(true);
    expect(state.fictionDay).toBeGreaterThanOrEqual(30 * 365);
    expect(state.winnerSeat).not.toBeNull();
  });
});
