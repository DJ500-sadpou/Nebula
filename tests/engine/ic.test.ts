import { describe, expect, it } from 'vitest';
import {
  DIM_GAP,
  ERA_MATURITY,
  activeSeats,
  civIndex,
  cultureScore,
  dimensionAverages,
  eraProgress,
  evaluateDebuff,
  populationScore,
  substageIndex,
  substageName,
  techScore,
} from '../../lib/engine/ic';
import { makeSeat, makeState } from '../helpers';

const ids = (n: number, prefix: string): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

const full = (over: Parameters<typeof makeSeat>[0] = {}) =>
  makeSeat({ believers: 5_000, techs: ids(12, 't'), culture: ids(12, 'c'), ...over });

const empty = (over: Parameters<typeof makeSeat>[0] = {}) =>
  makeSeat({ believers: 30, techs: [], culture: [], ...over });

describe('dimensiones del IC (§5-B)', () => {
  it('tech y cultura saturan en 12', () => {
    expect(techScore(makeSeat({ techs: [] }))).toBe(0);
    expect(techScore(makeSeat({ techs: ids(6, 't') }))).toBeCloseTo(0.5, 6);
    expect(techScore(makeSeat({ techs: ids(20, 't') }))).toBe(1);
    expect(cultureScore(makeSeat({ culture: ids(3, 'c') }))).toBeCloseTo(0.25, 6);
  });

  it('la población es logarítmica entre suelo y techo de la era', () => {
    expect(populationScore(makeSeat({ believers: 30 }), 'tribal')).toBe(0);
    expect(populationScore(makeSeat({ believers: 5_000 }), 'tribal')).toBe(1);
    const mid = populationScore(makeSeat({ believers: 387 }), 'tribal');
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
    expect(populationScore(makeSeat({ believers: 50 }), 'reinos')).toBe(0);
    expect(populationScore(makeSeat({ believers: 5_000_000 }), 'modernidad')).toBe(1);
  });

  it('el IC pondera 50/25/25', () => {
    expect(civIndex(full(), 'tribal')).toBeCloseTo(1, 6);
    expect(civIndex(empty(), 'tribal')).toBe(0);
    const onlyTech = makeSeat({ believers: 30, techs: ids(12, 't'), culture: [] });
    expect(civIndex(onlyTech, 'tribal')).toBeCloseTo(0.5, 6);
  });
});

describe('barra de era', () => {
  it('es la madurez 0,75 del IC medio, topada en 1', () => {
    // El valor es tuning de Fase 0 (§18.1): si cambia, cambia el ritmo de toda
    // la partida, así que está fijado aquí a propósito.
    expect(ERA_MATURITY).toBe(0.75);
    const state = makeState([full(), empty()]);
    const avg = dimensionAverages(state).civIndex;
    expect(avg).toBeCloseTo(0.5, 6);
    expect(eraProgress(state)).toBeCloseTo(0.5 / ERA_MATURITY, 6);
    const maxed = makeState([full(), full()]);
    expect(eraProgress(maxed)).toBe(1);
  });

  it('los dioses dormidos y los pueblos extintos no cuentan', () => {
    const dormant = makeSeat({ kind: 'dormant', believers: 1_000 });
    const dead = makeSeat({ id: 1, believers: 0 });
    const state = makeState([full(), dormant, dead]);
    expect(activeSeats(state)).toHaveLength(1);
    expect(dimensionAverages(state).civIndex).toBeCloseTo(1, 6);
  });

  it('cuatro subetapas nombradas por era', () => {
    expect(substageIndex(0)).toBe(0);
    expect(substageIndex(0.24)).toBe(0);
    expect(substageIndex(0.25)).toBe(1);
    expect(substageIndex(0.99)).toBe(3);
    expect(substageIndex(1)).toBe(3);
    expect(substageName('tribal', 0)).toBe('Tribu Antigua');
    expect(substageName('tribal', 0.8)).toBe('Tribu Tardía');
    expect(substageName('reinos', 0.3)).toBe('Grandes Reinos');
    expect(substageName('modernidad', 0.6)).toBe('Modernidad Eléctrica');
  });
});

describe('debuff primitivo', () => {
  it('exige dos de tres dimensiones con 0,25 de retraso', () => {
    const state = makeState([full(), empty()]);
    const verdict = evaluateDebuff(state, state.seats[1]!);
    expect(verdict.laggingDimensions).toBe(3);
    expect(verdict.active).toBe(true);
    expect(verdict.fromCulture).toBe(true);
    expect(DIM_GAP).toBe(0.25);
  });

  it('una sola dimensión atrasada no basta', () => {
    const faithful = makeSeat({ believers: 5_000, techs: [], culture: ids(12, 'c') });
    const state = makeState([full(), faithful]);
    const verdict = evaluateDebuff(state, state.seats[1]!);
    expect(verdict.laggingDimensions).toBe(1);
    expect(verdict.active).toBe(false);
    expect(verdict.fromCulture).toBe(false);
  });

  it('el más avanzado nunca tiene debuff', () => {
    const state = makeState([full(), empty()]);
    expect(evaluateDebuff(state, state.seats[0]!).active).toBe(false);
  });
});
