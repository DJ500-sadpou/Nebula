import { describe, expect, it } from 'vitest';
import { digestState } from '../../lib/engine/digest';
import { planFor } from '../../lib/bots/policy';
import {
  MULTI_LOBBY,
  buildMatchState,
  fillSeatDefs,
  resolveMultiTurn,
  sanitizeLobbyConfig,
} from '../../lib/match/lobby';

/**
 * Fase 4, orquestación pura de la sala: estado inicial con humanos en su
 * índice, acción por defecto para quien no envía, bots con su política y la
 * papeleta decidida por votos reales.
 */

const config = { seats: 6, turnLimit: 12, turnSeconds: 120, unlockEvery: 3 };

const beat = (
  b: number,
  c: 'milagro' | 'obra' | 'heroe' | 'palabra',
  a: string,
) => ({ beat: b, channel: c, action: a });

const defs = [
  { seatIdx: 0, kind: 'human' as const, name: 'Ares' },
  { seatIdx: 1, kind: 'human' as const, name: 'Bres' },
  { seatIdx: 2, kind: 'human' as const, name: 'Cres' },
  { seatIdx: 3, kind: 'bot' as const, name: 'Bot Uno' },
  { seatIdx: 4, kind: 'bot' as const, name: 'Bot Dos' },
  { seatIdx: 5, kind: 'bot' as const, name: 'Bot Tres' },
];

describe('configuración de sala', () => {
  it('acepta los valores por defecto y los límites de §2', () => {
    expect(sanitizeLobbyConfig({})).toEqual({
      seats: MULTI_LOBBY.seats,
      turnLimit: MULTI_LOBBY.turnLimit,
      turnSeconds: MULTI_LOBBY.turnSeconds,
      unlockEvery: MULTI_LOBBY.unlockEvery,
    });
    expect(sanitizeLobbyConfig({ seats: 32, turnLimit: 200, turnSeconds: 0, unlockEvery: 1 })).toEqual({
      seats: 32,
      turnLimit: 200,
      turnSeconds: 0,
      unlockEvery: 1,
    });
  });

  it('rechaza lo que no cabe en las reglas: 3 asientos, 33, temporizador raro', () => {
    expect(sanitizeLobbyConfig({ seats: 3 })).toBeNull();
    expect(sanitizeLobbyConfig({ seats: 33 })).toBeNull();
    expect(sanitizeLobbyConfig({ turnSeconds: 90 })).toBeNull();
    expect(sanitizeLobbyConfig({ turnLimit: 1 })).toBeNull();
    expect(sanitizeLobbyConfig('pepino')).toBeNull();
  });
});

describe('estado inicial de la sala', () => {
  it('coloca a cada humano en su asiento y respeta su nick', () => {
    const state = buildMatchState(1234, defs, config);
    expect(state.seats).toHaveLength(6);
    expect(state.seats[0]).toMatchObject({ kind: 'human', name: 'Ares' });
    expect(state.seats[2]).toMatchObject({ kind: 'human', name: 'Cres' });
    expect(state.seats[4]).toMatchObject({ kind: 'bot', name: 'Bot Dos' });
  });

  it('sin votantes simulados: sin propuesta la ventana nunca cambia (A.2.8)', () => {
    const state = buildMatchState(1234, defs, config);
    expect(state.tableVoters).toBe(0);
    let walk = state;
    for (let i = 0; i < 4; i += 1) walk = resolveMultiTurn(walk, [], null, 12).state;
    expect(walk.windowId).toBe('1d');
  });
});

describe('relleno al arrancar (§2, D61)', () => {
  it('una mesa de 12 con 2 humanos: 6 bots hasta la referencia y 4 dormidos', () => {
    const defs = fillSeatDefs(12, [0, 3]);
    expect(defs.filter((d) => d.kind === 'bot')).toHaveLength(6);
    expect(defs.filter((d) => d.kind === 'dormant')).toHaveLength(4);
    expect(defs.filter((d) => d.kind === 'bot').every((d) => d.name?.startsWith('Bot '))).toBe(true);
    // El dormido conserva el nombre de dios que le dio el motor.
    expect(defs.filter((d) => d.kind === 'dormant').every((d) => d.name === undefined)).toBe(true);
  });

  it('mesas de hasta 8 se rellenan solo con bots, como desde la Fase 4', () => {
    const defs = fillSeatDefs(6, [0, 1, 2]);
    expect(defs.every((d) => d.kind === 'bot')).toBe(true);
    expect(defs).toHaveLength(3);
    expect(fillSeatDefs(8, [0])).toHaveLength(7);
  });

  it('el mundo completo: 32 asientos, 4 humanos, 4 bots y 24 dormidos', () => {
    const defs = fillSeatDefs(32, [0, 5, 17, 31]);
    expect(defs.filter((d) => d.kind === 'bot')).toHaveLength(4);
    expect(defs.filter((d) => d.kind === 'dormant')).toHaveLength(24);
  });

  it('una mesa con dormidos arranca y el dormido no bloquea el turno', () => {
    const config12 = { seats: 12, turnLimit: 12, turnSeconds: 120, unlockEvery: 3 };
    const defs = [
      { seatIdx: 0, kind: 'human' as const, name: 'Ares' },
      ...fillSeatDefs(12, [0]),
    ];
    const state = buildMatchState(99, defs, config12);
    expect(state.seats.filter((s) => s.kind === 'human')).toHaveLength(1);
    expect(state.seats.filter((s) => s.kind === 'bot')).toHaveLength(7);
    expect(state.seats.filter((s) => s.kind === 'dormant')).toHaveLength(4);
    // El humano manda su plan; los dormidos no envían nada y el turno avanza.
    const result = resolveMultiTurn(state, [{ seatId: 0, plan: [] }], null, 12);
    expect(result.state.turn).toBe(2);
    expect(result.orders.every((o) => o.seatId < 8)).toBe(true);
  });
});

describe('resolución multijugador', () => {
  const state = buildMatchState(4321, defs, config);

  it('quien no envía juega «no intervenir», no política de bot (§5)', () => {
    const sent = resolveMultiTurn(state, [{ seatId: 0, plan: [] }], null, 12);
    expect(sent.orders.find((o) => o.seatId === 1)?.plan).toEqual([]);
    expect(sent.orders.find((o) => o.seatId === 1)?.plan).not.toEqual(
      planFor(state, state.seats[1]!, 'corrupto').plan,
    );
  });

  it('los bots juegan su política y los humanos sus órdenes', () => {
    const result = resolveMultiTurn(
      state,
      [{ seatId: 0, plan: [] }, { seatId: 1, plan: [beat(0, 'milagro', 'senal')] }],
      null,
      12,
    );
    const botOrder = result.orders.find((o) => o.seatId === 3);
    expect(botOrder?.plan).toEqual(planFor(state, state.seats[3]!, 'corrupto').plan);
    expect(result.orders.find((o) => o.seatId === 1)?.plan).toEqual([
      beat(0, 'milagro', 'senal'),
    ]);
  });

  it('la papeleta real decide la ventana del turno', () => {
    const unlocked = { ...state, windowsUnlocked: ['1d' as const, '7d' as const, '30d' as const] };
    const result = resolveMultiTurn(
      unlocked,
      [],
      { proposal: '7d', votes: [{ seatId: 0, choice: '7d' }, { seatId: 1, choice: '7d' }, { seatId: 2, choice: '1d' }] },
      12,
    );
    expect(result.state.windowId).toBe('7d');
    expect(result.events.some((event) => event.kind === 'ballot')).toBe(true);
  });

  it('la crónica privada es una por asiento humano y la pública una sola', () => {
    const result = resolveMultiTurn(state, [], null, 12);
    expect(Object.keys(result.chronicle.privateBySeat).sort()).toEqual(['0', '1', '2']);
    expect(result.chronicle.publicText.length).toBeGreaterThan(0);
    for (const seatId of [0, 1, 2]) {
      expect(result.chronicle.privateBySeat[seatId]?.length ?? 0).toBeGreaterThan(0);
    }
    // La personalización del texto (plantillas con contexto del asiento) la
    // cubre tests/narrator/chronicle.test.ts; aquí importa el reparto:
    // un texto privado por humano, ninguno para bots.
    expect(result.chronicle.privateBySeat[3]).toBeUndefined();
  });

  it('cierra por tope de turnos con ganador por puntuación (§5-A.9)', () => {
    const result = resolveMultiTurn(state, [], null, 1);
    expect(result.closed).toBe(true);
    expect(result.state.finished).toBe(true);
    expect(result.state.winnerSeat).not.toBeNull();
    expect(result.events.some((event) => event.kind === 'end')).toBe(true);
  });

  it('es determinista: mismas órdenes y votos, misma huella', () => {
    const submitted = [{ seatId: 0, plan: [beat(1, 'obra', 'templo')] }];
    const a = resolveMultiTurn(state, submitted, null, 12);
    const b = resolveMultiTurn(state, submitted, null, 12);
    expect(digestState(a.state)).toBe(digestState(b.state));
    expect(a.chronicle.publicText).toBe(b.chronicle.publicText);
  });

  it('las órdenes ya enviadas se juegan aunque el asiento acabe de pasar a bot (§2)', () => {
    // Un asiento con órdenes en el reparto juega las suyas: solo los humanos
    // pueden tenerlas, así que este es el caso del que abandona a mitad de
    // turno —pasa a bot al turno SIGUIENTE, pero este turno ya lo jugó él.
    const plan = [beat(2, 'palabra', 'sermon')];
    const result = resolveMultiTurn(state, [{ seatId: 3, plan }], null, 12);
    expect(result.orders.find((o) => o.seatId === 3)?.plan).toEqual(plan);
    // Los bots sin órdenes en el reparto siguen con su política…
    expect(result.orders.find((o) => o.seatId === 4)?.plan).toEqual(
      planFor(state, state.seats[4]!, 'corrupto').plan,
    );
    // …y nadie más que un humano recibe crónica privada.
    expect(result.chronicle.privateBySeat[3]).toBeUndefined();
    expect(result.chronicle.privateBySeat[4]).toBeUndefined();
  });
});
