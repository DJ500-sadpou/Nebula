import { applyWorldEvent } from './content';
import { activeSeats, rivalSeats, scoreOf, sleepingSeats, awakenedSeats } from './ic';
import { rng } from './rng';
import { MatchState, Seat, TurnEvent, WindowId } from './types';

/**
 * Dioses dormidos y dioses malignos (§17.2, A.8).
 *
 * Un dormido no envía órdenes, no recauda, no crece y no vota: solo existe,
 * provoca eventos del §14 y puede despertar como dios maligno. El maligno
 * tampoco recauda ni crece: su amenaza es la **agenda**, un acto por turno
 * elegido entre tres (atacar al líder, corromper, abrir una ruina demoníaca).
 *
 * Todo el azar pasa por `rng(seed, turno, paso)` con pasos propios (801–847),
 * separados del evento mundial (7), de la guerra (77) y del narrador (701–705).
 * Ningún flujo nuevo se consume cuando no hay dormidos, así las partidas
 * anteriores reproducen su huella salvo por el campo `awakened`.
 */

/** §17.2: despertar posible desde el turno 6, un dios al 10 % por turno. */
export const AWAKEN_TURN = 6;
export const AWAKEN_CHANCE = 0.1;
/** §17.2: en ventanas de 1d a 6m, 15 % por turno de evento de dormido. */
export const DORMANT_CHANCE = 0.15;
/** A.8: en 1y y 3y el compás marca el ritmo: un evento por compás. */
export const DORMANT_BEAT_WINDOWS: WindowId[] = ['1y', '3y'];

const STEP_DORMANT = 801;
const STEP_AWAKEN = 802;
const STEP_AGENDA = 803;
const STEP_BEAT = 840;

function pickFrom<T>(list: T[], rand: () => number): T | null {
  if (list.length === 0) return null;
  return list[Math.floor(rand() * list.length)] ?? null;
}

/**
 * Despierta a un dormido elegido al azar. Solo cambia la marca: el evento
 * lo redacta quien llama (el paso 7 lo cuenta como el propio 13 del §14;
 * el despertar espontáneo lleva evento propio).
 */
export function awakenOne(state: MatchState, rand: () => number): Seat | null {
  const god = pickFrom(sleepingSeats(state), rand);
  if (!god) return null;
  god.awakened = true;
  return god;
}

/** Texto del 13 del §14 cuando hay (o no hay) dormidos que traicionar. */
export function traitorNightText(god: Seat | null): string {
  return god
    ? `Noche de la traición: ${god.name} despierta como dios maligno.`
    : 'El mundo respira.';
}

/**
 * Texto del evento mundial con el 13 del §14 interceptado: sin dormidos es
 * idéntico a `applyWorldEvent` (incluido el «El mundo respira» del default).
 */
export function worldEventText(
  state: MatchState,
  victim: Seat,
  roll: number,
  rand: () => number,
): string {
  if (roll === 13) return traitorNightText(awakenOne(state, rand));
  return applyWorldEvent(state, victim, roll);
}

/** Un evento del §14 causado por un dios dormido sobre un rival de la mesa. */
function dormantEvent(state: MatchState, rand: () => number): TurnEvent | null {
  const god = pickFrom(sleepingSeats(state), rand);
  const victim = pickFrom(rivalSeats(state), rand);
  if (!god || !victim) return null;
  const roll = 1 + Math.floor(rand() * 20);
  // La Noche de la traición (13) pertenece a la tirada MUNDIAL de §14 («una
  // sola tirada por turno», paso 7): los eventos que provocan los dormidos
  // no despiertan a nadie; su 13 es el «nada pasa» de siempre.
  const text =
    roll === 13
      ? applyWorldEvent(state, victim, roll)
      : worldEventText(state, victim, roll, rand);
  const body =
    text === 'El mundo respira.'
      ? `El eco de ${god.name} recorre el mundo: nada pasa.`
      : `El eco de ${god.name} sacude el mundo: ${text}`;
  return {
    turn: state.turn,
    visibility: 'public',
    seatId: victim.id,
    kind: 'world',
    text: body,
    data: { roll, source: god.name },
  };
}

/**
 * Paso 7-bis (§17.2, A.8): eventos de los dormidos. En `1y` y `3y`, uno por
 * compás; en el resto de ventanas, 15 % por turno. Se aplican tras el evento
 * mundial y antes de la guerra, sin tocar la fase de compases (A.12).
 */
export function runDormantEvents(state: MatchState): void {
  if (sleepingSeats(state).length === 0) return;
  if (DORMANT_BEAT_WINDOWS.includes(state.windowId)) {
    for (let beat = 0; beat < 8; beat += 1) {
      const rand = rng(state.seed, state.turn, STEP_BEAT + beat);
      const event = dormantEvent(state, rand);
      if (event) state.events.push(event);
    }
    return;
  }
  const rand = rng(state.seed, state.turn, STEP_DORMANT);
  if (rand() >= DORMANT_CHANCE) return;
  const event = dormantEvent(state, rand);
  if (event) state.events.push(event);
}

/**
 * Paso 7-ter (§17.2): desde el turno 6, 10 % por turno de que UN dios
 * dormido despierte como maligno. Los dormidos que quedan siguen tirando
 * en los turnos siguientes: puede despertar más de uno por partida.
 */
export function runAwakening(state: MatchState): void {
  if (state.turn < AWAKEN_TURN) return;
  if (sleepingSeats(state).length === 0) return;
  const rand = rng(state.seed, state.turn, STEP_AWAKEN);
  if (rand() >= AWAKEN_CHANCE) return;
  const god = awakenOne(state, rand);
  if (!god) return;
  state.events.push({
    turn: state.turn,
    visibility: 'public',
    seatId: god.id,
    kind: 'awakening',
    text: `${god.name} abre los ojos: un dios maligno camina por el mundo.`,
  });
}

/** Líder de la mesa entre las civilizaciones: mayor puntuación de §10; empate, id menor. */
function leaderAmong(civs: Seat[], state: MatchState): Seat | null {
  let leader: Seat | null = null;
  let best = -Infinity;
  for (const seat of civs) {
    const value = scoreOf(state, seat);
    if (value > best || (value === best && leader !== null && seat.id < leader.id)) {
      best = value;
      leader = seat;
    }
  }
  return leader;
}

/**
 * Paso 7-quater (§17.2): la agenda del dios maligno. Un acto por turno y por
 * maligno, elegido al azar entre tres, con efecto inmediato y público sobre
 * las civilizaciones (el maligno no ataca a otros dormidos: no hay nadie).
 */
export function runAgenda(state: MatchState): void {
  const gods = awakenedSeats(state);
  if (gods.length === 0) return;
  const civs = activeSeats(state);
  if (civs.length === 0) return;
  for (const god of gods) {
    const rand = rng(state.seed, state.turn, STEP_AGENDA + god.id);
    const act = Math.floor(rand() * 3);
    if (act === 0) {
      const leader = leaderAmong(civs, state);
      if (!leader) continue;
      leader.believers = Math.max(1, Math.round(leader.believers * 0.95));
      leader.fidelity = Math.max(0.1, leader.fidelity - 0.05);
      state.events.push({
        turn: state.turn,
        visibility: 'public',
        seatId: god.id,
        kind: 'agenda',
        text: `El dios maligno ${god.name} marcha contra ${leader.name}: sus fieles tiemblan.`,
      });
    } else if (act === 1) {
      const victim = pickFrom(civs, rand);
      if (!victim) continue;
      victim.fidelity = Math.max(0.1, victim.fidelity - 0.08);
      state.events.push({
        turn: state.turn,
        visibility: 'public',
        seatId: god.id,
        kind: 'agenda',
        text: `Los susurros de ${god.name} corrompen el corazón de ${victim.name}.`,
      });
    } else {
      const victim = pickFrom(civs, rand);
      if (!victim) continue;
      victim.fidelity = Math.max(0.1, victim.fidelity - 0.05);
      god.xp += 10;
      state.events.push({
        turn: state.turn,
        visibility: 'public',
        seatId: god.id,
        kind: 'agenda',
        text: `${god.name} abre una ruina demoníaca a las puertas de ${victim.name}.`,
      });
    }
  }
}
