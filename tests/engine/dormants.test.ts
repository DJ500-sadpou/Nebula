import { describe, expect, it } from 'vitest';
import { planFor } from '../../lib/bots/policy';
import { digestState } from '../../lib/engine/digest';
import {
  AWAKEN_TURN,
  awakenOne,
  runAgenda,
  runAwakening,
  runDormantEvents,
  traitorNightText,
  worldEventText,
} from '../../lib/engine/dormants';
import {
  activeSeats,
  awakenedSeats,
  rivalSeats,
  sleepingSeats,
  scoreOf,
} from '../../lib/engine/ic';
import { rng } from '../../lib/engine/rng';
import { createInitialState, resolveTurn } from '../../lib/engine/resolve';
import { MatchState, Order, WindowId } from '../../lib/engine/types';
import { makeSeat, makeState } from '../helpers';

/**
 * Fase 6 · Dioses dormidos y dioses malignos (§17.2, A.8).
 *
 * Todo es determinista por semilla: los porcentajes (15 % de evento corto, 10 %
 * de despertar) se comprueban sobre rangos generosos pero que un bug del 0 %
 * o del 100 % revienta.
 */

function worldOfSeeds(seeds: number, config: Partial<Parameters<typeof createInitialState>[0]> = {}) {
  return Array.from({ length: seeds }, (_, i) => i + 1).map((seed) =>
    createInitialState({
      seats: 6,
      humans: 2,
      seed,
      unlockEvery: 5,
      horizonYears: 30,
      tableVoters: 2,
      ...config,
    }),
  );
}

function sleepTheRest(state: MatchState): MatchState {
  for (const seat of state.seats) if (seat.id >= 4) seat.kind = 'dormant';
  return state;
}

describe('clasificación de asientos (§2, §10)', () => {
  const state = makeState([
    makeSeat({ id: 0, kind: 'human' }),
    makeSeat({ id: 1, kind: 'bot' }),
    makeSeat({ id: 2, kind: 'dormant' }),
    makeSeat({ id: 3, kind: 'dormant', awakened: true }),
  ]);

  it('civilizaciones, dormidos, malignos y rivales son conjuntos distintos', () => {
    expect(activeSeats(state).map((s) => s.id)).toEqual([0, 1]);
    expect(sleepingSeats(state).map((s) => s.id)).toEqual([2]);
    expect(awakenedSeats(state).map((s) => s.id)).toEqual([3]);
    expect(rivalSeats(state).map((s) => s.id)).toEqual([0, 1, 3]);
  });

  it('un dios muerto no es rival aunque haya despertado', () => {
    const dead = makeState([
      makeSeat({ id: 0, kind: 'human' }),
      makeSeat({ id: 3, kind: 'dormant', awakened: true, believers: 0 }),
    ]);
    expect(rivalSeats(dead).map((s) => s.id)).toEqual([0]);
  });
});

describe('despertar (§17.2)', () => {
  it('awakenOne marca a un dormido y solo a un dormido', () => {
    const state = makeState([
      makeSeat({ id: 0, kind: 'human' }),
      makeSeat({ id: 1, kind: 'dormant' }),
    ]);
    const god = awakenOne(state, rng(1, 1, 900));
    expect(god?.id).toBe(1);
    expect(state.seats[1]!.awakened).toBe(true);
    expect(awakenOne(state, rng(1, 1, 901))).toBeNull();
  });

  it('la Noche de la traición nombra al dormido; sin dormidos, el mundo respira', () => {
    const empty = makeState([makeSeat({ id: 0 })]);
    expect(worldEventText(empty, empty.seats[0]!, 13, rng(1, 1, 902))).toBe('El mundo respira.');

    const withSleeper = makeState([
      makeSeat({ id: 0, name: 'Nebula' }),
      makeSeat({ id: 1, kind: 'dormant', name: 'Crampus' }),
    ]);
    const text = worldEventText(withSleeper, withSleeper.seats[0]!, 13, rng(1, 1, 903));
    expect(text).toContain('Noche de la traición');
    expect(text).toContain('Crampus');
    expect(withSleeper.seats[1]!.awakened).toBe(true);
  });

  it('runAwakening no tira antes del turno 6 y despierta a ritmo medible después', () => {
    const early = sleepTheRest(worldOfSeeds(1)[0]!);
    early.turn = AWAKEN_TURN - 1;
    runAwakening(early);
    expect(sleepingSeats(early)).toHaveLength(2);

    let awakenings = 0;
    const turns = 200;
    for (let t = AWAKEN_TURN; t < AWAKEN_TURN + turns; t += 1) {
      const state = sleepTheRest(worldOfSeeds(((t * 7) % 40) + 1)[0]!);
      state.turn = t;
      runAwakening(state);
      awakenings += awakenedSeats(state).length;
    }
    // 10 % esperado sobre 200 turnos; un bug del 0 % o del 100 % revienta aquí.
    expect(awakenings).toBeGreaterThanOrEqual(8);
    expect(awakenings).toBeLessThanOrEqual(40);
  });

  it('un turno resuelto despierta a su dormido y el despertar sobrevive a la resolución', () => {
    // Semilla buscada determinísticamente: al menos un dormido despierta en
    // los primeros 40 turnos del mundo de 6 asientos con 2 dormidos.
    let woke = false;
    for (let seed = 1; seed <= 40 && !woke; seed += 1) {
      let state = sleepTheRest(
        createInitialState({ seats: 6, humans: 2, seed, unlockEvery: 5, horizonYears: 30, tableVoters: 2 }),
      );
      for (let t = 0; t < 40 && !state.finished; t += 1) {
        const before = state.events.length;
        state = resolveTurn(
          state,
          activeSeats(state).map((seat) => planFor(state, seat)),
        );
        const fresh = state.events.slice(before);
        if (fresh.some((e) => e.kind === 'awakening' || e.text.includes('Noche de la traición'))) {
          woke = true;
          break;
        }
      }
    }
    expect(woke).toBe(true);
  });
});

describe('eventos de los dormidos (§17.2, A.8)', () => {
  it('en ventana larga hay un evento por compás, todos con emisor', () => {
    const state = sleepTheRest(worldOfSeeds(1)[0]!);
    state.turn = 3;
    state.windowId = '1y';
    runDormantEvents(state);
    const events = state.events.filter((e) => e.kind === 'world' && e.data && 'source' in e.data);
    expect(events).toHaveLength(8);
    for (const event of events) {
      expect(typeof (event.data as Record<string, unknown>).source).toBe('string');
    }
  });

  it('en ventana corta es un 15 % por turno, ni siempre ni nunca', () => {
    let fired = 0;
    const turns = 200;
    for (let t = 1; t <= turns; t += 1) {
      const state = sleepTheRest(worldOfSeeds(((t * 11) % 40) + 1)[0]!);
      state.turn = t;
      runDormantEvents(state);
      const events = state.events.filter((e) => e.kind === 'world' && e.data && 'source' in e.data);
      fired += events.length;
    }
    expect(fired).toBeGreaterThanOrEqual(10);
    expect(fired).toBeLessThanOrEqual(50);
  });

  it('sin dormidos no hay eventos y los flujos nuevos no se consumen', () => {
    const state = worldOfSeeds(1)[0]!;
    state.turn = 9;
    runDormantEvents(state);
    runAwakening(state);
    runAgenda(state);
    expect(state.events).toHaveLength(0);
  });
});

describe('agenda del dios maligno (§17.2)', () => {
  const base = () =>
    makeState(
      [
        makeSeat({ id: 0, kind: 'bot', believers: 1000, regions: 5, techs: ['a', 'b'] }),
        makeSeat({ id: 1, kind: 'bot', believers: 500 }),
        makeSeat({ id: 2, kind: 'bot', believers: 300 }),
        makeSeat({ id: 3, kind: 'dormant', awakened: true, name: 'Crampus', believers: 40 }),
      ],
      { milestones: {} },
    );

  it('cada maligno ejecuta exactamente un acto por turno, siempre público', () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const state = base();
      state.seed = seed;
      state.turn = 5;
      runAgenda(state);
      const acts = state.events.filter((e) => e.kind === 'agenda');
      expect(acts).toHaveLength(1);
      expect(acts[0]!.visibility).toBe('public');
      expect(acts[0]!.seatId).toBe(3);
    }
  });

  it('los tres actos aparecen y los efectos caen sobre las civilizaciones', () => {
    const texts = new Set<string>();
    let fidelityHits = 0;
    let leaderHits = 0;
    let ruins = 0;
    for (let seed = 1; seed <= 90; seed += 1) {
      const state = base();
      state.seed = seed;
      state.turn = 5;
      const civsBefore = activeSeats(state).map((s) => ({ ...s, fidelity: s.fidelity, believers: s.believers }));
      runAgenda(state);
      const text = state.events.find((e) => e.kind === 'agenda')?.text ?? '';
      texts.add(text.split(':')[0] ?? '');
      const after = activeSeats(state);
      for (const [i, civ] of after.entries()) {
        const before = civsBefore[i]!;
        if (civ.fidelity < before.fidelity) fidelityHits += 1;
        if (civ.believers < before.believers) leaderHits += 1;
      }
      ruins += state.seats[3]!.xp;
    }
    expect(texts.size).toBeGreaterThanOrEqual(3);
    expect(fidelityHits).toBeGreaterThan(0);
    expect(leaderHits).toBeGreaterThan(0);
    expect(ruins).toBeGreaterThan(0);
  });

  it('atacar al líder golpea al de mayor puntuación de §10', () => {
    // Semilla buscada: el acto 0 (atacar al líder) con el asiento 0 líder.
    let found = false;
    for (let seed = 1; seed <= 60 && !found; seed += 1) {
      const state = base();
      state.seed = seed;
      state.turn = 5;
      const leaderBefore = 1000;
      const leaderScore = scoreOf(state, state.seats[0]!);
      expect(leaderScore).toBeGreaterThan(scoreOf(state, state.seats[1]!));
      const rand = rng(state.seed, state.turn, 803 + 3);
      const act = Math.floor(rand() * 3);
      if (act !== 0) continue;
      runAgenda(state);
      const text = state.events.find((e) => e.kind === 'agenda')?.text ?? '';
      expect(text).toContain('marcha contra');
      expect(state.seats[0]!.believers).toBe(Math.max(1, Math.round(leaderBefore * 0.95)));
      found = true;
    }
    expect(found).toBe(true);
  });
});

describe('el maligno en la mesa (§10, §17.2)', () => {
  it('cuenta como rival para la victoria por vasallaje; el dormido no', () => {
    const build = (awakeVassalOf: number | null) =>
      makeState([
        makeSeat({ id: 0, kind: 'bot', believers: 900, name: 'Señor' }),
        makeSeat({ id: 1, kind: 'bot', believers: 500, vassalOf: 0 }),
        makeSeat({ id: 2, kind: 'dormant', awakened: true, believers: 40, vassalOf: awakeVassalOf }),
        makeSeat({ id: 3, kind: 'dormant', believers: 40 }),
      ], { seed: 12345 });

    // El maligno sin vasallar impide la victoria: queda un segundo señor.
    const blocked = resolveTurn(build(null), []);
    expect(blocked.finished).toBe(false);

    // Vasallizado el maligno, el señor se queda solo entre los rivales.
    const won = resolveTurn(build(0), []);
    expect(won.finished).toBe(true);
    expect(won.winnerSeat).toBe(0);
  });

  it('al cerrar por horizonte puntúa al maligno, nunca al dormido que duerme', () => {
    const state = makeState(
      [
        makeSeat({ id: 0, kind: 'bot', believers: 100, xp: 200 }),
        makeSeat({ id: 1, kind: 'dormant', awakened: true, believers: 40, xp: 200 }),
        makeSeat({ id: 2, kind: 'dormant', believers: 40, xp: 9000 }),
      ],
      { horizonYears: 0, fictionDay: 0 },
    );
    const next = resolveTurn(state, []);
    expect(next.finished).toBe(true);
    // El asiento 2 duerme con 9 000 XP: puntuaría más que nadie, pero no puntúa.
    expect(next.winnerSeat).not.toBe(2);
    expect(next.winnerSeat).toBe(0);
  });
});

describe('aceptación: el mundo de 32 avanza solo (§17.2)', () => {
  /** 32 asientos: 2 humanos que no envían nada, 6 bots, 24 dioses dormidos. */
  function playWorld(seed: number): MatchState {
    let state = createInitialState({
      seats: 32,
      humans: 2,
      seed,
      unlockEvery: 5,
      horizonYears: 30,
      tableVoters: 2,
    });
    for (const seat of state.seats) if (seat.id >= 8) seat.kind = 'dormant';
    let guard = 0;
    while (!state.finished && guard < 400) {
      guard += 1;
      const orders: Order[] = activeSeats(state).map((seat) =>
        seat.kind === 'bot' ? planFor(state, seat) : { seatId: seat.id, plan: [] },
      );
      state = resolveTurn(state, orders);
    }
    return state;
  }

  it('llega al final sin intervención humana y el mundo sigue vivo', () => {
    const state = playWorld(7);
    expect(state.finished).toBe(true);
    expect(state.era === 'reinos' || state.era === 'modernidad').toBe(true);
    const kinds = state.events.map((e) => e.kind);
    expect(kinds.includes('awakening') || state.events.some((e) => e.text.includes('Noche de la traición'))).toBe(true);
    expect(kinds.includes('agenda')).toBe(true);
  });

  it('es determinista de punta a punta', () => {
    expect(digestState(playWorld(7))).toBe(digestState(playWorld(7)));
  });

  it('el relleno de la sala de referencia es el de §2: 6 bots y 24 dormidos', () => {
    const state = createInitialState({ seats: 32, humans: 2, seed: 7, unlockEvery: 5, horizonYears: 30 });
    for (const seat of state.seats) if (seat.id >= 8) seat.kind = 'dormant';
    expect(state.seats.filter((s) => s.kind === 'human')).toHaveLength(2);
    expect(state.seats.filter((s) => s.kind === 'bot')).toHaveLength(6);
    expect(state.seats.filter((s) => s.kind === 'dormant')).toHaveLength(24);
  });
});
