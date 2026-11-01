/**
 * Papeleta de ventana (§5-A.2). La versión real de la votación de la mesa.
 *
 * Hasta la Fase 3 la ventana la sorteaba un votante simulado (D50). Aquí entra
 * la papeleta de verdad: un asiento propone, los humanos votan durante el turno
 * en curso y el resultado se aplica al turno siguiente (A.2.5). El motor sigue
 * siendo puro: los votos son datos de entrada, como las órdenes; el conteo no
 * tira dados.
 *
 * Reglas implementadas (REGLAS.md §5-A.2):
 *   A.2.1 · la propuesta debe estar desbloqueada y permitida por el mundo
 *          (A.11: un choque o una guerra recortan las opciones).
 *   A.2.2 · la papeleta ofrece la ventana actual, la propuesta y una más corta.
 *   A.2.3 · solo votan los humanos; bots y dormidos se abstienen.
 *   A.2.4 · mayoría simple de los votos emitidos; empate o sin quórum, se
 *          mantiene la actual.
 *   A.2.6 · se puede acortar, no solo alargar.
 *   A.2.7 · los votos son secretos hasta el cierre; después se publican con la
 *          crónica (el evento lo escribe `resolveTurn`).
 *
 * La papeleta no manda sola (A.11/A.12): un choque impone `1d` sin votación y
 * el ritmo fijado (`fixed`) la ignora. Eso lo decide `resolveTurn` antes de
 * contar; si una papeleta llega en un turno forzado o pactado, se descarta
 * silenciosamente y la capa de API es la que no debe abrirla.
 */

import {
  MatchState,
  WINDOW_LADDER,
  WINDOWS,
  WindowId,
} from './types';

export interface BallotVote {
  seatId: number;
  choice: WindowId;
}

export interface BallotInput {
  /** Ventana propuesta por el asiento que abre la papeleta. */
  proposal: WindowId;
  /** Votos emitidos durante el turno en curso; los repetidos toman el último. */
  votes: BallotVote[];
}

/** Estados de `turn_proposals` en la base: así se cierra la fila al resolver. */
export type BallotStatus = 'passed' | 'rejected' | 'tie' | 'quorum_failed';

export interface BallotTallyEntry {
  windowId: WindowId;
  votes: number;
}

export interface BallotOutcome {
  status: BallotStatus;
  /** Ventana elegida por mayoría; `null` mantiene la actual. */
  winner: WindowId | null;
  /** Opciones de la papeleta (A.2.2), ordenadas de corta a larga. */
  options: WindowId[];
  /** Recuento por opción, en el mismo orden que `options`. */
  tally: BallotTallyEntry[];
  /** Votos válidos contados (humanos, opción legal, un voto por asiento). */
  counted: number;
  /** Votos descartados: de bots o dormidos, opción ilegal o asiento inexistente. */
  discarded: number;
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
 * Opciones que ofrece la papeleta (A.2.2): la ventana actual, la propuesta y
 * "volver a una más corta" — el peldaño inmediatamente inferior a la actual.
 * Todas deben ser legales (A.2.1); las repetidas se funden. Orden fijo, de la
 * más corta a la más larga, para que el conteo no dependa del orden de llegada.
 */
export function ballotChoices(state: MatchState, proposal: WindowId): WindowId[] {
  const legal = ballotOptions(state);
  const currentIdx = WINDOW_LADDER.indexOf(state.windowId);
  const shorter = currentIdx > 0 ? WINDOW_LADDER[currentIdx - 1] : null;
  const unique = new Set<WindowId>([state.windowId, proposal]);
  if (shorter) unique.add(shorter);
  return WINDOW_LADDER.filter((w) => unique.has(w) && legal.includes(w));
}

/**
 * Cuenta la papeleta. Determinista y sin azar: mismo estado y mismos votos dan
 * el mismo resultado, en cualquier orden en que lleguen los votos.
 */
export function countBallot(state: MatchState, ballot: BallotInput): BallotOutcome {
  const options = ballotChoices(state, ballot.proposal);
  const choiceOf = new Map<number, WindowId>();

  let discarded = 0;
  for (const vote of ballot.votes) {
    const seat = state.seats.find((item) => item.id === vote.seatId);
    // A.2.3: solo votan los humanos. Un voto de bot o de un asiento que no
    // existe es un error de la capa de datos: se descarta, no rompe el turno.
    if (!seat || seat.kind !== 'human' || !options.includes(vote.choice)) {
      discarded += 1;
      continue;
    }
    // Un asiento, un voto: si la capa de datos deja pasar varios, manda el último.
    choiceOf.set(vote.seatId, vote.choice);
  }

  const counted = choiceOf.size;
  const tally: BallotTallyEntry[] = options.map((windowId) => ({
    windowId,
    votes: 0,
  }));
  for (const choice of choiceOf.values()) {
    const entry = tally.find((item) => item.windowId === choice);
    if (entry) entry.votes += 1;
  }

  // A.2.4: mayoría simple = más de la mitad de los votos emitidos.
  let winner: WindowId | null = null;
  if (counted > 0) {
    const needed = counted / 2;
    for (const entry of tally) {
      if (entry.votes > needed) {
        winner = entry.windowId;
        break;
      }
    }
  }

  let status: BallotStatus;
  if (counted === 0) {
    status = 'quorum_failed';
  } else if (winner === null) {
    status = 'tie';
  } else if (winner === ballot.proposal && winner !== state.windowId) {
    status = 'passed';
  } else {
    // Mayoría para la actual o para la corta: la propuesta no prospera.
    status = 'rejected';
  }

  return { status, winner, options, tally, counted, discarded };
}

/** Texto del evento público con el resultado (A.2.7: se publica al cerrar). */
export function ballotEventText(state: MatchState, outcome: BallotOutcome): string {
  const current = WINDOWS[state.windowId].label;
  if (outcome.status === 'quorum_failed') {
    return `Nadie votó la papeleta de ventana; la mesa sigue con ${current}.`;
  }
  const detail = outcome.tally
    .filter((entry) => entry.votes > 0)
    .map((entry) => `${WINDOWS[entry.windowId].id} ${entry.votes}`)
    .join(', ');
  if (outcome.status === 'tie') {
    return `La papeleta de ventana empata (${detail} de ${outcome.counted} votos); la mesa sigue con ${current}.`;
  }
  const label = WINDOWS[outcome.winner as WindowId].label;
  if (outcome.status === 'passed') {
    return `La papeleta se cierra: la mesa pasa a ${label} (${detail} — ${outcome.counted} votos).`;
  }
  return `La papeleta se cierra: la propuesta no prospera y se juega ${label} (${detail} — ${outcome.counted} votos).`;
}
