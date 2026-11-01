import { ACTIONS, isWindowAllowed } from '../engine/content';
import { capFe, incomeTurn } from '../engine/economy';
import { cultureScore, dimensionAverages, populationScore, techScore } from '../engine/ic';
import { problemFor } from '../engine/problems';
import {
  BEATS_PER_TURN,
  BeatAction,
  DivinityBand,
  MatchState,
  Order,
  Seat,
  WINDOWS,
  WindowId,
  bandOf,
} from '../engine/types';

export type Personality = 'expansionist' | 'fanatic' | 'machiavellian';
export type Difficulty = 'normal' | 'corrupto';

/**
 * §5-B.8: los bots reparten entre las tres dimensiones. Sin eso la barra se
 * estanca en una sola dimensión y el mundo nunca cambia de era. Las personalidades
 * deciden qué dimensión empujan con más fuerza, no si la empujan.
 *
 * Son los pesos validados en §18.1 (Fase 0): tocarlos exige re-medir la
 * simulación. El carácter de cada personalidad viene del SABOR acotado de
 * abajo, no de reventar estas cifras (D65).
 */
const WEIGHTS: Record<Personality, { tech: number; population: number; culture: number }> = {
  expansionist: { tech: 0.9, population: 1.1, culture: 1.0 },
  fanatic: { tech: 0.9, population: 1.0, culture: 1.4 },
  machiavellian: { tech: 1.4, population: 0.9, culture: 1.0 },
};

/**
 * §17.1: el carácter propio de cada personalidad — territorio el Expansivo,
 * fidelidad (y con ella fieles y fama) el Fanático, profecías el Maquiavelo.
 * Van por delante de las dimensiones pero **acotadas por turno** (`ACTION_CAPS`)
 * y en canales propios: un sabor de 2 compases en `obra` desplaza al hito
 * cultural y congela la barra (medido: tribal eterna al 92 %). Los susurros y
 * el sabotaje son acciones de área (catálogo de la Fase 5).
 */
const FLAVOR: Record<Personality, string[]> = {
  expansionist: ['expandir'],
  fanatic: ['milagro'],
  machiavellian: ['profecia'],
};

/** Sabores y profecías: máximo dos compras por turno; la expansión y el
 * farol, una (la expansión es la bola de nieve del poder militar). La
 * bendición no lleva tope porque no está en ningún sabor: solo rellena. */
const ACTION_CAPS: Record<string, number> = {
  expandir: 1,
  milagro: 2,
  profecia: 1,
};

/** Acciones que empujan cada dimensión, de más cara a más barata. */
const DIMENSION_ACTIONS: Record<keyof typeof WEIGHTS['expansionist'], string[]> = {
  tech: ['investigar'],
  population: ['expandir', 'templo'],
  culture: ['hito_cultural', 'creacion'],
};

/** §5-B.5: las misiones de recuperación, por dimensión. */
const DIMENSION_MISSIONS: Record<keyof typeof DIMENSION_ACTIONS, string[]> = {
  tech: ['emisarios', 'copiar_oficio', 'contratar_sabios', 'reforma_educativa'],
  population: ['tierra_prometida', 'anio_cosechas'],
  culture: ['mecenazgo', 'reforma_religiosa'],
};

/** Relleno cuando ninguna dimensión priorizada cabe en el compás. */
const FILLER = ['bendicion', 'milagro', 'silencio'];

/** La banca pura: el Corrupto que va por delante guarda el último compás. */
const BANK = 'silencio';

export function personalityOf(seat: Seat): Personality {
  const list: Personality[] = ['expansionist', 'fanatic', 'machiavellian'];
  return list[seat.id % list.length] as Personality;
}

interface Dimension {
  key: keyof typeof WEIGHTS['expansionist'];
  /** Preferencia: peso de la personalidad × retraso contra el mundo, + 0,5 de base. */
  score: number;
}

function preferences(state: MatchState, seat: Seat): Dimension[] {
  const world = dimensionAverages(state);
  const own = {
    tech: techScore(seat),
    population: populationScore(seat, state.era),
    culture: cultureScore(seat),
  };
  const weights = WEIGHTS[personalityOf(seat)];
  // §5-B.4: mientras dura el debuff primitivo el atrasado acelera la recuperación.
  const recovery = seat.debuffPrimitive ? 1.6 : 1;
  return (Object.keys(weights) as (keyof typeof weights)[]).map((key) => ({
    key,
    // Un dios que va por delante sigue invirtiendo, pero menos; uno que va
    // atrasado prioriza cerrar la brecha porque es donde está el debuff.
    score: weights[key] * (0.5 + 0.4 * recovery * Math.max(-0.4, world[key] - own[key])),
  }));
}

/**
 * Orden de prioridad para este turno, sin tocar el Fe de nadie más que el propio:
 * la política solo ve su estado y la información pública del mundo (era, barra,
 * promedios de dimensión y ventana). El Corrupto añade las bandas de Divinidad
 * de los rivales (§17.1) y nada más: nunca un dato exacto.
 */
function priorityOrder(state: MatchState, seat: Seat): string[] {
  const flavor = FLAVOR[personalityOf(seat)];
  const ordered: string[] = [...flavor];
  const dims = preferences(state, seat).sort((a, b) => b.score - a.score);
  for (const dim of dims) {
    // §5-B.5: mientras dura el debuff, la misión de esa dimensión va primero.
    if (seat.debuffPrimitive) {
      for (const mission of DIMENSION_MISSIONS[dim.key]) if (!ordered.includes(mission)) ordered.push(mission);
    }
    for (const action of DIMENSION_ACTIONS[dim.key]) if (!ordered.includes(action)) ordered.push(action);
  }
  for (const action of FILLER) if (!ordered.includes(action)) ordered.push(action);
  return ordered;
}

const BAND_ORDER: Record<DivinityBand, number> = { baja: 0, media: 1, alta: 2 };

/** La mejor banda de Divinidad de los rivales (§16: la banda es pública). */
function bestRivalBand(state: MatchState, seat: Seat): DivinityBand {
  let best = 'baja' as DivinityBand;
  for (const other of state.seats) {
    if (other.id === seat.id) continue;
    if (BAND_ORDER[bandOf(other.divinity)] > BAND_ORDER[best]) best = bandOf(other.divinity);
  }
  return best;
}

const reactive = (windowId: WindowId): boolean =>
  ['1d', '7d', '30d'].includes(windowId);

/**
 * Devuelve una orden legal. No conoce el futuro ni la Fe de los rivales.
 * `difficulty` es la de §17.1: `normal` (por defecto en pruebas y torneos)
 * ve solo lo público y lo propio; `corrupto` añade las bandas rivales.
 */
export function planFor(state: MatchState, seat: Seat, difficulty: Difficulty = 'normal'): Order {
  const days = WINDOWS[state.windowId].days;
  const perBeat = incomeTurn(seat, days) / BEATS_PER_TURN;
  let projected = seat.fe;
  const busyUntil: Record<string, number> = { milagro: -1, obra: -1, heroe: -1, palabra: -1 };
  const used: Record<string, number> = {};
  const plan: BeatAction[] = [];

  const behind =
    difficulty === 'corrupto' &&
    BAND_ORDER[bandOf(seat.divinity)] < BAND_ORDER[bestRivalBand(state, seat)];
  const order = priorityOrder(state, seat);
  const reserveLast = reactive(state.windowId) && BEATS_PER_TURN > 1;

  const legal = (actionId: string, beat: number): typeof ACTIONS[string] | null => {
    const def = ACTIONS[actionId];
    if (!def) return null;
    if ((busyUntil[def.channel] ?? -1) >= beat) return null;
    if (!isWindowAllowed(def.minWindow, state.windowId)) return null;
    if (def.available && !def.available(seat, state)) return null;
    const cap = ACTION_CAPS[actionId];
    if (cap !== undefined && (used[actionId] ?? 0) >= cap) return null;
    return def;
  };

  for (let beat = 0; beat < BEATS_PER_TURN; beat += 1) {
    projected += perBeat;
    const isLast = beat === BEATS_PER_TURN - 1;
    const candidates = reserveLast && isLast ? FILLER : order;
    // Corrupto que va por delante en banda (§17.1): banca el último compás
    // para conservar la distancia con Fe fresco. Es lo único que añaden las
    // bandas de Divinidad (§16): nunca un dato exacto. Normal ni las mira.
    const banking = difficulty === 'corrupto' && !behind && isLast;

    // Ahorro: el Fe es escaso al principio (§5-A.5). Si un objetivo prioritario
    // es alcanzable con lo que queda este turno, se guarda el dinero en lugar
    // de gastarlo en relleno. Sin esto el bot se gasta el Fe en milagros baratos
    // y nunca llega a investigar. El Corrupto que va detrás jamás banca: cada
    // compás cuenta para la persecución (bandas de §16, nunca datos exactos).
    const budget = projected + perBeat * (BEATS_PER_TURN - 1 - beat);
    const target = candidates.find((id) => {
      const def = legal(id, beat);
      return def !== null && def.cost(seat, state) <= budget;
    });
    const targetDef = target ? legal(target, beat) : null;
    const save = targetDef !== null && targetDef.cost(seat, state) > projected;

    const list = save
      ? FILLER.filter((id) => (legal(id, beat)?.cost(seat, state) ?? 1) === 0)
      : banking
        ? [BANK]
        : candidates;

    for (const actionId of list) {
      const def = legal(actionId, beat);
      if (!def) continue;
      const cost = def.cost(seat, state);
      if (projected < cost) continue;
      projected -= cost;
      used[actionId] = (used[actionId] ?? 0) + 1;
      plan.push({ beat, channel: def.channel, action: actionId });
      busyUntil[def.channel] = beat + def.beats - 1;
      break;
    }
  }
  return { seatId: seat.id, plan };
}

/* ------------------------------------------------------------------ */
/* Problemas de era (§15, cierra D51)                                   */
/* ------------------------------------------------------------------ */

/**
 * Ponderación de los `impact` por personalidad. El Fanático persigue FIELES
 * por la vía que existe en los problemas: las opciones que los suman
 * (migrar, obras, negociar) pesan mucho para él; el Expansivo prefiere el
 * sacrificio que financia Fe y fama, y el Maquiavelo las opciones de Fe
 * e intriga. Los fieles pesan en todas: quemar el ingreso futuro fue el freno
 * que la simulación destapó (reinos en el turno 100).
 */
const PROBLEM_WEIGHTS: Record<
  Personality,
  { believers: number; fidelity: number; regions: number; fame: number; fe: number }
> = {
  expansionist: { believers: 3, fidelity: 15, regions: 30, fame: 2, fe: 0.3 },
  fanatic: { believers: 8, fidelity: 25, regions: 5, fame: 4, fe: 0.25 },
  machiavellian: { believers: 2.8, fidelity: 12, regions: 3, fame: 3, fe: 0.55 },
};

/** Lo que cuesta desviar Fe del plan de compases, por unidad gastada. */
const PROBLEM_COST_WEIGHT = 0.15;
/** Un problema no se puede comer más de la cuarta parte del tope de Fe. */
const PROBLEM_COST_CAP = 0.25;

/**
 * Elige la opción del problema de era según la personalidad y el Fe propio.
 * Solo devuelve opciones asequibles que no comprometan la economía (un problema
 * no puede comerse más del 25 % del tope: los compases siguen mandando); si no
 * hay ninguna, no elige (sin elección no hay efecto, REGLAS §15.1).
 * Determinista: empate por id menor.
 */
export function chooseProblemOption(state: MatchState, seat: Seat): string | undefined {
  const problem = problemFor(state);
  const weights = PROBLEM_WEIGHTS[personalityOf(seat)];
  const costCeiling = Math.floor(capFe(seat) * PROBLEM_COST_CAP);
  let best: string | undefined;
  let bestScore = -Infinity;
  for (const option of problem.options) {
    if (seat.fe < option.cost) continue;
    if (option.cost > costCeiling) continue;
    const impact = option.impact ?? {};
    const score =
      weights.believers * (impact.believers ?? 0) +
      weights.fidelity * (impact.fidelity ?? 0) +
      weights.regions * (impact.regions ?? 0) +
      weights.fame * (impact.fame ?? 0) +
      weights.fe * (impact.fe ?? 0) -
      PROBLEM_COST_WEIGHT * option.cost;
    if (score > bestScore || (score === bestScore && best !== undefined && option.id < best)) {
      bestScore = score;
      best = option.id;
    }
  }
  return best;
}
