import { mkdirSync, writeFileSync } from 'node:fs';
import { chooseProblemOption, planFor, personalityOf } from '../lib/bots/policy';
import type { Personality } from '../lib/bots/policy';
import { activeSeats } from '../lib/engine/ic';
import { rng } from '../lib/engine/rng';
import { createInitialState, resolveTurn, scoreOf } from '../lib/engine';
import type { MatchState, Order, Seat } from '../lib/engine/types';

/**
 * Torneo de la Fase 6 (PLAN.md §6): los tres criterios que la simulación de
 * §18 no cubre, medidos con partidas completas y deterministas por semilla.
 *
 *   1. Dificultades (§17.1): una mesa de bots mitad Normal, mitad Corrupto.
 *      Criterio: el Corrupto («normal» de mesa, D63) gana ≥ 35 % contra el
 *      Normal («fácil»).
 *   2. Personalidades (§17.1): cada una debe liderar su métrica con ≥ 25 %
 *      de margen sobre la media de las otras dos: regiones el Expansivo,
 *      fieles el Fanático, profecías emitidas el Maquiavelo (D65).
 *   3. Mundo de 32 asientos con 2 humanos (§17.2): relleno de la mesa de
 *      referencia (6 bots) y 24 dioses dormidos; la mesa tiene que llegar
 *      sola hasta el final.
 *
 * Uso: npm run torneo -- [partidas=500] [partidas_mundo=20]
 */

const MATCHES = Number(process.argv[2] ?? 500);
const WORLD_MATCHES = Number(process.argv[3] ?? 20);
/**
 * 24 asientos = 3 personalidades × 8 áreas: cada personalidad ve cada Área
 * Pequeña exactamente una vez, así la carta de área (Minerales +20 %, Magia
 * Demoníaca −10 %…) no sesga la comparación. En mesas de 8, el asiento con
 * Minerales siempre caía en un Expansivo (id%3 e id%8 se alinean).
 */
const SEATS = 24;
const MAX_TURNS = 400;
/** El humano simulado del mundo de 32 se distrae como el de §18 (D30). */
const INATTENTION_HUMAN = 0.25;

type Difficulty = 'corrupto' | 'normal';
const difficultyOf = (seatId: number): Difficulty => (seatId % 2 === 0 ? 'normal' : 'corrupto');

function withProblem(state: MatchState, seat: Seat, order: Order): Order {
  const choice = chooseProblemOption(state, seat);
  return choice ? { ...order, problemOption: choice } : order;
}

/* ------------------------------------------------------------------ */
/* 1 y 2 · Torneo de dificultades y métricas de personalidad           */
/* ------------------------------------------------------------------ */

interface TournamentRow {
  seed: number;
  turns: number;
  winner: number | null;
  winnerDifficulty: Difficulty | null;
  scores: Record<number, number>;
  regions: Record<number, number>;
  /** Media de (fieles / máximo de la mesa) muestreada cada turno: la métrica
   *  del Fanático. El estado final no vale: todas las civilizaciones convergen
   *  al techo de su era. */
  believersMean: Record<number, number>;
  prophecies: Record<number, number>;
}

function runTournament(seed: number): TournamentRow {
  let state: MatchState = createInitialState({
    seats: SEATS,
    humans: 0,
    seed,
    unlockEvery: 5,
    horizonYears: 30,
    tableVoters: 3,
  });

  const prophecies: Record<number, number> = {};
  const believersSum: Record<number, number> = {};
  const believersSamples: Record<number, number> = {};
  let guard = 0;
  while (!state.finished && guard < MAX_TURNS) {
    guard += 1;
    const orders = activeSeats(state).map((seat) =>
      withProblem(state, seat, planFor(state, seat, difficultyOf(seat.id))),
    );
    for (const order of orders) {
      const casts = order.plan.filter((item) => item.action === 'profecia').length;
      prophecies[order.seatId] = (prophecies[order.seatId] ?? 0) + casts;
    }
    state = resolveTurn(state, orders);
    // Muestreo de fieles: fracción del máximo de la mesa en este turno.
    const civs = state.seats.filter((s) => s.believers > 0);
    const maxBelievers = Math.max(1, ...civs.map((s) => s.believers));
    for (const seat of civs) {
      believersSum[seat.id] = (believersSum[seat.id] ?? 0) + seat.believers / maxBelievers;
      believersSamples[seat.id] = (believersSamples[seat.id] ?? 0) + 1;
    }
  }

  const civs = state.seats.filter((s) => s.believers > 0);
  const scores: Record<number, number> = {};
  const regions: Record<number, number> = {};
  const believersMean: Record<number, number> = {};
  for (const seat of civs) {
    scores[seat.id] = scoreOf(state, seat);
    regions[seat.id] = seat.regions;
    believersMean[seat.id] = (believersSum[seat.id] ?? 0) / Math.max(1, believersSamples[seat.id] ?? 1);
  }
  const winner = state.winnerSeat;

  return {
    seed,
    turns: state.turn - 1,
    winner,
    winnerDifficulty: winner !== null ? difficultyOf(winner) : null,
    scores,
    regions,
    believersMean,
    prophecies,
  };
}

/* ------------------------------------------------------------------ */
/* 3 · Mundo de 32 asientos con 2 humanos                              */
/* ------------------------------------------------------------------ */

interface WorldRow {
  seed: number;
  turns: number;
  finished: boolean;
  winner: number | null;
  sleeping: number;
  awakened: number;
  dormantEvents: number;
  awakenings: number;
  agendas: number;
}

function runWorld(seed: number): WorldRow {
  let state: MatchState = createInitialState({
    seats: 32,
    humans: 2,
    seed,
    unlockEvery: 5,
    horizonYears: 30,
    tableVoters: 2,
  });
  // Relleno de §2 (D61): humanos 0–1, bots hasta la mesa de referencia (8),
  // dioses dormidos del 8 al 31.
  for (const seat of state.seats) {
    if (seat.id >= 8) seat.kind = 'dormant';
  }

  let dormantEvents = 0;
  let awakenings = 0;
  let agendas = 0;

  let guard = 0;
  while (!state.finished && guard < MAX_TURNS) {
    guard += 1;
    // Los bots juegan como Corrupto (D63), la dificultad de mesa; los dos
    // humanos se distraen como los de §18 (D30).
    const botPlans = new Map(
      activeSeats(state)
        .filter((seat) => seat.kind === 'bot')
        .map((seat) => {
          const order = planFor(state, seat, 'corrupto');
          return [seat.id, withProblem(state, seat, order)] as const;
        }),
    );
    const orders: Order[] = activeSeats(state).map((seat) => {
      if (seat.kind === 'human') {
        const absent = rng(state.seed, state.turn, 500 + seat.id)() < INATTENTION_HUMAN;
        if (absent) return { seatId: seat.id, plan: [] };
        return withProblem(state, seat, planFor(state, seat, 'normal'));
      }
      return botPlans.get(seat.id) ?? { seatId: seat.id, plan: [] };
    });
    state = resolveTurn(state, orders);

    const turn = state.turn - 1;
    for (const event of state.events) {
      if (event.turn !== turn) continue;
      if (event.kind === 'world' && event.data && 'source' in event.data) dormantEvents += 1;
      if (event.kind === 'awakening') awakenings += 1;
      if (event.kind === 'agenda') agendas += 1;
      // La Noche de la traición (13 del §14) despierta a un dormido dentro
      // del evento mundial: también cuenta.
      if (event.kind === 'world' && event.text.includes('Noche de la traición')) awakenings += 1;
    }
  }

  return {
    seed,
    turns: state.turn - 1,
    finished: state.finished,
    winner: state.winnerSeat,
    sleeping: state.seats.filter((s) => s.kind === 'dormant' && !s.awakened).length,
    awakened: state.seats.filter((s) => s.kind === 'dormant' && s.awakened).length,
    dormantEvents,
    awakenings,
    agendas,
  };
}

/* ------------------------------------------------------------------ */
/* Agregados y criterios                                               */
/* ------------------------------------------------------------------ */

const mean = (list: number[]): number =>
  list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
const pct = (value: number): number => Number((value * 100).toFixed(1));

const rows: TournamentRow[] = [];
for (let seed = 1; seed <= MATCHES; seed += 1) rows.push(runTournament(seed));

const decided = rows.filter((r) => r.winnerDifficulty !== null);
const corruptoWins = decided.filter((r) => r.winnerDifficulty === 'corrupto').length;
const normalWins = decided.filter((r) => r.winnerDifficulty === 'normal').length;

const scoreByDiff = (diff: Difficulty): number => {
  const list: number[] = [];
  for (const row of rows) {
    for (const [seatId, score] of Object.entries(row.scores)) {
      if (difficultyOf(Number(seatId)) === diff) list.push(score);
    }
  }
  return Number(mean(list).toFixed(1));
};

interface PersonalityStats {
  regions: number;
  believersMean: number;
  prophecies: number;
  wins: number;
}

const byPersonality: Record<Personality, PersonalityStats> = {
  expansionist: { regions: 0, believersMean: 0, prophecies: 0, wins: 0 },
  fanatic: { regions: 0, believersMean: 0, prophecies: 0, wins: 0 },
  machiavellian: { regions: 0, believersMean: 0, prophecies: 0, wins: 0 },
};
const samplesOf: Record<Personality, number> = { expansionist: 0, fanatic: 0, machiavellian: 0 };

for (const row of rows) {
  for (const seatId of Object.keys(row.scores)) {
    const id = Number(seatId);
    const personality = personalityOf({ id } as Seat);
    samplesOf[personality] += 1;
    byPersonality[personality].regions += row.regions[id] ?? 0;
    byPersonality[personality].believersMean += row.believersMean[id] ?? 0;
    byPersonality[personality].prophecies += row.prophecies[id] ?? 0;
  }
  if (row.winner !== null) byPersonality[personalityOf({ id: row.winner } as Seat)].wins += 1;
}

for (const key of Object.keys(byPersonality) as Personality[]) {
  const n = Math.max(1, samplesOf[key]);
  byPersonality[key].regions = Number((byPersonality[key].regions / n).toFixed(2));
  byPersonality[key].believersMean = Number((byPersonality[key].believersMean / n).toFixed(3));
  byPersonality[key].prophecies = Number((byPersonality[key].prophecies / n).toFixed(2));
}

/** Margen de una personalidad sobre la media de las otras dos (≥ 1,25 = +25 %). */
function margin(own: number, others: number[]): number {
  return Number((own / Math.max(0.0001, mean(others))).toFixed(2));
}

const tournamentSummary = {
  partidas: rows.length,
  asientos: SEATS,
  dificultades: {
    victorias_corrupto: corruptoWins,
    victorias_normal: normalWins,
    sin_ganador: rows.length - decided.length,
    share_corrupto_pct: pct(decided.length ? corruptoWins / decided.length : 0),
    share_normal_pct: pct(decided.length ? normalWins / decided.length : 0),
    score_medio_corrupto: scoreByDiff('corrupto'),
    score_medio_normal: scoreByDiff('normal'),
    turnos_medios: Number(mean(rows.map((r) => r.turns)).toFixed(1)),
  },
  personalidades: byPersonality,
  criterios: {
    corrupto_gana_al_menos_35_pct: corruptoWins / Math.max(1, decided.length) >= 0.35,
    expansivo_regiones_vs_resto: margin(
      byPersonality.expansionist.regions,
      [byPersonality.fanatic.regions, byPersonality.machiavellian.regions],
    ),
    fanatico_fieles_vs_resto: margin(
      byPersonality.fanatic.believersMean,
      [byPersonality.expansionist.believersMean, byPersonality.machiavellian.believersMean],
    ),
    maquiavelo_profecias_vs_resto: margin(
      byPersonality.machiavellian.prophecies,
      [byPersonality.expansionist.prophecies, byPersonality.fanatic.prophecies],
    ),
  },
};

const worldRows: WorldRow[] = [];
for (let seed = 1; seed <= WORLD_MATCHES; seed += 1) worldRows.push(runWorld(seed));

const worldSummary = {
  partidas: worldRows.length,
  asientos: 32,
  humanos: 2,
  bots: 6,
  dormidos: 24,
  completadas: worldRows.filter((r) => r.finished).length,
  turnos_medios: Number(mean(worldRows.map((r) => r.turns)).toFixed(1)),
  despiertos_por_partida: Number(mean(worldRows.map((r) => r.awakened)).toFixed(2)),
  eventos_dormidos_por_partida: Number(mean(worldRows.map((r) => r.dormantEvents)).toFixed(1)),
  actos_de_agenda_por_partida: Number(mean(worldRows.map((r) => r.agendas)).toFixed(1)),
  todas_avanzan_solas: worldRows.every((r) => r.finished),
};

const summary = { torneo: tournamentSummary, mundo32: worldSummary };
console.log(JSON.stringify(summary, null, 2));

mkdirSync('artifacts', { recursive: true });
writeFileSync(
  'artifacts/torneo-fase6.json',
  JSON.stringify({ summary, rows, worldRows }, null, 2),
  'utf8',
);
// A stderr para que la salida estándar sea JSON puro y se pueda guardar tal cual.
console.error('JSON completo: artifacts/torneo-fase6.json');
