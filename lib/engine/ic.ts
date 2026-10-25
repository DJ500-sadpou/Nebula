import { Era, ERAS_BY_ID, MatchState, Seat } from './types';

/**
 * Índice de Civilización, barra de época y debuff primitivo (§5-B de REGLAS.md).
 *
 * IC = 0,50·tecnología + 0,25·población + 0,25·cultura, todo en 0..1.
 * La barra es el promedio del IC dividido por la madurez de era (0,70), con techo 1.
 */

export const ERA_MATURITY = 0.75;
export const DIM_GAP = 0.25;

export function techScore(seat: Seat): number {
  return Math.min(1, seat.techs.length / 12);
}

export function cultureScore(seat: Seat): number {
  return Math.min(1, seat.culture.length / 12);
}

export const POP_FLOOR: Record<Era, number> = { tribal: 30, reinos: 5000, modernidad: 200000 };
export const POP_CEIL: Record<Era, number> = { tribal: 5000, reinos: 200000, modernidad: 5_000_000 };

/** Crecimiento de los fieles por turno (§4.4). */
export const GROWTH_RATE = 0.2;
export const GROWTH_MAX = 1.6;

export function populationScore(seat: Seat, era: Era): number {
  const floor = POP_FLOOR[era];
  const ceil = POP_CEIL[era];
  const span = Math.log10(ceil / floor);
  if (span <= 0) return 1;
  const raw = Math.log10(Math.max(floor, seat.believers) / floor) / span;
  return Math.min(1, Math.max(0, raw));
}

export function civIndex(seat: Seat, era: Era): number {
  return 0.5 * techScore(seat) + 0.25 * populationScore(seat, era) + 0.25 * cultureScore(seat);
}

export interface DimensionAverages {
  tech: number;
  population: number;
  culture: number;
  civIndex: number;
}

export function activeSeats(state: MatchState): Seat[] {
  return state.seats.filter((s) => s.believers > 0 && s.kind !== 'dormant');
}

export function dimensionAverages(state: MatchState): DimensionAverages {
  const active = activeSeats(state);
  if (active.length === 0) return { tech: 0, population: 0, culture: 0, civIndex: 0 };
  let tech = 0;
  let population = 0;
  let culture = 0;
  let index = 0;
  for (const seat of active) {
    tech += techScore(seat);
    population += populationScore(seat, state.era);
    culture += cultureScore(seat);
    index += civIndex(seat, state.era);
  }
  const n = active.length;
  return { tech: tech / n, population: population / n, culture: culture / n, civIndex: index / n };
}

/** Progreso 0..1 de la era: promedio del IC dividido por la madurez. */
export function eraProgress(state: MatchState): number {
  return Math.min(1, dimensionAverages(state).civIndex / ERA_MATURITY);
}

export function substageIndex(progress: number): number {
  return Math.min(3, Math.max(0, Math.floor(progress * 4)));
}

export function substageName(era: Era, progress: number): string {
  return ERAS_BY_ID[era].sub[substageIndex(progress)] as string;
}

export interface DebuffVerdict {
  active: boolean;
  techGap: number;
  populationGap: number;
  cultureGap: number;
  laggingDimensions: number;
  fromCulture: boolean;
}

/** Debuff si al menos 2 de las 3 dimensiones están 0,25 por debajo del promedio. */
export function evaluateDebuff(state: MatchState, seat: Seat): DebuffVerdict {
  const avg = dimensionAverages(state);
  const techGap = avg.tech - techScore(seat);
  const populationGap = avg.population - populationScore(seat, state.era);
  const cultureGap = avg.culture - cultureScore(seat);
  const lagging = [techGap, populationGap, cultureGap].filter((gap) => gap >= DIM_GAP).length;
  return {
    active: lagging >= 2,
    techGap,
    populationGap,
    cultureGap,
    laggingDimensions: lagging,
    fromCulture: cultureGap >= DIM_GAP || populationGap >= DIM_GAP,
  };
}
