import { planFor } from '../bots/policy';
import { passiveForArea } from '../engine/areas';
import { ACTIONS, isWindowAllowed } from '../engine/content';
import { activeSeats } from '../engine/ic';
import { createInitialState, resolveTurn, scoreOf } from '../engine/resolve';
import {
  BeatAction,
  Channel,
  MatchState,
  Order,
  TurnEvent,
} from '../engine/types';
import { chronicleFor, TurnChronicle } from '../narrator/chronicle';

/**
 * Modo «La peor carta» (§19): la partida de iniciación, 4–8 asientos y 12
 * turnos con `unlockEvery: 3`. La rebanada de la Fase 3 juega la versión de un
 * humano contra tres bots.
 *
 * El estado no guarda el tope de turnos: es configuración de la mesa (columna
 * `config`), igual que el modo. Así el motor no aprende nada de modos.
 */

export const PEOR_CARTA = {
  mode: 'peor_carta',
  seats: 4,
  humans: 1,
  unlockEvery: 3,
  horizonYears: 30,
  turnLimit: 12,
  /**
   * Votantes de la mesa simulada. En la rebanada el único humano no vota
   * todavía (la papeleta es Fase 4); el motor sortea la ventana con un votante,
   * que es el humano, y la aplica. Está anotado en DECISIONES.md.
   */
  tableVoters: 1,
} as const;

const CHANNELS: Channel[] = ['milagro', 'obra', 'heroe', 'palabra'];
const MAX_ACTIONS = 32;

/** §19: la iniciación te da la peor Área Pequeña, *Insectos* (§1.2). */
export function createSoloState(seed: number): MatchState {
  const state = createInitialState({
    seats: PEOR_CARTA.seats,
    humans: PEOR_CARTA.humans,
    seed,
    unlockEvery: PEOR_CARTA.unlockEvery,
    horizonYears: PEOR_CARTA.horizonYears,
    tableVoters: PEOR_CARTA.tableVoters,
  });
  const human = state.seats[0];
  if (human) {
    human.areaCard = 'Insectos';
    human.magic = passiveForArea('Insectos').magia;
  }
  return state;
}

export interface PlanInput {
  beat: number;
  channel: string;
  action: string;
}

/**
 * Sanea el plan que llega del cliente. El servidor no confía en el cliente:
 * descarta compases fuera de rango, acciones desconocidas y canales que no
 * correspondan. Las que sobreviven siguen pasando por las comprobaciones del
 * motor (Fe, ventana, requisitos).
 */
export function sanitizePlan(raw: unknown): BeatAction[] {
  if (!Array.isArray(raw)) return [];
  const plan: BeatAction[] = [];
  for (const item of raw.slice(0, MAX_ACTIONS)) {
    if (typeof item !== 'object' || item === null) continue;
    const entry = item as Record<string, unknown>;
    const beat = Number(entry.beat);
    const channel = String(entry.channel);
    const action = String(entry.action);
    if (!Number.isInteger(beat) || beat < 0 || beat >= 8) continue;
    if (!CHANNELS.includes(channel as Channel)) continue;
    const def = ACTIONS[action];
    if (!def || def.channel !== channel) continue;
    plan.push({ beat, channel: channel as Channel, action });
  }
  return plan;
}

export function sanitizeProblemOption(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.length > 0 && raw.length <= 40 ? raw : undefined;
}

export interface ActionOptionView {
  id: string;
  name: string;
  channel: Channel;
  beats: number;
  cost: number;
  affordable: boolean;
}

/** Opciones ya valoradas por el servidor (§3.1). El cliente no calcula costes. */
export function actionOptions(state: MatchState, seatId: number): ActionOptionView[] {
  const seat = state.seats.find((item) => item.id === seatId);
  if (!seat) return [];
  return Object.values(ACTIONS)
    .filter((def) => isWindowAllowed(def.minWindow, state.windowId))
    .filter((def) => !def.available || def.available(seat, state))
    .map((def) => {
      const cost = def.cost(seat, state);
      return {
        id: def.id,
        name: def.name,
        channel: def.channel,
        beats: def.beats,
        cost,
        affordable: seat.fe >= cost,
      };
    })
    .sort((a, b) => a.channel.localeCompare(b.channel) || a.cost - b.cost);
}

export interface SoloTurnResult {
  state: MatchState;
  orders: Order[];
  chronicle: TurnChronicle;
  events: TurnEvent[];
  /** El turno cerró la partida por tope de turnos o por victoria. */
  closed: boolean;
}

/**
 * Resuelve un turno completo: el plan del humano, la política de los bots y,
 * si toca, el cierre por tope de turnos con puntuación (§5-A.9).
 */
export function resolveSoloTurn(
  state: MatchState,
  humanSeat: number,
  plan: BeatAction[],
  problemOption: string | undefined,
  turnLimit: number,
): SoloTurnResult {
  const orders: Order[] = activeSeats(state).map((seat) => {
    if (seat.id === humanSeat) {
      return problemOption ? { seatId: seat.id, plan, problemOption } : { seatId: seat.id, plan };
    }
    const policy = planFor(state, seat);
    return { seatId: seat.id, plan: policy.plan };
  });

  const next = resolveTurn(state, orders);
  let closed = next.finished;

  if (!next.finished && next.turn - 1 >= turnLimit) {
    closed = true;
    next.finished = true;
    let best: number | null = null;
    let bestScore = -Infinity;
    for (const seat of next.seats) {
      if (seat.kind === 'dormant') continue;
      const value = scoreOf(next, seat);
      if (value > bestScore) {
        bestScore = value;
        best = seat.id;
      }
    }
    next.winnerSeat = best;
    const winner = next.seats.find((seat) => seat.id === best);
    next.events.push({
      turn: next.turn - 1,
      visibility: 'public',
      seatId: best,
      kind: 'end',
      text: `El ciclo de iniciación se cierra. ${
        winner ? `El mundo recuerda a ${winner.name}.` : 'Nadie será recordado.'
      }`,
    });
  }

  const chronicle = chronicleFor(next, humanSeat);
  const turnEvents = next.events.filter((event) => event.turn === next.turn - 1);

  return { state: next, orders, chronicle, events: turnEvents, closed };
}
