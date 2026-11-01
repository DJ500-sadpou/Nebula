import { describe, expect, it } from 'vitest';
import {
  BallotInput,
  ballotChoices,
  countBallot,
} from '../../lib/engine/ballot';
import { resolveTurn } from '../../lib/engine/resolve';
import { digestState } from '../../lib/engine/digest';
import { makeSeat, makeState } from '../helpers';

/**
 * §5-A.2: la papeleta real de la Fase 4. Proponer, votar (solo humanos),
 * mayoría simple, empate = mantener, resultado al turno siguiente.
 *
 * El conteo es puro y determinista: no debe importar el orden de llegada de
 * los votos ni haber votos basura de bots o ventanas ilegales.
 */

const humans = (n: number) =>
  Array.from({ length: n }, (_, i) => makeSeat({ id: i, name: `Humano ${i}`, kind: 'human' }));

const state = makeState([...humans(3), makeSeat({ id: 3, name: 'Bot', kind: 'bot' })], {
  windowId: '1d',
  windowsUnlocked: ['1d', '7d', '30d'],
  tableVoters: 3,
});

const votes = (...pairs: [number, string][]): BallotInput['votes'] =>
  pairs.map(([seatId, choice]) => ({ seatId, choice: choice as never }));

describe('opciones de la papeleta (A.2.2)', () => {
  it('ofrece la actual, la propuesta y una más corta, ordenadas de corta a larga', () => {
    const mes = { ...state, windowId: '30d' as never };
    const options = ballotChoices(mes, '1d');
    expect(options).toEqual(['1d', '7d', '30d']);
  });

  it('si la actual ya es la más corta, la papeleta es de dos opciones', () => {
    expect(ballotChoices(state, '7d')).toEqual(['1d', '7d']);
    expect(ballotChoices(state, '1d')).toEqual(['1d']);
  });

  it('excluye la propuesta que la escalera aún no desbloqueó', () => {
    const mes = { ...state, windowId: '7d' as never };
    expect(ballotChoices(mes, '3m' as never)).toEqual(['1d', '7d']);
  });

  it('en guerra recorta por el techo de la etapa: la tribal ya no ofrece 30d (A.11)', () => {
    const atWar = {
      ...state,
      windowId: '7d' as never,
      war: { a: 0, b: 1, sinceTurn: 1 },
      era: 'tribal' as const,
    };
    expect(ballotChoices(atWar, '30d')).toEqual(['1d', '7d']);
  });
});

describe('conteo de la papeleta (A.2.3, A.2.4)', () => {
  it('la mayoría simple de los votos emitidos gana', () => {
    const outcome = countBallot(state, {
      proposal: '7d',
      votes: votes([0, '7d'], [1, '7d'], [2, '1d']),
    });
    expect(outcome.status).toBe('passed');
    expect(outcome.winner).toBe('7d');
    expect(outcome.counted).toBe(3);
    expect(outcome.discarded).toBe(0);
  });

  it('se puede acortar la ventana, no solo alargarla (A.2.6)', () => {
    const larga = { ...state, windowId: '30d' as const };
    const outcome = countBallot(larga, {
      proposal: '7d',
      votes: votes([0, '7d'], [1, '7d'], [2, '30d']),
    });
    expect(outcome.status).toBe('passed');
    expect(outcome.winner).toBe('7d');
  });

  it('empate o sin quórum: se mantiene la actual (A.2.4)', () => {
    const tie = countBallot(state, { proposal: '7d', votes: votes([0, '7d'], [1, '1d']) });
    expect(tie.status).toBe('tie');
    expect(tie.winner).toBeNull();

    const quorum = countBallot(state, { proposal: '7d', votes: [] });
    expect(quorum.status).toBe('quorum_failed');
    expect(quorum.winner).toBeNull();
  });

  it('la mayoría para la actual rechaza la propuesta', () => {
    const outcome = countBallot(state, {
      proposal: '7d',
      votes: votes([0, '1d'], [1, '1d'], [2, '7d']),
    });
    expect(outcome.status).toBe('rejected');
    expect(outcome.winner).toBe('1d');
  });

  it('solo votan los humanos: votos de bots y dormidos se descartan (A.2.3)', () => {
    const outcome = countBallot(state, {
      proposal: '7d',
      votes: votes([0, '7d'], [3, '7d']),
    });
    expect(outcome.counted).toBe(1);
    expect(outcome.discarded).toBe(1);
    expect(outcome.winner).toBe('7d');
    expect(outcome.status).toBe('passed');
  });

  it('un voto con ventana ilegal o asiento inexistente se descarta, no rompe el turno', () => {
    const outcome = countBallot(state, {
      proposal: '7d',
      votes: votes([0, '7d'], [1, '3y'], [99, '7d']),
    });
    expect(outcome.counted).toBe(1);
    expect(outcome.discarded).toBe(2);
  });

  it('un asiento, un voto: si hay repetidos manda el último', () => {
    const outcome = countBallot(state, {
      proposal: '7d',
      votes: votes([0, '7d'], [0, '1d'], [1, '7d']),
    });
    // El asiento 0 terminó votando 1d: 1-1 es empate.
    expect(outcome.counted).toBe(2);
    expect(outcome.status).toBe('tie');
  });

  it('el conteo no depende del orden de llegada de los votos', () => {
    const a = countBallot(state, { proposal: '7d', votes: votes([0, '7d'], [1, '1d'], [2, '7d']) });
    const b = countBallot(state, { proposal: '7d', votes: votes([2, '7d'], [1, '1d'], [0, '7d']) });
    expect(a).toEqual(b);
  });
});

describe('la papeleta dentro de resolveTurn', () => {
  it('el resultado se aplica al turno que se resuelve (A.2.5) y se publica con la crónica (A.2.7)', () => {
    const next = resolveTurn(state, [], { proposal: '7d', votes: votes([0, '7d'], [1, '7d'], [2, '1d']) });
    expect(next.windowId).toBe('7d');
    const ballotEvent = next.events.find((event) => event.kind === 'ballot');
    expect(ballotEvent).toBeDefined();
    expect(ballotEvent?.visibility).toBe('public');
    expect(ballotEvent?.text).toContain('7 días');
  });

  it('empate: la ventana no cambia y el evento lo cuenta', () => {
    const next = resolveTurn(state, [], { proposal: '7d', votes: votes([0, '7d'], [1, '1d']) });
    expect(next.windowId).toBe('1d');
    expect(next.events.find((event) => event.kind === 'ballot')?.text).toContain('empata');
  });

  it('sin votos la mesa sigue igual y se publica el vacío', () => {
    const next = resolveTurn(state, [], { proposal: '7d', votes: [] });
    expect(next.windowId).toBe('1d');
    expect(next.events.find((event) => event.kind === 'ballot')?.text).toContain('Nadie votó');
  });

  it('un choque de civilizaciones impone 1d sin votación (A.11)', () => {
    const choque = {
      ...state,
      windowId: '30d' as never,
      windowOverride: { windowId: '1d' as const, untilDay: state.fictionDay + 2 },
    };
    const next = resolveTurn(choque, [], { proposal: '7d', votes: votes([0, '7d'], [1, '7d']) });
    expect(next.windowId).toBe('1d');
    expect(next.events.find((event) => event.kind === 'ballot')).toBeUndefined();
  });

  it('el ritmo fijado ignora la papeleta (A.12)', () => {
    const fixed = { ...state, windowPolicy: 'fixed' as const, fixedWindow: '30d' as const };
    const next = resolveTurn(fixed, [], { proposal: '7d', votes: votes([0, '7d'], [1, '7d']) });
    expect(next.windowId).toBe('30d');
    expect(next.events.find((event) => event.kind === 'ballot')).toBeUndefined();
  });

  it('es determinista: mismos votos, misma huella, vengan en el orden que vengan', () => {
    const a = resolveTurn(state, [], { proposal: '7d', votes: votes([0, '7d'], [1, '7d'], [2, '1d']) });
    const b = resolveTurn(state, [], { proposal: '7d', votes: votes([2, '1d'], [1, '7d'], [0, '7d']) });
    expect(digestState(a)).toBe(digestState(b));
  });

  it('sin papeleta el motor decide exactamente como en Fase 0–3 (ningún golden cambia)', () => {
    const sinPapeleta = resolveTurn(state, []);
    const conPapeletaNula = resolveTurn(state, [], null);
    expect(digestState(sinPapeleta)).toBe(digestState(conPapeletaNula));
  });
});
