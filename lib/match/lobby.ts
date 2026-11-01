import { chooseProblemOption, planFor } from '../bots/policy';
import { createInitialState, resolveTurn } from '../engine/resolve';
import { activeSeats, scoreOf } from '../engine/ic';
import { chronicleFor } from '../narrator/chronicle';
import {
  MatchState,
  Order,
  Seat,
  SeatKind,
  TurnEvent,
} from '../engine/types';
import type { BallotInput } from '../engine/ballot';

/**
 * Multijugador (PLAN.md §6, Fase 4): salas con código de 6 caracteres, de 4 a
 * 32 asientos, relleno automático con bots al iniciar y órdenes secretas por
 * asiento. El turno se cierra cuando todos los humanos han enviado sus órdenes
 * o cuando vence el temporizador de la mesa (§5): quien no envía juega la
 * acción por defecto («no intervenir»), nunca bloquea la partida.
 *
 * Este módulo es la orquestación pura: ni red ni base de datos. La capa de
 * datos (`lib/db`) guarda órdenes y votos, y llama a `resolveMultiTurn` cuando
 * la mesa está lista.
 */

export const MULTI_LOBBY = {
  mode: 'multi',
  /** §2: mesa por defecto de 8 asientos (2–3 humanos + bots). Techo fiel: 32. */
  seats: 8,
  unlockEvery: 5,
  horizonYears: 30,
  /** Tope de turnos por defecto de la sala; configurable al crear. */
  turnLimit: 24,
  /**
   * Temporizador de órdenes en segundos (§5): 120 por defecto, 60/240/0.
   * `0` = modo asíncrono: el turno vence a las 12 horas.
   */
  turnSeconds: 120,
  /** Segundos de gracia del modo asíncrono (§5). */
  asyncSeconds: 12 * 60 * 60,
} as const;

export const TURN_SECONDS_CHOICES = [60, 120, 240, 0];

export interface LobbyConfig {
  seats: number;
  turnLimit: number;
  turnSeconds: number;
  unlockEvery: number;
}

/** Configuración de sala saneada: nunca se confía en lo que llega del cliente. */
export function sanitizeLobbyConfig(raw: unknown): LobbyConfig | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const seats = Number(value.seats ?? MULTI_LOBBY.seats);
  const turnLimit = Number(value.turnLimit ?? MULTI_LOBBY.turnLimit);
  const turnSeconds = Number(value.turnSeconds ?? MULTI_LOBBY.turnSeconds);
  const unlockEvery = Number(value.unlockEvery ?? MULTI_LOBBY.unlockEvery);
  if (!Number.isInteger(seats) || seats < 4 || seats > 32) return null;
  if (!Number.isInteger(turnLimit) || turnLimit < 2 || turnLimit > 200) return null;
  if (!TURN_SECONDS_CHOICES.includes(turnSeconds)) return null;
  if (!Number.isInteger(unlockEvery) || unlockEvery < 1 || unlockEvery > 10) return null;
  return { seats, turnLimit, turnSeconds, unlockEvery };
}

export interface LobbySeatDef {
  seatIdx: number;
  kind: Extract<SeatKind, 'human' | 'bot' | 'dormant'>;
  /** El nick del jugador o el nombre del bot; si falta, queda el del dios del motor. */
  name?: string;
}

/**
 * Relleno al arrancar (§2, D61): los asientos libres se cubren con bots hasta
 * la mesa de referencia de 8 (humanos presentes + bots); en mesas mayores, los
 * que quedan más allá de 8 duermen como dioses dormidos y conservan el nombre
 * de dios que les dio el motor. En mesas de hasta 8 asientos, todos los libres
 * son bots, como desde la Fase 4.
 */
export function fillSeatDefs(seatCount: number, seatedIdxs: number[]): LobbySeatDef[] {
  const used = new Set(seatedIdxs);
  const free: number[] = [];
  for (let idx = 0; idx < seatCount; idx += 1) if (!used.has(idx)) free.push(idx);
  const botSeats = Math.max(0, Math.min(MULTI_LOBBY.seats, seatCount) - seatedIdxs.length);
  return free.map((idx, position) =>
    position < botSeats
      ? { seatIdx: idx, kind: 'bot' as const, name: `Bot ${idx}` }
      : { seatIdx: idx, kind: 'dormant' as const },
  );
}

/**
 * Estado inicial de una sala que arranca. La semilla reparte Áreas y Dominios
 * (§2); los asientos que ocupan humanos son los que se unieron al lobby, en el
 * índice que eligieron, y el resto se rellena con bots (hasta la mesa de
 * referencia) y, más allá, con dioses dormidos (§2, D61).
 *
 * `tableVoters` queda a 0 a propósito: en multijugador la ventana solo cambia
 * por papeleta real (§5-A.2.8: sin propuesta no hay papeleta). Si se dejara la
 * mesa simulada, un turno sin propuesta movería la ventana sin que nadie votara.
 */
export function buildMatchState(seed: number, defs: LobbySeatDef[], config: LobbyConfig): MatchState {
  const humans = defs.filter((def) => def.kind === 'human').length;
  const state = createInitialState({
    seats: defs.length,
    humans: Math.max(1, humans),
    seed,
    unlockEvery: config.unlockEvery,
    horizonYears: MULTI_LOBBY.horizonYears,
    tableVoters: 0,
  });
  for (const def of defs) {
    const seat = state.seats[def.seatIdx] as Seat | undefined;
    if (!seat) continue;
    seat.kind = def.kind;
    if (def.name !== undefined) seat.name = def.name;
  }
  return state;
}

export interface SubmittedOrders {
  seatId: number;
  /** Plan saneado por la capa de datos (`sanitizePlan`). */
  plan: Order['plan'];
  problemOption?: string;
}

export interface MultiTurnResult {
  state: MatchState;
  orders: Order[];
  /** Crónica privada por asiento humano: la pública es una para toda la mesa. */
  chronicle: { publicText: string; privateBySeat: Record<number, string> };
  events: TurnEvent[];
  closed: boolean;
}

/**
 * Resuelve un turno multijugador. Cada asiento juega las órdenes que envió
 * cuando era humano —el que abandona pasa a bot al turno SIGUIENTE, pero
 * este turno ya lo jugó él (§2)—; quien estando humano no envió juega la
 * acción por defecto «no intervenir» (§5), y los bots su política.
 */
export function resolveMultiTurn(
  state: MatchState,
  submitted: SubmittedOrders[],
  ballot: BallotInput | null,
  turnLimit: number,
): MultiTurnResult {
  const bySeat = new Map(submitted.map((item) => [item.seatId, item]));

  const orders: Order[] = activeSeats(state).map((seat) => {
    const own = bySeat.get(seat.id);
    if (own) {
      return own.problemOption
        ? { seatId: seat.id, plan: own.plan, problemOption: own.problemOption }
        : { seatId: seat.id, plan: own.plan };
    }
    if (seat.kind === 'human') {
      // §5: acción por defecto «no intervenir».
      return { seatId: seat.id, plan: [] };
    }
    // §17.1: el bot de la mesa juega como Corrupto (D63) y elige el problema
    // de era según su personalidad (D64, cierra D51).
    const policy = planFor(state, seat, 'corrupto');
    const choice = chooseProblemOption(state, seat);
    return choice
      ? { seatId: seat.id, plan: policy.plan, problemOption: choice }
      : { seatId: seat.id, plan: policy.plan };
  });

  const next = resolveTurn(state, orders, ballot);

  let closed = next.finished;
  if (!next.finished && next.turn - 1 >= turnLimit) {
    closed = true;
    next.finished = true;
    let best: number | null = null;
    let bestScore = -Infinity;
    for (const seat of next.seats) {
      // Puntúan civilizaciones y dioses malignos; el dormido que duerme no.
      if (seat.kind === 'dormant' && !seat.awakened) continue;
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
      text: `El horizonte de la sala se cierra. ${
        winner ? `El mundo recuerda a ${winner.name}.` : 'Nadie será recordado.'
      }`,
    });
  }

  // La crónica pública ancla su escena en un asiento que rota por turno
  // (determinista: (turno − 1) módulo asientos activos). Todas las voces
  // salen en escena alguna vez y recargar no cambia el texto.
  const anchorPool = activeSeats(next);
  const anchor = anchorPool.length
    ? (anchorPool[(next.turn - 1) % anchorPool.length] as Seat).id
    : state.seats[0]!.id;
  const publicText = chronicleFor(next, anchor).publicText;
  const privateBySeat: Record<number, string> = {};
  for (const seat of next.seats) {
    if (seat.kind !== 'human') continue;
    privateBySeat[seat.id] = chronicleFor(next, seat.id).privateText;
  }
  const events = next.events.filter((event) => event.turn === next.turn - 1);

  return { state: next, orders, chronicle: { publicText, privateBySeat }, events, closed };
}
