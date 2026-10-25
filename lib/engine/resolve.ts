import {
  ACTIONS,
  MILESTONES,
  MISSION_IDS,
  MISSION_TURNS,
  addBuff,
  nextTechId,
  applyWorldEvent,
  awardMilestone,
  expireBuffs,
  hasBuff,
  isWindowAllowed,
} from './content';
import { areaPassive, passiveForArea } from './areas';
import { applyProblemChoice } from './problems';
import { capFe, clampFe, incomeTurn } from './economy';
import {
  GROWTH_MAX,
  GROWTH_RATE,
  POP_CEIL,
  activeSeats,
  eraProgress,
  evaluateDebuff,
} from './ic';
import { rng } from './rng';
import {
  BEATS_PER_TURN,
  ERAS,
  Era,
  MatchConfig,
  MatchState,
  Order,
  Seat,
  WINDOW_LADDER,
  WINDOWS,
  WindowId,
  XP_THRESHOLDS,
} from './types';

/** Turnos sin que la barra suba antes de que la válvula de §5-B.8 actúe. */
export const STALL_TURNS = 8;

const AREA_CARDS = [
  'Insectos', 'Mar', 'Aves', 'Minerales', 'Ganado',
  'Magia Demoníaca', 'Enfermedad', 'Sueños',
];

const DOMAIN_CARDS = [
  'Guerra', 'Enfermedad', 'Cadáver', 'Magia',
  'Sueños', 'Silencio', 'Umbral', 'Pacto',
];

const GOD_NAMES = [
  'Nebula', 'Hegemonía', 'Eldar', 'Lunda',
  'Crampus', 'Mazdari', 'Kyle', 'Redin',
];

export function createInitialState(config: MatchConfig): MatchState {
  // Una ventana fija sin política es una petición explícita de ritmo fijo: si se
  // ignorara, el llamador creería que la partida está fijada y no lo estaría.
  const windowPolicy = config.windowPolicy ?? (config.fixedWindow ? 'fixed' : 'table');
  const fixedWindow = config.fixedWindow ?? null;
  if (windowPolicy === 'fixed' && fixedWindow === null) {
    throw new Error('windowPolicy «fixed» exige fixedWindow');
  }
  if (fixedWindow !== null && WINDOWS[fixedWindow] === undefined) {
    throw new Error(`Ventana fija desconocida: ${String(fixedWindow)}`);
  }
  const rand = rng(config.seed, 0, 0);
  const seats: Seat[] = [];
  const count = Math.max(4, Math.min(32, config.seats));
  for (let i = 0; i < count; i += 1) {
    const area = AREA_CARDS[i % AREA_CARDS.length] as string;
    const domain = DOMAIN_CARDS[(i * 3) % DOMAIN_CARDS.length] as string;
    const name = GOD_NAMES[i % GOD_NAMES.length] as string;
    seats.push({
      id: i,
      name: `${name}${i >= GOD_NAMES.length ? ` ${i}` : ''}`,
      kind: i < config.humans ? 'human' : 'bot',
      areaCard: area,
      domainCard: domain,
      believers: 30 + Math.floor(rand() * 21),
      fidelity: 0.55 + rand() * 0.1,
      fame: 0,
      fe: 30,
      xp: 0,
      divinity: 1,
      temples: 0,
      regions: 1,
      essence: 0,
      relics: 0,
      magic: 0,
      techs: [],
      culture: [],
      buffs: [],
      debuffPrimitive: false,
      debuffTurns: 0,
      debuffFromCulture: false,
      debuffLevel: 0,
      debuffMissionTurn: null,
      vassalOf: null,
      createdAtTurn: 1,
    });
    seats[seats.length - 1]!.magic = passiveForArea(area).magia;
  }
  return {
    seed: config.seed,
    turn: 1,
    windowId: fixedWindow ?? '1d',
    windowPolicy,
    fixedWindow,
    // Con ritmo fijo la escalera ya está recorrida: no tiene sentido enseñar
    // ventanas bloqueadas que la mesa no va a votar.
    windowsUnlocked: fixedWindow !== null ? [...WINDOW_LADDER] : ['1d'],
    unlockEvery: config.unlockEvery,
    fictionDay: 0,
    era: 'tribal',
    eraBar: 0,
    eraAdvancedTurn: null,
    lastBarRiseTurn: 1,
    tableVoters: config.tableVoters ?? 3,
    war: null,
    windowBeforeWar: null,
    peaceUntilTurn: 0,
    horizonYears: config.horizonYears,
    seats,
    milestones: {},
    events: [],
    finished: false,
    winnerSeat: null,
    pendingIncome: [],
    windowOverride: null,
  };
}

/** Techo de ventana por etapa del mundo cuando hay guerra (§5-A.11, §9). */
export function windowCeiling(era: MatchState['era']): WindowId {
  if (era === 'tribal') return '7d';
  if (era === 'reinos') return '30d';
  return '3m';
}

/** Opciones legales de la papeleta: desbloqueadas y bajo el techo de guerra. */
export function ballotOptions(state: MatchState): WindowId[] {
  if (!state.war) return [...state.windowsUnlocked];
  const ceiling = WINDOW_LADDER.indexOf(windowCeiling(state.era));
  return state.windowsUnlocked.filter((w) => WINDOW_LADDER.indexOf(w) <= ceiling);
}

/**
 * Votación de la mesa (§5-A.2). Solo votan humanos; aquí se modelan los
 * votantes de la mesa simulada con un perfil de preferencia por ventanas largas.
 * Mayoría simple de los votos emitidos; empate o sin quórum, se mantiene la actual.
 */
export function chooseWindow(state: MatchState): WindowId {
  if (state.windowPolicy === 'fixed' && state.fixedWindow !== null) return state.fixedWindow;
  const options = ballotOptions(state);
  if (options.length === 0) return state.windowId;
  if (state.tableVoters <= 0) return state.windowId;
  const last = Math.max(1, options.length - 1);
  const tally = new Map<WindowId, number>();
  for (let i = 0; i < state.tableVoters; i += 1) {
    const rand = rng(state.seed, state.turn, 101 + i);
    // Preferencia por el alcance, con ruido: la mesa no siempre quiere el salto máximo.
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let index = 0; index < options.length; index += 1) {
      const reach = index / last;
      const score = reach * 0.7 + rand() * 1.0;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    const vote = options[bestIndex] as WindowId;
    tally.set(vote, (tally.get(vote) ?? 0) + 1);
  }
  const majority = Math.floor(state.tableVoters / 2) + 1;
  for (const [windowId, votes] of tally) if (votes >= majority) return windowId;
  return state.windowId;
}

/**
 * Contexto de los 8 compases de un turno (§5-A.3).
 *
 * Vive separado de `resolveTurn` para que el compás sea una unidad real y
 * verificable: el turno se puede ejecutar de una vez o compás a compás sin que
 * cambie el resultado. Eso es lo que hace equivalentes una ventana de `3y` y sus
 * ocho sub-turnos (ver REGLAS.md §A.12).
 */
export interface BeatPhase {
  /** Ingreso del turno por asiento, ya descontado el tributo de vasallaje. */
  income: Map<number, number>;
  /** Compás hasta el que está ocupado cada canal de cada asiento (`id:canal`). */
  busyUntil: Map<string, number>;
}

/** Paso 1: ingreso del turno y tributo. No toca el estado. */
export function planBeatPhase(state: MatchState, days: number): BeatPhase {
  const income = new Map<number, number>();
  for (const seat of state.seats) {
    if (seat.kind === 'dormant' || seat.believers <= 0) {
      income.set(seat.id, 0);
      continue;
    }
    income.set(seat.id, incomeTurn(seat, days));
  }
  // Tributo de vasallaje: 20 % del ingreso del vasallo.
  for (const seat of state.seats) {
    if (seat.vassalOf === null || seat.believers <= 0) continue;
    const lord = state.seats.find((s) => s.id === seat.vassalOf);
    if (!lord) continue;
    const own = income.get(seat.id) ?? 0;
    const tribute = Math.floor(own * 0.2);
    income.set(seat.id, own - tribute);
    income.set(lord.id, (income.get(lord.id) ?? 0) + tribute);
  }
  return { income, busyUntil: new Map() };
}

/** Pasos 2-5: libera el ingreso del compás y ejecuta su plan. Muta el estado. */
export function applyBeat(
  state: MatchState,
  beat: number,
  orders: Order[],
  phase: BeatPhase,
): void {
  for (const seat of state.seats) {
    if (seat.kind === 'dormant' || seat.believers <= 0) continue;
    // El Fe es entero: el sobrante de la división entra en el último compás.
    const total = phase.income.get(seat.id) ?? 0;
    const perBeat = Math.floor(total / BEATS_PER_TURN);
    const carry = total - perBeat * BEATS_PER_TURN;
    seat.fe += perBeat + (beat === BEATS_PER_TURN - 1 ? carry : 0);

    const plan = orders.find((o) => o.seatId === seat.id)?.plan ?? [];
    for (const item of plan) {
      if (item.beat !== beat) continue;
      const def = ACTIONS[item.action];
      if (!def) continue;
      if (item.channel !== def.channel) continue;
      const key = `${seat.id}:${def.channel}`;
      if ((phase.busyUntil.get(key) ?? -1) >= beat) continue;
      if (!isWindowAllowed(def.minWindow, state.windowId)) continue;
      if (def.available && !def.available(seat, state)) continue;
      const cost = def.cost(seat, state);
      if (seat.fe < cost) continue;
      seat.fe -= cost;
      def.effect(seat, state, rng(state.seed, state.turn, beat * 31 + seat.id));
      if (MISSION_IDS.has(def.id)) seat.debuffMissionTurn = state.turn + MISSION_TURNS;
      phase.busyUntil.set(key, beat + def.beats - 1);
    }
    clampFe(seat);
  }
}

/**
 * Ejecuta la fase de compases. `beats` permite partir el turno en sub-turnos:
 * `resolveBeats(s, o, f)` y ocho llamadas de un compás dan el mismo estado.
 */
export function resolveBeats(
  state: MatchState,
  orders: Order[],
  phase: BeatPhase,
  beats: readonly number[] = Array.from({ length: BEATS_PER_TURN }, (_, i) => i),
): void {
  for (const beat of beats) applyBeat(state, beat, orders, phase);
}

function powerOf(seat: Seat): number {
  const military = hasBuff(seat, 'militar+') ? 1.25 : 1;
  return (seat.believers / 10 + seat.techs.length * 2 + seat.regions * 5) * military;
}

function grantShared(state: MatchState, key: string, winners: Seat[], pct: number, buff?: string): void {
  if (state.milestones[key] !== undefined) return;
  const first = winners[0];
  if (!first) return;
  state.milestones[key] = first.id;
  for (const seat of winners) {
    seat.fe += Math.floor((capFe(seat) * pct) / 100);
    clampFe(seat);
    if (buff) addBuff(seat, buff, state.turn);
  }
  state.events.push({
    turn: state.turn,
    visibility: 'public',
    seatId: first.id,
    kind: 'milestone',
    text: `Hito compartido «${key}»: ${winners.map((w) => w.name).join(' y ')}.`,
  });
}

export function resolveTurn(state: MatchState, orders: Order[]): MatchState {
  const next: MatchState = structuredClone(state);
  if (next.finished) return next;

  // Fase de votación (o ventana forzada por un choque, o restauración tras la paz).
  const fixed = next.windowPolicy === 'fixed' ? next.fixedWindow : null;
  const override = next.windowOverride;
  let windowId: WindowId;
  if (fixed !== null) {
    // Ritmo fijado por la mesa: ni la papeleta ni un choque lo mueven (§5-A.12).
    windowId = fixed;
    next.windowOverride = null;
  } else if (override && next.fictionDay < override.untilDay) {
    windowId = override.windowId;
  } else {
    if (override) next.windowOverride = null;
    const restored = !next.war ? next.windowBeforeWar : null;
    if (restored && next.windowsUnlocked.includes(restored)) {
      windowId = restored;
      next.windowBeforeWar = null;
    } else {
      windowId = chooseWindow(next);
    }
  }
  next.windowId = windowId;
  const days = WINDOWS[windowId].days;

  // 1-5. Recaudación y compases (ver `planBeatPhase` y `resolveBeats`).
  const phase = planBeatPhase(next, days);
  resolveBeats(next, orders, phase);

  // 6. Civilización: el problema de era (§15). Solo actúa quien elige: los bots
  //    no tienen política de problemas hasta la Fase 6 y no se les inventa una.
  for (const seat of next.seats) {
    if (seat.kind === 'dormant' || seat.believers <= 0) continue;
    const choice = orders.find((o) => o.seatId === seat.id)?.problemOption;
    if (choice) applyProblemChoice(next, seat, choice);
  }

  // 6-bis. Crecimiento de los fieles (§4.4) y deriva de fidelidad.
  const ceiling = POP_CEIL[next.era];
  for (const seat of next.seats) {
    if (seat.kind === 'dormant' || seat.believers <= 0) continue;
    const reach = GROWTH_RATE * seat.fidelity * Math.sqrt(days / 30);
    const growth = seat.fidelity < 0.3 ? 0.9 : Math.min(GROWTH_MAX, 1 + reach);
    seat.believers = Math.min(ceiling, Math.max(1, Math.round(seat.believers * growth)));
    const target = Math.min(
      1.2,
      0.55 + 0.04 * seat.temples + seat.fame / 500 + areaPassive(seat).fidelity,
    );
    seat.fidelity += (target - seat.fidelity) * 0.25;
    // §5-B: el debuff primitivo cuesta −0,10 de fidelidad por turno.
    if (seat.debuffPrimitive) seat.fidelity -= 0.1;
    seat.fidelity = Math.max(0.1, Math.min(1.5, seat.fidelity));
  }

  // 7. Evento mundial: una tirada por turno.
  const eventRand = rng(next.seed, next.turn, 7);
  const roll = 1 + Math.floor(eventRand() * 20);
  const active = activeSeats(next);
  if (active.length > 0) {
    const victim = active[Math.floor(eventRand() * active.length)];
    if (victim) {
      const text = applyWorldEvent(next, victim, roll);
      next.events.push({
        turn: next.turn,
        visibility: 'public',
        seatId: victim.id,
        kind: 'world',
        text,
        data: { roll },
      });
    }
  }

  // 8-9. Contacto, choque y guerra (§9, §5-A.11).
  const warRand = rng(next.seed, next.turn, 77);
  if (next.war) {
    const attacker = next.seats.find((s) => s.id === next.war?.a);
    const defender = next.seats.find((s) => s.id === next.war?.b);
    const valid = attacker && defender && attacker.vassalOf === null && defender.vassalOf === null;
    if (!valid || !attacker || !defender) {
      next.war = null;
    } else {
      // Batalla (§9): d20 + poder + floor(Divinidad/2) contra 10 + poder rival.
      const roll = 1 + Math.floor(warRand() * 20);
      const attack = roll + powerOf(attacker) + Math.floor(attacker.divinity / 2);
      const defence = 10 + powerOf(defender);
      const margin = attack - defence;
      const stalemate = next.turn - next.war.sinceTurn >= 3;

      if (margin >= 5) {
        // Vasallaje (§9): el derrotado entrega su estatua y su Fe se reduce al 50 %.
        const winner = attacker;
        const loser = defender;
        loser.vassalOf = winner.id;
        loser.fe = Math.floor(loser.fe * 0.5);
        awardMilestone(next, winner, 'war_1');
        awardMilestone(next, winner, 'vassal_1');
        next.war = null;
        next.windowBeforeWar = null;
        next.peaceUntilTurn = next.turn + 5;
        next.events.push({
          turn: next.turn,
          visibility: 'public',
          seatId: winner.id,
          kind: 'war',
          text: `${winner.name} vence a ${loser.name} y lo convierte en vasallo.`,
        });
      } else if (stalemate) {
        next.war = null;
        next.peaceUntilTurn = next.turn + 5;
        next.events.push({
          turn: next.turn,
          visibility: 'public',
          seatId: null,
          kind: 'peace',
          text: `La guerra entre ${attacker.name} y ${defender.name} se apaga sin vasallaje.`,
        });
      } else {
        next.events.push({
          turn: next.turn,
          visibility: 'public',
          seatId: attacker.id,
          kind: 'battle',
          text: margin >= 0
            ? `${attacker.name} impone la batalla a ${defender.name}, pero no basta para vasallizar.`
            : `${defender.name} resiste la embestida de ${attacker.name}.`,
          data: { roll, attack, defence },
        });
      }
    }
  } else {
    const freeSeats = activeSeats(next).filter((s) => s.vassalOf === null);
    if (freeSeats.length >= 2) {
      const a = freeSeats[Math.floor(warRand() * freeSeats.length)];
      const b = freeSeats[Math.floor(warRand() * freeSeats.length)];
      if (a && b && a.id !== b.id) {
        if (next.milestones.clash === undefined && warRand() < 0.12) {
          grantShared(next, 'clash', [a, b], 5, 'fidelidad+');
          next.windowOverride = { windowId: '1d', untilDay: next.fictionDay + days + 2 };
          next.events.push({
            turn: next.turn,
            visibility: 'public',
            seatId: a.id,
            kind: 'clash',
            text: `Choque de civilizaciones: ${a.name} y ${b.name}. El tiempo se detiene.`,
          });
        } else if (next.turn >= next.peaceUntilTurn && warRand() < 0.022) {
          // §9: solo se declara guerra con ventaja militar clara; sin ella, no.
          const stronger = powerOf(a) >= powerOf(b) ? a : b;
          const weaker = stronger === a ? b : a;
          const ratio = powerOf(stronger) / Math.max(1, powerOf(weaker));
          if (ratio >= 2.2) {
            next.war = { a: stronger.id, b: weaker.id, sinceTurn: next.turn };
            next.windowBeforeWar = windowId;
            next.events.push({
              turn: next.turn,
              visibility: 'public',
              seatId: stronger.id,
              kind: 'war_declared',
              text: `${stronger.name} declara la guerra a ${weaker.name}.`,
            });
          }
        }
      }
    }
  }

  // 10-11. Época: la barra solo sube (ratchet), avance y válvula de estancamiento.
  const progress = eraProgress(next);
  if (progress > next.eraBar) next.lastBarRiseTurn = next.turn;
  next.eraBar = Math.max(next.eraBar, progress);

  if (next.eraBar >= 1 && next.era !== 'modernidad') {
    const index = ERAS.findIndex((e) => e.id === next.era);
    const following = ERAS[index + 1];
    if (following) {
      next.era = following.id;
      next.eraAdvancedTurn = next.turn;
      next.eraBar = 0;
      next.lastBarRiseTurn = next.turn;
      for (const seat of next.seats) {
        seat.techs = [];
        seat.culture = [];
      }
      next.events.push({
        turn: next.turn,
        visibility: 'public',
        seatId: null,
        kind: 'era',
        text: `El mundo entra en ${following.name}.`,
      });
    }
  } else if (next.turn - next.lastBarRiseTurn >= STALL_TURNS) {
    // Válvula de B.8: si el mundo se congela, la civilización más atrasada
    // recibe una tecnología. Un dios dormido no puede servir: no cuenta en la
    // media, así que no movería la barra.
    const active = activeSeats(next);
    const laggard = active.reduce<Seat | null>(
      (best, seat) => (best === null || seat.techs.length < best.techs.length ? seat : best),
      null,
    );
    const tech = laggard ? nextTechId(laggard, next.era) : null;
    if (laggard && tech) {
      laggard.techs.push(tech);
      next.lastBarRiseTurn = next.turn;
      next.events.push({
        turn: next.turn,
        visibility: 'public',
        seatId: laggard.id,
        kind: 'stall',
        text: `${laggard.name} recibe una tecnología de un pueblo olvidado: el mundo vuelve a moverse.`,
      });
    }
  }

  const grace = next.eraAdvancedTurn !== null && next.turn - next.eraAdvancedTurn <= 3;
  for (const seat of next.seats) {
    if (seat.kind === 'dormant' || seat.believers <= 0) continue;
    const verdict = evaluateDebuff(next, seat);
    const activeDebuff = !grace && verdict.active;
    if (!activeDebuff) {
      seat.debuffPrimitive = false;
      seat.debuffFromCulture = false;
      seat.debuffTurns = 0;
      seat.debuffLevel = 0;
      seat.debuffMissionTurn = null;
      continue;
    }
    if (!seat.debuffPrimitive) {
      // Nueva activación: se abre la cadena de misiones con 5 turnos de plazo.
      seat.debuffMissionTurn = next.turn + MISSION_TURNS;
    } else if (seat.debuffMissionTurn !== null && next.turn >= seat.debuffMissionTurn) {
      // §5-B.5: la misión caducó, el debuff sube un escalón (hasta −30 %).
      seat.debuffLevel = Math.min(3, seat.debuffLevel + 1);
      seat.debuffMissionTurn = next.turn + MISSION_TURNS;
    }
    seat.debuffPrimitive = true;
    seat.debuffFromCulture = verdict.fromCulture;
    seat.debuffTurns += 1;
  }

  // 12. Buffs y niveles.
  for (const seat of next.seats) {
    expireBuffs(seat, next.turn);
    let level = 1;
    for (let i = 2; i <= 11; i += 1) {
      const threshold = XP_THRESHOLDS[i];
      if (threshold !== undefined && seat.xp >= threshold) level = i;
    }
    seat.divinity = level;
  }

  // 13. Hitos globales. Todos los asientos actúan a la vez, así que varios pueden
  // cruzar el umbral en el mismo turno: se lo queda el que más lejos lo supera
  // (población, luego tecnología, luego id menor). Decidirlo por orden de asiento
  // daba un premio sistemático al asiento 0.
  for (const def of MILESTONES) {
    if (next.milestones[def.key] !== undefined) continue;
    let winner: Seat | null = null;
    for (const seat of next.seats) {
      if (seat.kind === 'dormant' || seat.believers <= 0) continue;
      if (!def.check(seat, next)) continue;
      if (winner === null || moreMerit(seat, winner)) winner = seat;
    }
    if (winner) awardMilestone(next, winner, def.key);
  }

  // 14. Victoria y horizonte.
  const remaining = activeSeats(next);
  const lords = remaining.filter((s) => s.vassalOf === null);
  if (remaining.length >= 2 && lords.length === 1 && remaining.length > 1) {
    const lord = lords[0];
    const everyoneElseVassal = remaining.every((s) => s.id === lord?.id || s.vassalOf === lord?.id);
    if (lord && everyoneElseVassal) {
      next.finished = true;
      next.winnerSeat = lord.id;
    }
  }

  next.fictionDay += days;
  next.turn += 1;
  const unlockIndex = Math.floor((next.turn - 1) / next.unlockEvery);
  const unlocked = WINDOW_LADDER[unlockIndex];
  if (unlocked && !next.windowsUnlocked.includes(unlocked)) next.windowsUnlocked.push(unlocked);

  if (!next.finished && next.fictionDay >= next.horizonYears * 365) {
    next.finished = true;
    let best: Seat | null = null;
    let bestScore = -Infinity;
    for (const seat of next.seats) {
      if (seat.kind === 'dormant') continue;
      const value = scoreOf(next, seat);
      if (value > bestScore) {
        bestScore = value;
        best = seat;
      }
    }
    next.winnerSeat = best ? best.id : null;
  }

  return next;
}

/** Desempate de hitos globales: más fieles, luego más tecnologías, luego id menor. */
function moreMerit(a: Seat, b: Seat): boolean {
  if (a.believers !== b.believers) return a.believers > b.believers;
  if (a.techs.length !== b.techs.length) return a.techs.length > b.techs.length;
  return a.id < b.id;
}

export function scoreOf(state: MatchState, seat: Seat): number {
  const vassals = state.seats.filter((s) => s.vassalOf === seat.id).length;
  const milestones = Object.values(state.milestones).filter((id) => id === seat.id).length;
  return (
    vassals * 100 +
    seat.divinity * 10 +
    seat.believers / 10 +
    seat.techs.length * 5 +
    seat.relics * 5 +
    milestones * 10
  );
}

export function copyState(state: MatchState): MatchState {
  return structuredClone(state);
}
