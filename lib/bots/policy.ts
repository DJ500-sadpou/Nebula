import { ACTIONS, isWindowAllowed } from '../engine/content';
import { incomeTurn } from '../engine/economy';
import { cultureScore, dimensionAverages, populationScore, techScore } from '../engine/ic';
import { BEATS_PER_TURN, BeatAction, MatchState, Order, Seat, WINDOWS, WindowId } from '../engine/types';

export type Personality = 'expansionist' | 'fanatic' | 'machiavellian';

/**
 * §5-B.8: los bots reparten entre las tres dimensiones. Sin eso la barra se
 * estanca en una sola dimensión y el mundo nunca cambia de era. Las personalidades
 * deciden qué dimensión empujan con más fuerza, no si la empujan.
 */
const WEIGHTS: Record<Personality, { tech: number; population: number; culture: number }> = {
  expansionist: { tech: 0.9, population: 1.1, culture: 1.0 },
  fanatic: { tech: 0.9, population: 1.0, culture: 1.4 },
  machiavellian: { tech: 1.4, population: 0.9, culture: 1.0 },
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
 * promedios de dimensión y ventana).
 */
function priorityOrder(state: MatchState, seat: Seat): string[] {
  const dims = preferences(state, seat).sort((a, b) => b.score - a.score);
  const ordered: string[] = [];
  for (const dim of dims) {
    // §5-B.5: mientras dura el debuff, la misión de esa dimensión va primero.
    if (seat.debuffPrimitive) ordered.push(...DIMENSION_MISSIONS[dim.key]);
    ordered.push(...DIMENSION_ACTIONS[dim.key]);
  }
  for (const action of FILLER) if (!ordered.includes(action)) ordered.push(action);
  return ordered;
}

const reactive = (windowId: WindowId): boolean =>
  ['1d', '7d', '30d'].includes(windowId);

/**
 * Devuelve una orden legal. No conoce el futuro ni la Fe de los rivales.
 */
export function planFor(state: MatchState, seat: Seat): Order {
  const days = WINDOWS[state.windowId].days;
  const perBeat = incomeTurn(seat, days) / BEATS_PER_TURN;
  let projected = seat.fe;
  const busyUntil: Record<string, number> = { milagro: -1, obra: -1, heroe: -1, palabra: -1 };
  const plan: BeatAction[] = [];
  const order = priorityOrder(state, seat);
  const reserveLast = reactive(state.windowId) && BEATS_PER_TURN > 1;

  const legal = (actionId: string, beat: number): typeof ACTIONS[string] | null => {
    const def = ACTIONS[actionId];
    if (!def) return null;
    if ((busyUntil[def.channel] ?? -1) >= beat) return null;
    if (!isWindowAllowed(def.minWindow, state.windowId)) return null;
    if (def.available && !def.available(seat, state)) return null;
    return def;
  };

  for (let beat = 0; beat < BEATS_PER_TURN; beat += 1) {
    projected += perBeat;
    const isLast = beat === BEATS_PER_TURN - 1;
    const candidates = reserveLast && isLast ? FILLER : order;

    // Ahorro: el Fe es escaso al principio (§5-A.5). Si un objetivo prioritario
    // es alcanzable con lo que queda este turno, se guarda el dinero en lugar
    // de gastarlo en relleno. Sin esto el bot se gasta el Fe en milagros baratos
    // y nunca llega a investigar.
    const budget = projected + perBeat * (BEATS_PER_TURN - 1 - beat);
    const target = candidates.find((id) => {
      const def = legal(id, beat);
      return def !== null && def.cost(seat, state) <= budget;
    });
    const targetDef = target ? legal(target, beat) : null;
    const save = targetDef !== null && targetDef.cost(seat, state) > projected;

    const list = save ? FILLER.filter((id) => (legal(id, beat)?.cost(seat, state) ?? 1) === 0) : candidates;
    for (const actionId of list) {
      const def = legal(actionId, beat);
      if (!def) continue;
      const cost = def.cost(seat, state);
      if (projected < cost) continue;
      projected -= cost;
      plan.push({ beat, channel: def.channel, action: actionId });
      busyUntil[def.channel] = beat + def.beats - 1;
      break;
    }
  }
  return { seatId: seat.id, plan };
}
