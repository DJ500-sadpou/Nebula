import { eraProgress } from '../engine/ic';
import { rng } from '../engine/rng';
import { ERAS_BY_ID, MatchState, TurnEvent, WINDOWS } from '../engine/types';
import { ALDIN, CLOSERS, OPENERS, PRIVATE, SYSTEM, fillTemplate } from './templates';

/**
 * Crónica del turno (§8 paso 13, §17.3).
 *
 * Entra `(estado resuelto, asiento)` y salen dos textos: el público, que lee
 * toda la mesa, y el privado, que solo lee ese asiento. Es determinista: la
 * misma partida produce la misma crónica, así que se puede guardar y comparar.
 */

export interface TurnChronicle {
  publicText: string;
  privateText: string;
}

const NUMBER = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });

function pick(list: string[], rand: () => number): string {
  const item = list[Math.min(list.length - 1, Math.floor(rand() * list.length))];
  if (!item) throw new Error('Plantilla vacía');
  return item;
}

function contextFor(state: MatchState): Record<string, string | number> {
  const era = ERAS_BY_ID[state.era];
  const window = WINDOWS[state.windowId];
  return {
    era: era.name,
    window: window.label,
    day: state.fictionDay,
    year: Math.floor(state.fictionDay / 365) + 1,
    month: Math.floor((state.fictionDay % 365) / 30) + 1,
    turn: Math.max(1, state.turn - 1),
    bar: Math.round(eraProgress(state) * 100),
  };
}

function seatContext(state: MatchState, seatId: number): Record<string, string | number> {
  const seat = state.seats.find((item) => item.id === seatId);
  if (!seat) throw new Error(`Asiento ${seatId} inexistente`);
  return {
    seat: seat.name,
    fe: NUMBER.format(seat.fe),
    believers: NUMBER.format(seat.believers),
    divinity: seat.divinity,
    fidelity: NUMBER.format(seat.fidelity),
    temples: seat.temples,
    regions: seat.regions,
  };
}

/** Eventos del turno recién cerrado (el estado ya está en `turn + 1`). */
export function eventsOfTurn(state: MatchState): TurnEvent[] {
  const turn = Math.max(1, state.turn - 1);
  return state.events.filter((event) => event.turn === turn);
}

export function chronicleFor(state: MatchState, seatId: number): TurnChronicle {
  const seat = state.seats.find((item) => item.id === seatId);
  if (!seat) throw new Error(`Asiento ${seatId} inexistente`);

  const events = eventsOfTurn(state);
  const base = { ...contextFor(state), ...seatContext(state, seatId) };
  const publicEvents = events.filter((event) => event.visibility === 'public');
  const ownEvents = events.filter(
    (event) => event.visibility === 'seat' && event.seatId === seatId,
  );

  const open = fillTemplate(pick(OPENERS[WINDOWS[state.windowId].register], rng(state.seed, state.turn, 701)), base);
  const close = fillTemplate(
    pick(CLOSERS[state.era] ?? CLOSERS.tribal!, rng(state.seed, state.turn, 702)),
    base,
  );
  const system = fillTemplate(pick(SYSTEM, rng(state.seed, state.turn, 703)), base);

  const notable = publicEvents.some((event) =>
    ['milestone', 'clash', 'war', 'war_declared', 'era', 'peace', 'stall'].includes(event.kind),
  );
  const aldinal = notable
    ? fillTemplate(pick(ALDIN, rng(state.seed, state.turn, 704)), base)
    : null;

  const publicParagraphs = [
    open,
    publicEvents.map((event) => event.text).join(' '),
    aldinal,
    close,
    system,
  ].filter((line): line is string => Boolean(line && line.length > 0));

  const privateParagraphs = [
    ownEvents.map((event) => event.text).join(' '),
    fillTemplate(pick(PRIVATE, rng(state.seed, state.turn, 705)), base),
  ].filter((line): line is string => Boolean(line && line.length > 0));

  if (seat.debuffPrimitive) {
    privateParagraphs.push(
      `Sumo Sacerdote: «Mi señor, el pueblo nota el atraso. Quedan ${seat.debuffTurns} turnos de descrédito y las misiones siguen abiertas».`,
    );
  }

  return {
    publicText: publicParagraphs.join('\n\n'),
    privateText: privateParagraphs.join('\n\n'),
  };
}
