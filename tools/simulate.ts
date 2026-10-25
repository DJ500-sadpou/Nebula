import { mkdirSync, writeFileSync } from 'node:fs';
import { planFor } from '../lib/bots/policy';
import { evaluateDebuff } from '../lib/engine/ic';
import { rng } from '../lib/engine/rng';
import {
  MatchState,
  WindowId,
  activeSeats,
  capFe,
  createInitialState,
  dimensionAverages,
  eraProgress,
  resolveTurn,
} from '../lib/engine';

const MATCHES = Number(process.argv[2] ?? 500);
const SEATS = Number(process.argv[3] ?? 8);
const UNLOCK_EVERY = Number(process.argv[4] ?? 5);
const HORIZON_YEARS = 30;
/**
 * La mesa de referencia de PLAN.md §5 es de 3 humanos + IA. Un humano puede
 * dejar de enviar órdenes un turno; los bots (§17.1) nunca lo hacen. Esa
 * diferencia es la fuente de divergencia real entre asientos.
 */
const INATTENTION_HUMAN = 0.25;
const MAX_TURNS = 400;

// §5-A.6 define las clases: corta 1d–30d, media 3m–6m, larga 1y–3y.
const SHORT_WINDOWS: WindowId[] = ['1d', '7d', '30d'];
const LONG_WINDOWS: WindowId[] = ['1y', '3y'];

/** Acumulador global: la métrica de ventanas se mide sobre todos los turnos. */
const globalWindow: Record<string, number> = {};

interface MatchRow {
  seed: number;
  turns: number;
  years: number;
  era: string;
  reinosTurn: number | null;
  modernTurn: number | null;
  winner: number | null;
  runaway: number;
  vassalage: boolean;
  topWindow: WindowId;
  topShare: number;
  div10y: number | null;
  compases: number;
  feLeftoverShort: number;
  feLeftoverLong: number;
  debuffTurns: number;
  debuffEpisodes: number;
  debuffEpisodeMean: number;
  debuffMaxStreak: number;
  debuffCultureShare: number;
  debuffCulturePrimaryShare: number;
  barMultiDimShare: number;
  maxStall: number;
  /** Fracción de asiento-turnos con 1, 2 y 3 dimensiones rezagadas. */
  lag1: number;
  lag2: number;
  lag3: number;
}

function runMatch(seed: number): MatchRow {
  let state: MatchState = createInitialState({
    seats: SEATS,
    humans: 3,
    seed,
    unlockEvery: UNLOCK_EVERY,
    horizonYears: HORIZON_YEARS,
    tableVoters: 3,
  });

  const windowCount: Record<string, number> = {};
  let beatsTotal = 0;
  let beatsSamples = 0;

  let feShort = 0;
  let feShortN = 0;
  let feLong = 0;
  let feLongN = 0;

  let debuffTurnTotal = 0;
  let debuffSamples = 0;
  let debuffCulture = 0;
  let debuffCulturePrimary = 0;
  // Episodios: turnos consecutivos con el debuff, de un asiento concreto.
  const streaks = new Map<number, number>();
  const episodes: number[] = [];
  let streakMax = 0;
  let multiDim = 0;
  let multiDimSamples = 0;

  let reinosTurn: number | null = null;
  let modernTurn: number | null = null;
  let div10y: number | null = null;
  const lag: Record<number, number> = {};
  let seatTurns = 0;
  let stall = 1;
  let maxStall = 1;

  let guard = 0;
  while (!state.finished && guard < MAX_TURNS) {
    guard += 1;
    const before = dimensionAverages(state);
    const orders = activeSeats(state).map((seat) => {
      const skip =
        seat.kind === 'human' &&
        rng(state.seed, state.turn, 500 + seat.id)() < INATTENTION_HUMAN;
      return skip ? { seatId: seat.id, plan: [] } : planFor(state, seat);
    });
    const beatsPerSeat = orders.map((order) => new Set(order.plan.map((p) => p.beat)));

    state = resolveTurn(state, orders);

    windowCount[state.windowId] = (windowCount[state.windowId] ?? 0) + 1;
    globalWindow[state.windowId] = (globalWindow[state.windowId] ?? 0) + 1;
    const short = SHORT_WINDOWS.includes(state.windowId);

    for (const beats of beatsPerSeat) {
      beatsTotal += beats.size;
      beatsSamples += 1;
    }

    for (const seat of activeSeats(state)) {
      const ratio = seat.fe / Math.max(1, capFe(seat));
      if (short) {
        feShort += ratio;
        feShortN += 1;
      } else if (LONG_WINDOWS.includes(state.windowId)) {
        feLong += ratio;
        feLongN += 1;
      }
      const verdict = evaluateDebuff(state, seat);
      lag[verdict.laggingDimensions] = (lag[verdict.laggingDimensions] ?? 0) + 1;
      seatTurns += 1;
      debuffTurnTotal += seat.debuffPrimitive ? 1 : 0;
      debuffSamples += 1;
      if (seat.debuffPrimitive && seat.debuffFromCulture) debuffCulture += 1;
      // Medida no trivial: ¿la cultura o la población es la peor dimensión, o
      // manda la tecnología? Sin esto el 100 % anterior es una tautología.
      if (seat.debuffPrimitive) {
        const worst = Math.max(verdict.techGap, verdict.cultureGap, verdict.populationGap);
        if (verdict.cultureGap >= worst || verdict.populationGap >= worst) {
          debuffCulturePrimary += 1;
        }
      }
      if (seat.debuffPrimitive) {
        streaks.set(seat.id, (streaks.get(seat.id) ?? 0) + 1);
      } else if (streaks.has(seat.id)) {
        const length = streaks.get(seat.id) ?? 0;
        if (length > 0) episodes.push(length);
        streaks.delete(seat.id);
      }
      streakMax = Math.max(streakMax, seat.debuffTurns);
    }

    const after = dimensionAverages(state);
    const delta = {
      tech: Math.abs(after.tech - before.tech) > 0.005,
      population: Math.abs(after.population - before.population) > 0.005,
      culture: Math.abs(after.culture - before.culture) > 0.005,
    };
    if (delta.tech || delta.population || delta.culture) {
      multiDimSamples += 1;
      const changed = Number(delta.tech) + Number(delta.population) + Number(delta.culture);
      if (changed > 1) multiDim += 1;
    }

    // Barra: turnos seguidos sin subir (regla: nunca más de 6).
    // el motor guarda el turno que acaba de resolver; state.turn ya está incrementado.
    const rose = state.lastBarRiseTurn === state.turn - 1;
    const saturated = state.eraBar >= 1;
    if (rose) stall = 1;
    else if (!saturated) {
      stall += 1;
      maxStall = Math.max(maxStall, stall);
    }

    if (reinosTurn === null && state.era === 'reinos') reinosTurn = state.turn;
    if (modernTurn === null && state.era === 'modernidad') modernTurn = state.turn;
    if (div10y === null && state.fictionDay >= 3650) {
      const list = activeSeats(state);
      div10y = list.reduce((acc, s) => acc + s.divinity, 0) / Math.max(1, list.length);
    }
  }

  const seats = state.seats.filter((s) => s.kind !== 'dormant');
  const scores = seats.map((s) => scoreOf(state, s)).sort((a, b) => b - a);
  const top = scores[0] ?? 0;
  const second = scores[1] ?? 1;
  const windowEntries = Object.entries(windowCount).sort((a, b) => b[1] - a[1]);
  const totalTurns = Object.values(windowCount).reduce((a, b) => a + b, 0) || 1;

  return {
    seed,
    turns: state.turn - 1,
    years: Math.round(state.fictionDay / 365),
    era: state.era,
    reinosTurn,
    modernTurn,
    winner: state.winnerSeat,
    runaway: second > 0 ? top / second : 99,
    vassalage: seats.some((s) => s.vassalOf !== null),
    topWindow: (windowEntries[0]?.[0] ?? '1d') as WindowId,
    topShare: (windowEntries[0]?.[1] ?? 0) / totalTurns,
    div10y,
    compases: beatsSamples ? beatsTotal / beatsSamples : 0,
    feLeftoverShort: feShortN ? feShort / feShortN : 0,
    feLeftoverLong: feLongN ? feLong / feLongN : 0,
    debuffTurns: debuffSamples ? debuffTurnTotal / debuffSamples : 0,
    debuffEpisodes: episodes.length,
    debuffEpisodeMean: episodes.length ? episodes.reduce((a, b) => a + b, 0) / episodes.length : 0,
    debuffMaxStreak: streakMax,
    debuffCultureShare: debuffTurnTotal ? debuffCulture / debuffTurnTotal : 0,
    debuffCulturePrimaryShare: debuffTurnTotal ? debuffCulturePrimary / debuffTurnTotal : 0,
    barMultiDimShare: multiDimSamples ? multiDim / multiDimSamples : 0,
    maxStall,
    lag1: seatTurns ? (lag[1] ?? 0) / seatTurns : 0,
    lag2: seatTurns ? (lag[2] ?? 0) / seatTurns : 0,
    lag3: seatTurns ? (lag[3] ?? 0) / seatTurns : 0,
  };
}

/** Puntuación de cierre (§10): idéntica a la del motor. */
function scoreOf(state: MatchState, seat: { id: number; divinity: number; believers: number; techs: string[]; relics: number; vassalOf: number | null }): number {
  const vassals = state.seats.filter((s) => s.vassalOf === seat.id).length;
  const milestones = Object.values(state.milestones).filter((id) => id === seat.id).length;
  return vassals * 100 + seat.divinity * 10 + seat.believers / 10 + seat.techs.length * 5 + seat.relics * 5 + milestones * 10;
}

const rows: MatchRow[] = [];
for (let seed = 1; seed <= MATCHES; seed += 1) rows.push(runMatch(seed));

const mean = (list: number[]): number =>
  list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
const pct = (value: number): number => Number((value * 100).toFixed(1));
const share = (pred: (r: MatchRow) => boolean): number => rows.filter(pred).length / rows.length;

const divs = rows.map((r) => r.div10y).filter((v): v is number => v !== null);
const windowWinner: Record<string, number> = {};
for (const r of rows) windowWinner[r.topWindow] = (windowWinner[r.topWindow] ?? 0) + 1;

const windowUsage: Record<string, number> = {};
for (const r of rows) {
  windowUsage[r.topWindow] = (windowUsage[r.topWindow] ?? 0) + 1;
}

const globalTurns = Object.values(globalWindow).reduce((a, b) => a + b, 0) || 1;
const windowShares = Object.fromEntries(
  Object.entries(globalWindow).map(([key, value]) => [key, pct(value / globalTurns)]),
);
const minWindowShare = pct(Math.min(...Object.values(windowShares).map((v) => v / 100)));

const summary = {
  partidas: rows.length,
  asientos: SEATS,
  turnos_medios: Number(mean(rows.map((r) => r.turns)).toFixed(1)),
  anios_medios: Number(mean(rows.map((r) => r.years)).toFixed(1)),
  divinidad_anio_10: divs.length ? Number(mean(divs).toFixed(2)) : null,
  compases_por_turno: Number(mean(rows.map((r) => r.compases)).toFixed(2)),
  fe_sobrante_ventana_corta_pct: pct(mean(rows.map((r) => r.feLeftoverShort))),
  fe_sobrante_ventana_larga_pct: pct(mean(rows.map((r) => r.feLeftoverLong))),
  turnos_con_debuff: Number(mean(rows.map((r) => r.debuffTurns)).toFixed(2)),
  episodios_por_partida: Number(mean(rows.map((r) => r.debuffEpisodes)).toFixed(1)),
  duracion_media_episodio: Number(mean(rows.map((r) => r.debuffEpisodeMean)).toFixed(2)),
  duracion_max_episodio: Math.max(...rows.map((r) => r.debuffMaxStreak)),
  debuff_cultura_o_poblacion_pct: pct(mean(rows.map((r) => r.debuffCultureShare))),
  debuff_cultura_o_poblacion_es_peor_dim_pct: pct(
    mean(rows.map((r) => r.debuffCulturePrimaryShare)),
  ),
  barra_multidimension_pct: pct(mean(rows.map((r) => r.barMultiDimShare))),
  barra_estancada_max_turnos: Math.max(...rows.map((r) => r.maxStall)),
  asiento_turnos_con_1_dim_rezagada_pct: pct(mean(rows.map((r) => r.lag1))),
  asiento_turnos_con_2_dim_rezagadas_pct: pct(mean(rows.map((r) => r.lag2))),
  asiento_turnos_con_3_dim_rezagadas_pct: pct(mean(rows.map((r) => r.lag3))),
  ventana_dominante_max_pct: pct(Math.max(...rows.map((r) => r.topShare))),
  ventana_minima_pct: minWindowShare,
  ventana_distribucion_pct: windowShares,
  partidas_sin_vasallaje_pct: pct(share((r) => !r.vassalage)),
  runaway_pct: pct(share((r) => r.runaway >= 2)),
  reinos_turno_medio: Number(mean(rows.map((r) => r.reinosTurn ?? 999)).toFixed(1)),
  reinos_antes_t30_pct: pct(share((r) => (r.reinosTurn ?? 999) <= 30)),
  modernidad_antes_t30_pct: pct(share((r) => (r.modernTurn ?? 999) <= 30)),
  modernidad_media: Number(mean(rows.map((r) => r.modernTurn ?? 999)).toFixed(1)),
  partidas_por_era: rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.era] = (acc[r.era] ?? 0) + 1;
    return acc;
  }, {}),
  ventanas_dominantes: windowUsage,
  ventanas_ganadoras_por_partida: windowWinner,
};

console.log(JSON.stringify(summary, null, 2));

mkdirSync('artifacts', { recursive: true });
const header = Object.keys(rows[0] ?? {}).join(',');
const body = rows
  .map((row) =>
    Object.values(row)
      .map((v) => (v === null ? '' : String(v)))
      .join(','),
  )
  .join('\n');
writeFileSync('artifacts/sim-fase0.csv', `${header}\n${body}\n`, 'utf8');
// A stderr para que la salida estándar sea JSON puro y se pueda guardar tal cual.
console.error('CSV: artifacts/sim-fase0.csv');
