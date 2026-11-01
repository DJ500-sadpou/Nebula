import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { planFor } from '../../lib/bots/policy';
import { countBallot } from '../../lib/engine/ballot';
import { digestState } from '../../lib/engine/digest';
import { MatchState, WindowId } from '../../lib/engine/types';
import { buildMatchState, fillSeatDefs, resolveMultiTurn } from '../../lib/match/lobby';
import {
  LoadedRows,
  MatchRow,
  SeatPublicRow,
  SeatRow,
  SeatStateRow,
  stateFromRows,
} from '../../lib/db/map';

/**
 * Fase 4 · Flujo multijugador completo en Postgres 17 (PGlite): lobby, listo,
 * arranque con relleno de bots, órdenes inmutables por asiento, papeleta con
 * una propuesta por turno y cierre idempotente del turno.
 *
 * No sustituye a P-13 (cuatro pestañas reales contra Supabase): comprueba el
 * SQL y las políticas de la fase, que es donde se rompen las carreras.
 */

const MIGRATIONS = [
  '20261025100000_schema.sql',
  '20261025100100_rls.sql',
  '20261025100200_turn_flow.sql',
  '20261026100300_multiplayer.sql',
  '20261026100400_malignant.sql',
  '20261026100500_limits_retention.sql',
  '20261026100600_audit_races.sql',
];

const migrationSql = MIGRATIONS.map((file) =>
  readFileSync(join(process.cwd(), 'supabase', 'migrations', file), 'utf8'),
).join('\n');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';
const E = '55555555-5555-4555-8555-555555555555';
const F = '66666666-6666-4666-8666-666666666666';
const G = '77777777-7777-4777-8777-777777777777';

const MATCH = '88888888-8888-4888-8888-888888888888';
const MATCH2 = '99999999-9999-4999-8999-999999999999';

const PRELUDE = `
  create schema auth;
  create table auth.users (
    id uuid primary key,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create function auth.uid() returns uuid
    language sql stable
    as $fn$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    $fn$;

  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

/** El perfil lo crea el trigger de las migraciones a partir del nick. */
function userRow(id: string, nick: string): string {
  return `insert into auth.users (id, raw_user_meta_data) values ('${id}', '{"nick":"${nick}"}');`;
}

const FIXTURES = [
  userRow(A, 'Anfitriona'),
  userRow(B, 'Bruma'),
  userRow(C, 'Cauce'),
  userRow(D, 'Duna'),
  userRow(E, 'Estío'),
  userRow(F, 'Farol'),
  userRow(G, 'Greda'),
].join('\n');

const db = new PGlite();

interface Row {
  [key: string]: unknown;
}

async function all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query<Row>(sql, params as never[]);
  return result.rows as unknown as T[];
}

/** Consulta como `authenticated` con el JWT de un jugador: la RLS de verdad. */
async function asUser<T>(userId: string, sql: string, params: unknown[] = []): Promise<T[]> {
  const rows = await db.transaction(async (tx) => {
    await tx.query('select set_config($1, $2, true)', [
      'request.jwt.claims',
      `{"sub":"${userId}"}`,
    ]);
    await tx.query('set local role authenticated');
    const result = await tx.query<Row>(sql, params as never[]);
    return result.rows;
  });
  return rows as unknown as T[];
}

async function loadState(matchId: string): Promise<MatchState> {
  const match = (await all<Row>('select * from public.matches where id = $1', [matchId]))[0];
  if (!match) throw new Error('Partida inexistente');
  const seats = await all<SeatRow>(
    'select seat_idx, kind, name, area_card, domain_card, awakened from public.seats where match_id = $1 order by seat_idx',
    [matchId],
  );
  const states = await all<SeatStateRow>(
    'select * from public.seat_state where match_id = $1 order by seat_idx',
    [matchId],
  );
  const publics = await all<SeatPublicRow>(
    'select * from public.seat_public where match_id = $1 order by seat_idx',
    [matchId],
  );
  const milestones = await all<{ key: string; claimed_by_seat: number }>(
    'select key, claimed_by_seat from public.milestones where match_id = $1',
    [matchId],
  );

  const rows: LoadedRows = {
    match: match as unknown as MatchRow,
    seats,
    states,
    publics,
    milestones: Object.fromEntries(milestones.map((item) => [item.key, item.claimed_by_seat])),
  };
  return stateFromRows(rows);
}

async function rpc<T>(sql: string, params: unknown[]): Promise<T | null> {
  const rows = await all<Row>(sql, params);
  const first = Object.values(rows[0] ?? {})[0];
  return (first as T) ?? null;
}

interface ResolvedTurn {
  status: string;
  turn: number;
  /** Payload completo de `apply_turn`, para probar el replay del mismo turno. */
  payload: Record<string, unknown>;
  payloadTurn: number;
}

/** Resuelve el turno en curso con el motor y lo aplica (como haría la API). */
async function resolveAndApply(
  matchId: string,
  ballot: { proposal: WindowId; votes: { seatId: number; choice: WindowId }[] } | null,
  turnLimit: number,
): Promise<ResolvedTurn> {
  const state = await loadState(matchId);
  const turn = state.turn;
  const submitted = await all<{ seat_idx: number; payload: Record<string, unknown> }>(
    'select seat_idx, payload from public.orders where match_id = $1 and turn = $2',
    [matchId, turn],
  );

  const claimed = await rpc<boolean>('select public.claim_turn($1::uuid, $2::int)', [matchId, turn]);
  if (claimed !== true) return { status: 'busy', turn, payload: {}, payloadTurn: turn };

  const result = resolveMultiTurn(
    state,
    submitted.map((row) => ({
      seatId: row.seat_idx,
      plan: (row.payload.plan ?? []) as never,
      problemOption:
        typeof row.payload.problemOption === 'string' ? row.payload.problemOption : undefined,
    })),
    ballot,
    turnLimit,
  );

  const { events: _events, ...stateWithoutEvents } = result.state;
  const payload = {
    digest: digestState(result.state),
    state: { ...stateWithoutEvents, events: [] },
    events: result.events,
    chronicle: {
      public: result.chronicle.publicText,
      private: result.chronicle.privateBySeat,
    },
  };

  if (ballot) {
    // Como hará la ruta de API: primero `apply_turn` (idempotente) y después
    // `close_ballot`, para que un fallo de la escritura no deje la propuesta
    // cerrada con los votos sin aplicar (hallazgo de auditoría).
    const outcome = countBallot(state, ballot);
    const appliedFirst = await rpc<string>(
      'select public.apply_turn($1::uuid, $2::int, $3::jsonb)',
      [matchId, turn, JSON.stringify(payload)],
    );
    await rpc('select public.close_ballot($1::uuid, $2::int, $3, $4)', [
      matchId,
      turn,
      outcome.status,
      outcome.winner,
    ]);
    return {
      status: appliedFirst === 'replayed' ? 'replayed' : 'applied',
      turn: result.state.turn,
      payload,
      payloadTurn: turn,
    };
  }

  const applied = await rpc<string>('select public.apply_turn($1::uuid, $2::int, $3::jsonb)', [
    matchId,
    turn,
    JSON.stringify(payload),
  ]);

  return {
    status: applied === 'replayed' ? 'replayed' : 'applied',
    turn: result.state.turn,
    payload,
    payloadTurn: turn,
  };
}

beforeAll(async () => {
  await db.exec(PRELUDE);
  await db.exec(migrationSql);
  await db.exec(FIXTURES);
});

afterAll(async () => {
  await db.close();
});

describe('lobby: crear, unirse, expulsar, listo', () => {
  it('el anfitrión crea la sala y queda en el asiento 0', async () => {
    const config = {
      mode: 'multi',
      seats: 6,
      turnLimit: 12,
      turnSeconds: 120,
      unlockEvery: 1,
    };
    await rpc('select public.create_lobby($1::uuid, $2, $3::bigint, $4::jsonb, $5::uuid)', [
      MATCH,
      'LOBBY1',
      777,
      JSON.stringify(config),
      A,
    ]);

    const match = (
      await all<Row>('select phase, status, host_seat, turn from public.matches where id = $1', [MATCH])
    )[0];
    expect(match).toMatchObject({ phase: 'lobby', status: 'lobby', host_seat: 0, turn: 1 });

    const seats = await all<Row>(
      'select seat_idx, kind, name, ready from public.seats where match_id = $1 order by seat_idx',
      [MATCH],
    );
    expect(seats).toHaveLength(1);
    expect(seats[0]).toMatchObject({ seat_idx: 0, kind: 'human', name: 'Anfitriona', ready: false });
  });

  it('cada jugador ocupa el primer asiento libre; nadie ocupa dos', async () => {
    expect(await rpc<number>('select public.join_lobby($1::uuid, $2::uuid)', [MATCH, B])).toBe(1);
    expect(await rpc<number>('select public.join_lobby($1::uuid, $2::uuid)', [MATCH, C])).toBe(2);
    expect(await rpc<number>('select public.join_lobby($1::uuid, $2::uuid)', [MATCH, D])).toBe(3);
    expect(await rpc<number>('select public.join_lobby($1::uuid, $2::uuid)', [MATCH, E])).toBe(4);
    // Ya sentado: -2 (la violación del índice único salta porque queda asiento libre).
    expect(await rpc<number>('select public.join_lobby($1::uuid, $2::uuid)', [MATCH, A])).toBe(-2);
    expect(await rpc<number>('select public.join_lobby($1::uuid, $2::uuid)', [MATCH, F])).toBe(5);
    // Sala llena: -1.
    expect(await rpc<number>('select public.join_lobby($1::uuid, $2::uuid)', [MATCH, G])).toBe(-1);
  });

  it('la RLS solo deja ver la sala a quien tiene asiento', async () => {
    const outside = await asUser<Row>(G, 'select id from public.matches where id = $1', [MATCH]);
    expect(outside).toHaveLength(0);
    const inside = await asUser<Row>(C, 'select id from public.matches where id = $1', [MATCH]);
    expect(inside).toHaveLength(1);
  });

  it('el anfitrión expulsa del lobby y el asiento vuelve a quedar libre', async () => {
    expect(await rpc<string>('select public.kick_seat($1::uuid, $2::uuid, $3::int)', [MATCH, A, 5])).toBe('ok');
    expect(await rpc<string>('select public.kick_seat($1::uuid, $2::uuid, $3::int)', [MATCH, C, 4])).toBe('not_host');
    expect(await rpc<number>('select public.join_lobby($1::uuid, $2::uuid)', [MATCH, F])).toBe(5);
  });

  it('marcar listo es del propio asiento; fuera del lobby no aplica', async () => {
    expect(await rpc<string>('select public.set_ready($1::uuid, $2::uuid, true)', [MATCH, A])).toBe('ok');
    expect(await rpc<string>('select public.set_ready($1::uuid, $2::uuid, true)', [MATCH, G])).toBe('not_seated');
    for (const user of [B, C, D, E, F]) {
      expect(await rpc<string>('select public.set_ready($1::uuid, $2::uuid, true)', [MATCH, user])).toBe('ok');
    }
    const ready = await all<Row>(
      'select count(*)::int as n from public.seats where match_id = $1 and ready',
      [MATCH],
    );
    expect(ready[0]).toEqual({ n: 6 });
  });
});

describe('arrancar: relleno con bots y temporizador', () => {
  it('una sala parcial se rellena con bots al arrancar', async () => {
    const config = {
      mode: 'multi',
      seats: 6,
      turnLimit: 12,
      turnSeconds: 240,
      unlockEvery: 1,
    };
    await rpc('select public.create_lobby($1::uuid, $2, $3::bigint, $4::jsonb, $5::uuid)', [
      MATCH2,
      'LOBBY2',
      1000,
      JSON.stringify(config),
      A,
    ]);
    await rpc<number>('select public.join_lobby($1::uuid, $2::uuid)', [MATCH2, B]);
    await rpc<number>('select public.join_lobby($1::uuid, $2::uuid)', [MATCH2, C]);

    const humans = await all<{ seat_idx: number; name: string }>(
      'select seat_idx, name from public.seats where match_id = $1 order by seat_idx',
      [MATCH2],
    );
    const defs = [
      ...humans.map((seat) => ({ seatIdx: seat.seat_idx, kind: 'human' as const, name: seat.name })),
      ...Array.from({ length: 6 - humans.length }, (_, i) => ({
        seatIdx: humans.length + i,
        kind: 'bot' as const,
        name: `Bot ${humans.length + i}`,
      })),
    ];
    const state = buildMatchState(1000, defs, {
      seats: 6,
      turnLimit: 12,
      turnSeconds: 240,
      unlockEvery: 1,
    });
    await rpc('select public.begin_orders($1::uuid, $2::jsonb, $3::int)', [
      MATCH2,
      JSON.stringify({ ...state, events: [] }),
      240,
    ]);

    const after = await all<Row>(
      'select seat_idx, kind, user_id is not null as seated from public.seats where match_id = $1 order by seat_idx',
      [MATCH2],
    );
    expect(after).toHaveLength(6);
    expect(after.filter((seat) => seat.kind === 'human')).toHaveLength(3);
    expect(after.filter((seat) => seat.kind === 'bot')).toHaveLength(3);

    const counts = await all<Row>(
      `select
         (select count(*)::int from public.seat_state where match_id = $1) as states,
         (select count(*)::int from public.seat_public where match_id = $1) as publics`,
      [MATCH2],
    );
    expect(counts[0]).toEqual({ states: 6, publics: 6 });

    const match = (await all<Row>('select phase, turn_ends_at from public.matches where id = $1', [MATCH2]))[0];
    expect(match?.phase).toBe('orders');
    expect(String(match?.turn_ends_at)).toBeTruthy();
  });

  it('arrancar dos veces se niega: la fase ya no es lobby', async () => {
    const state = buildMatchState(
      1000,
      [{ seatIdx: 0, kind: 'human', name: 'Anfitriona' }],
      { seats: 6, turnLimit: 12, turnSeconds: 240, unlockEvery: 1 },
    );
    await expect(
      rpc('select public.begin_orders($1::uuid, $2::jsonb, $3::int)', [
        MATCH2,
        JSON.stringify({ ...state, events: [] }),
        240,
      ]),
    ).rejects.toThrow();
  });
});

describe('órdenes por asiento: inmutables y privadas', () => {
  it('se envían una vez; repetir no reescribe', async () => {
    expect(
      await rpc<string>('select public.submit_orders($1::uuid, $2::int, $3::int, $4::jsonb)', [
        MATCH2,
        1,
        0,
        JSON.stringify({ plan: [] }),
      ]),
    ).toBe('stored');
    expect(
      await rpc<string>('select public.submit_orders($1::uuid, $2::int, $3::int, $4::jsonb)', [
        MATCH2,
        1,
        0,
        JSON.stringify({ plan: [{ beat: 0, channel: 'milagro', action: 'senal' }] }),
      ]),
    ).toBe('exists');
    const rows = await all<{ payload: Record<string, unknown> }>(
      'select payload from public.orders where match_id = $1 and seat_idx = 0 and turn = 1',
      [MATCH2],
    );
    expect(rows[0]?.payload.plan).toEqual([]);
  });

  it('RLS: cada jugador solo lee sus órdenes', async () => {
    await rpc<string>('select public.submit_orders($1::uuid, $2::int, $3::int, $4::jsonb)', [
      MATCH2,
      1,
      1,
      JSON.stringify({ plan: [] }),
    ]);
    const asA = await asUser<Row>(
      A,
      'select count(*)::int as n from public.orders where match_id = $1',
      [MATCH2],
    );
    expect(asA[0]).toEqual({ n: 1 });
    const asC = await asUser<Row>(
      C,
      'select count(*)::int as n from public.orders where match_id = $1',
      [MATCH2],
    );
    expect(asC[0]).toEqual({ n: 0 });
  });
});

describe('papeleta: una por turno, secreta hasta el cierre', () => {
  it('la segunda propuesta devuelve la abierta; el voto se puede cambiar', async () => {
    const first = await rpc<string>('select public.open_ballot($1::uuid, $2::int, $3::int, $4)', [
      MATCH2,
      1,
      0,
      '1d',
    ]);
    expect(first).toBeTruthy();
    const second = await rpc<string>('select public.open_ballot($1::uuid, $2::int, $3::int, $4)', [
      MATCH2,
      1,
      2,
      '1d',
    ]);
    expect(second).toBe(first);

    expect(await rpc<string>('select public.cast_vote($1::uuid, $2::uuid, $3::int, $4)', [MATCH2, first, 0, '1d'])).toBe('ok');
    expect(await rpc<string>('select public.cast_vote($1::uuid, $2::uuid, $3::int, $4)', [MATCH2, first, 1, '1d'])).toBe('ok');

    const visibleToB = await db.transaction(async (tx) => {
      await tx.query('select set_config($1, $2, true)', ['request.jwt.claims', `{"sub":"${B}"}`]);
      await tx.query('set local role authenticated');
      const rows = await tx.query<Row>(
        'select count(*)::int as n from public.turn_votes where match_id = $1',
        [MATCH2],
      );
      return rows.rows;
    });
    // La papeleta está abierta: B solo ve su propio voto (§5-A.2.7).
    expect(visibleToB[0]).toEqual({ n: 1 });
  });

  it('un voto para una propuesta inexistente no entra', async () => {
    const other = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect(
      await rpc<string>('select public.cast_vote($1::uuid, $2::uuid, $3::int, $4)', [MATCH2, other, 0, '1d']),
    ).toBe('not_open');
  });
});

describe('resolución multijugador de punta a punta', () => {
  it('turno 1 sin papeleta; turno 2 con papeleta aprobada; repetir no duplica', async () => {
    const first = await resolveAndApply(MATCH2, null, 12);
    expect(first.status).toBe('applied');
    expect(first.turn).toBe(2);

    const afterFirst = (
      await all<Row>('select turn, window_id, table_voters from public.matches where id = $1', [MATCH2])
    )[0];
    expect(afterFirst).toMatchObject({ turn: 2, window_id: '1d', table_voters: 0 });

    // El turno 2 abre con temporizador renovado (240 s).
    const deadline = await all<Row>(
      "select turn_ends_at > now() + interval '200 seconds' as fresh from public.matches where id = $1",
      [MATCH2],
    );
    expect(deadline[0]?.fresh).toBe(true);

    // Turno 2: papeleta real. Con `unlockEvery: 1`, «7 días» ya está desbloqueada.
    const proposal = await rpc<string>('select public.open_ballot($1::uuid, $2::int, $3::int, $4)', [
      MATCH2,
      2,
      0,
      '7d',
    ]);
    expect(proposal).toBeTruthy();
    expect(await rpc<string>('select public.cast_vote($1::uuid, $2::uuid, $3::int, $4)', [MATCH2, proposal, 0, '7d'])).toBe('ok');
    expect(await rpc<string>('select public.cast_vote($1::uuid, $2::uuid, $3::int, $4)', [MATCH2, proposal, 1, '7d'])).toBe('ok');
    expect(await rpc<string>('select public.cast_vote($1::uuid, $2::uuid, $3::int, $4)', [MATCH2, proposal, 2, '1d'])).toBe('ok');

    const votes = await all<{ seat_idx: number; choice: string }>(
      'select seat_idx, choice from public.turn_votes tv join public.turn_proposals tp on tp.id = tv.proposal_id where tv.match_id = $1 and tp.turn = 2 order by seat_idx',
      [MATCH2],
    );
    expect(votes).toEqual([
      { seat_idx: 0, choice: '7d' },
      { seat_idx: 1, choice: '7d' },
      { seat_idx: 2, choice: '1d' },
    ]);

    const second = await resolveAndApply(
      MATCH2,
      {
        proposal: '7d' as WindowId,
        votes: votes.map((row) => ({ seatId: row.seat_idx, choice: row.choice as WindowId })),
      },
      12,
    );
    expect(second.status).toBe('applied');
    expect(second.turn).toBe(3);

    const afterSecond = (await all<Row>('select window_id from public.matches where id = $1', [MATCH2]))[0];
    expect(afterSecond?.window_id).toBe('7d');

    // La propuesta quedó cerrada con su resultado.
    const closed = await all<Row>(
      'select status, result_window from public.turn_proposals where match_id = $1 and turn = 2',
      [MATCH2],
    );
    expect(closed[0]).toMatchObject({ status: 'passed', result_window: '7d' });

    // La crónica publica el resultado y cada humano tiene su parte privada.
    const chronicle = await all<Row>(
      'select private from public.chronicle where match_id = $1 and turn = 2',
      [MATCH2],
    );
    const priv = chronicle[0]?.private as Record<string, string>;
    expect(Object.keys(priv).sort()).toEqual(['0', '1', '2']);
    const events = await all<Row>(
      'select kind from public.turn_events where match_id = $1 and turn = 2',
      [MATCH2],
    );
    expect(events.some((event) => event.kind === 'ballot')).toBe(true);

    // Idempotencia: aplicar otra vez el MISMO payload es un replay y no duplica.
    const eventsBefore = await all<{ n: number }>(
      'select count(*)::int as n from public.turn_events where match_id = $1 and turn = 2',
      [MATCH2],
    );
    const replay = await rpc<string>('select public.apply_turn($1::uuid, $2::int, $3::jsonb)', [
      MATCH2,
      second.payloadTurn,
      JSON.stringify(second.payload),
    ]);
    expect(replay).toBe('replayed');
    const eventsAfter = await all<{ n: number }>(
      'select count(*)::int as n from public.turn_events where match_id = $1 and turn = 2',
      [MATCH2],
    );
    expect(eventsAfter[0]?.n).toBe(eventsBefore[0]?.n);
    // Y el turno no se ha movido dos veces.
    const turnNow = (await all<Row>('select turn from public.matches where id = $1', [MATCH2]))[0];
    expect(turnNow?.turn).toBe(3);
  });

  it('quien abandona en partida deja su asiento a un bot y sale de la RLS', async () => {
    expect(await rpc<string>('select public.leave_seat($1::uuid, $2::uuid)', [MATCH2, C])).toBe('bot_took_over');
    const seat = (
      await all<Row>('select kind, user_id from public.seats where match_id = $1 and seat_idx = 2', [MATCH2])
    )[0];
    expect(seat).toMatchObject({ kind: 'bot', user_id: null });

    const asC = await asUser<Row>(
      C,
      'select id from public.matches where id = $1',
      [MATCH2],
    );
    expect(asC).toHaveLength(0);
  });

  it('un asiento que ya es bot no puede enviar órdenes nuevas; juega su política', async () => {
    // El guard de `submit_orders`: solo un asiento humano envía. El de C,
    // convertido en bot al abandonar, ya no puede inyectar nada.
    expect(
      await rpc<string>('select public.submit_orders($1::uuid, $2::int, $3::int, $4::jsonb)', [
        MATCH2,
        3,
        2,
        JSON.stringify({ plan: [{ beat: 0, channel: 'milagro', action: 'senal' }] }),
      ]),
    ).toBe('not_seated');

    const state = await loadState(MATCH2);
    expect(state.seats[2]?.kind).toBe('bot');
    const result = resolveMultiTurn(state, [], null, 12);
    expect(result.orders.find((o) => o.seatId === 2)?.plan).toEqual(
      planFor(state, state.seats[2]!, 'corrupto').plan,
    );
  });
});

describe('dormidos y despertar (§2 D61, §17.2, Fase 6)', () => {
  const MATCH3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  it('el relleno de una mesa grande proyecta bots hasta 8 y dormidos más allá', async () => {
    const config = { mode: 'multi', seats: 12, turnLimit: 24, turnSeconds: 120, unlockEvery: 5 };
    await rpc('select public.create_lobby($1::uuid, $2, $3::bigint, $4::jsonb, $5::uuid)', [
      MATCH3,
      'DORM12',
      777,
      JSON.stringify(config),
      A,
    ]);
    await rpc<number>('select public.join_lobby($1::uuid, $2::uuid)', [MATCH3, B]);
    await rpc<string>('select public.set_ready($1::uuid, $2::uuid, true)', [MATCH3, A]);
    await rpc<string>('select public.set_ready($1::uuid, $2::uuid, true)', [MATCH3, B]);

    const humans = await all<{ seat_idx: number; name: string }>(
      'select seat_idx, name from public.seats where match_id = $1 order by seat_idx',
      [MATCH3],
    );
    // §2 (D61): 2 humanos + 6 bots hasta la mesa de referencia; 8–11 duermen.
    const defs = [
      ...humans.map((seat) => ({ seatIdx: seat.seat_idx, kind: 'human' as const, name: seat.name })),
      ...fillSeatDefs(12, humans.map((seat) => seat.seat_idx)),
    ];
    const state = buildMatchState(777, defs, {
      seats: 12,
      turnLimit: 24,
      turnSeconds: 120,
      unlockEvery: 5,
    });
    await rpc('select public.begin_orders($1::uuid, $2::jsonb, $3::int)', [
      MATCH3,
      JSON.stringify({ ...state, events: [] }),
      120,
    ]);

    const seats = await all<Row>(
      'select seat_idx, kind, awakened from public.seats where match_id = $1 order by seat_idx',
      [MATCH3],
    );
    expect(seats.filter((seat) => seat.kind === 'human')).toHaveLength(2);
    expect(seats.filter((seat) => seat.kind === 'bot')).toHaveLength(6);
    expect(seats.filter((seat) => seat.kind === 'dormant')).toHaveLength(4);
    expect(seats.every((seat) => seat.awakened === false)).toBe(true);
  });

  it('el despertar de un dormido persiste en la proyección y en la recarga', async () => {
    const state = await loadState(MATCH3);
    expect(state.turn).toBe(1);
    const turn = state.turn;

    // El motor despierta a un dormido (aquí se fuerza el asiento 8; la mecánica
    // del 10 % la cubren tests/engine/dormants.test.ts).
    const awakened = structuredClone(state);
    awakened.seats[8]!.awakened = true;
    const { events: _events, ...stateWithoutEvents } = awakened;
    await rpc('select public.apply_turn($1::uuid, $2::int, $3::jsonb)', [
      MATCH3,
      turn,
      JSON.stringify({
        digest: digestState(awakened),
        state: { ...stateWithoutEvents, events: [] },
        events: [],
        chronicle: { public: 'El eco de un dios recorre el mundo.', private: {} },
      }),
    ]);

    const seats = await all<Row>(
      'select seat_idx, kind, awakened from public.seats where match_id = $1 order by seat_idx',
      [MATCH3],
    );
    const malignant = seats.find((seat) => seat.seat_idx === 8);
    expect(malignant).toMatchObject({ kind: 'dormant', awakened: true });
    expect(seats.find((seat) => seat.seat_idx === 9)).toMatchObject({ awakened: false });

    // Y al recargar, el estado del motor sigue viéndolo despierto.
    const reloaded = await loadState(MATCH3);
    expect(reloaded.seats[8]?.awakened).toBe(true);
    expect(reloaded.seats[9]?.awakened).toBe(false);
  });
});

describe('auditoría: unicidad de la papeleta y carreras del lobby', () => {
  const MATCH4 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const MATCH5 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  async function startMatch(matchId: string, code: string, seed: number, seats: number, joiner: string) {
    const config = { mode: 'multi', seats, turnLimit: 12, turnSeconds: 120, unlockEvery: 5 };
    await rpc('select public.create_lobby($1::uuid, $2, $3::bigint, $4::jsonb, $5::uuid)', [
      matchId,
      code,
      seed,
      JSON.stringify(config),
      G,
    ]);
    await rpc<number>('select public.join_lobby($1::uuid, $2::uuid)', [matchId, joiner]);
    await rpc<string>('select public.set_ready($1::uuid, $2::uuid, true)', [matchId, G]);
    await rpc<string>('select public.set_ready($1::uuid, $2::uuid, true)', [matchId, joiner]);

    const humans = await all<{ seat_idx: number; name: string }>(
      'select seat_idx, name from public.seats where match_id = $1 order by seat_idx',
      [matchId],
    );
    const defs = [
      ...humans.map((seat) => ({ seatIdx: seat.seat_idx, kind: 'human' as const, name: seat.name })),
      ...fillSeatDefs(seats, humans.map((seat) => seat.seat_idx)),
    ];
    const state = buildMatchState(seed, defs, {
      seats,
      turnLimit: 12,
      turnSeconds: 120,
      unlockEvery: 5,
    });
    return state;
  }

  it('open_ballot nunca deja dos papeletas abiertas por turno (A.2.2)', async () => {
    const state = await startMatch(MATCH4, 'AUDIT1', 999, 4, D);
    await rpc('select public.begin_orders($1::uuid, $2::jsonb, $3::int)', [
      MATCH4,
      JSON.stringify({ ...state, events: [] }),
      120,
    ]);

    const first = await rpc<string>('select public.open_ballot($1::uuid, 1, 0, $2)', [MATCH4, '7d']);
    expect(first).toBeTruthy();
    // La segunda propuesta del mismo turno devuelve la abierta: sin ella, dos
    // filas «open» romperían el maybeSingle() de la vista de estado.
    const second = await rpc<string>('select public.open_ballot($1::uuid, 1, 1, $2)', [MATCH4, '30d']);
    expect(second).toBe(first);

    const open = await all<{ n: number }>(
      "select count(*)::int as n from public.turn_proposals where match_id = $1 and turn = 1 and status = 'open'",
      [MATCH4],
    );
    expect(open[0]?.n).toBe(1);

    expect(await rpc<string>('select public.cast_vote($1::uuid, $2::uuid, 0, $3)', [MATCH4, first, '7d'])).toBe('ok');
    expect(await rpc<string>('select public.close_ballot($1::uuid, 1, $2, $3)', [MATCH4, 'passed', '7d'])).toBe('ok');
    // Cerrar dos veces es idempotente: la segunda no encuentra nada abierto.
    expect(await rpc<string>('select public.close_ballot($1::uuid, 1, $2, $3)', [MATCH4, 'passed', '7d'])).toBe('none');
  });

  it('quien se sienta tras la lectura del anfitrión queda desenganchado al arrancar (§2)', async () => {
    // El estado se construye como haría la API: leyendo la sala ANTES de que
    // F se siente. La ventana de carrera es exactamente esa.
    const state = await startMatch(MATCH5, 'AUDIT2', 555, 4, E);
    expect(state.seats.filter((seat) => seat.kind === 'human')).toHaveLength(2);

    // F entra en la ventana de carrera: la sala sigue en lobby y hay asiento.
    expect(await rpc<number>('select public.join_lobby($1::uuid, $2::uuid)', [MATCH5, F])).toBe(2);

    await rpc('select public.begin_orders($1::uuid, $2::jsonb, $3::int)', [
      MATCH5,
      JSON.stringify({ ...state, events: [] }),
      120,
    ]);

    // El asiento de F lo cubre un bot (el estado del anfitrión no lo conocía)
    // y su user_id no queda colgado: puede jugar en otras mesas.
    const seatF = (
      await all<Row>('select kind, user_id from public.seats where match_id = $1 and seat_idx = 2', [MATCH5])
    )[0];
    expect(seatF).toMatchObject({ kind: 'bot', user_id: null });

    // La RLS ya no le deja ver la partida: no tiene asiento.
    const asF = await asUser<Row>(F, 'select id from public.matches where id = $1', [MATCH5]);
    expect(asF).toHaveLength(0);
  });
});
