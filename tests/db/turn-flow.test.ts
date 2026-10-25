import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, describe, expect, it } from 'vitest';
import { planFor } from '../../lib/bots/policy';
import { digestState } from '../../lib/engine/digest';
import { MatchState } from '../../lib/engine/types';
import {
  LoadedRows,
  MatchRow,
  SeatPublicRow,
  SeatRow,
  SeatStateRow,
  stateFromRows,
} from '../../lib/db/map';
import { createSoloState, resolveSoloTurn } from '../../lib/match/solo';

/**
 * Flujo de turno completo en Postgres 17 (PGlite): la mesa se crea entera, el
 * claim es atómico, `apply_turn` proyecta el estado y repetirlo no duplica nada.
 *
 * No sustituye a P-12 (Supabase real, PostgREST y Auth): comprueba el SQL y la
 * idempotencia, que es donde se rompen las carreras.
 */

const MIGRATIONS = [
  '20261025100000_schema.sql',
  '20261025100100_rls.sql',
  '20261025100200_turn_flow.sql',
];

const migrationSql = MIGRATIONS.map((file) =>
  readFileSync(join(process.cwd(), 'supabase', 'migrations', file), 'utf8'),
).join('\n');

const A = '11111111-1111-4111-8111-111111111111';
const MATCH = '55555555-5555-4555-8555-555555555555';

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

/** El perfil lo crea el trigger de las migraciones, así que la cuenta nace después. */
const FIXTURES = `
  insert into auth.users (id, raw_user_meta_data) values ('${A}', '{"nick":"Cuenta A"}');
`;

const db = new PGlite();

afterAll(async () => {
  await db.close();
});

interface Row {
  [key: string]: unknown;
}

async function all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query<Row>(sql, params as never[]);
  return result.rows as unknown as T[];
}

async function loadState(matchId: string): Promise<MatchState> {
  const match = (await all<Row>('select * from public.matches where id = $1', [matchId]))[0];
  if (!match) throw new Error('Partida inexistente');
  const seats = await all<SeatRow>(
    'select seat_idx, kind, name, area_card, domain_card from public.seats where match_id = $1 order by seat_idx',
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

describe('flujo de turno en Postgres', () => {
  it('crea la mesa, resuelve un turno y repite sin duplicar', async () => {
    await db.exec(PRELUDE);
    await db.exec(migrationSql);
    await db.exec(FIXTURES);

    const initial = createSoloState(4242);
    const config = { mode: 'peor_carta', turnLimit: 12 };

    await db.query(
      'select public.create_solo_match($1::uuid, $2, $3::jsonb, $4::jsonb, $5::uuid)',
      [MATCH, 'ABC234', JSON.stringify(initial), JSON.stringify(config), A],
    );

    const counts = await db.query<{ seats: number; states: number; publics: number; human: number }>(
      `select
         (select count(*)::int from public.seats where match_id = $1) as seats,
         (select count(*)::int from public.seat_state where match_id = $1) as states,
         (select count(*)::int from public.seat_public where match_id = $1) as publics,
         (select count(*)::int from public.seats where match_id = $1 and user_id = $2) as human`,
      [MATCH, A],
    );
    expect(counts.rows[0]).toEqual({ seats: 4, states: 4, publics: 4, human: 1 });

    // El estado vuelve del SQL con la misma huella.
    const loaded = await loadState(MATCH);
    expect(digestState(loaded)).toBe(digestState({ ...initial, events: [] }));
    expect(loaded.seats).toHaveLength(4);
    expect(loaded.seats[0]?.kind).toBe('human');
    expect(loaded.seats[0]?.areaCard).toBe('Insectos');

    // Claim atómico: solo el primero gana.
    const claim = () =>
      db.query<{ claim_turn: boolean }>('select public.claim_turn($1::uuid, $2::int)', [MATCH, 1]);
    expect((await claim()).rows[0]?.claim_turn).toBe(true);
    expect((await claim()).rows[0]?.claim_turn).toBe(false);
    await db.query('select public.release_turn($1::uuid)', [MATCH]);
    expect((await claim()).rows[0]?.claim_turn).toBe(true);

    // Un turno completo.
    const humanPlan = planFor(loaded, loaded.seats[0]!).plan;
    const result = resolveSoloTurn(loaded, 0, humanPlan, undefined, 12);
    const payload = {
      digest: digestState(result.state),
      state: { ...result.state, events: [] },
      events: result.events,
      chronicle: {
        public: result.chronicle.publicText,
        private: { '0': result.chronicle.privateText },
      },
    };

    const applied = await db.query<{ apply_turn: string }>(
      'select public.apply_turn($1::uuid, $2::int, $3::jsonb)',
      [MATCH, 1, JSON.stringify(payload)],
    );
    expect(applied.rows[0]?.apply_turn).toBe('applied');

    const after = await db.query<{ turn: number; resolving: boolean }>(
      'select turn, resolving from public.matches where id = $1',
      [MATCH],
    );
    expect(after.rows[0]?.turn).toBe(2);
    expect(after.rows[0]?.resolving).toBe(false);

    const events = await db.query<{ n: number }>(
      'select count(*)::int as n from public.turn_events where match_id = $1 and turn = 1',
      [MATCH],
    );
    expect(events.rows[0]?.n).toBe(result.events.length);

    const chronicle = await db.query<{ n: number }>(
      'select count(*)::int as n from public.chronicle where match_id = $1 and turn = 1',
      [MATCH],
    );
    expect(chronicle.rows[0]?.n).toBe(1);

    const reloaded = await loadState(MATCH);
    expect(reloaded.turn).toBe(2);
    expect(digestState(reloaded)).toBe(digestState({ ...result.state, events: [] }));

    // Repetir la aplicación no duplica eventos ni avanza el turno.
    const replay = await db.query<{ apply_turn: string }>(
      'select public.apply_turn($1::uuid, $2::int, $3::jsonb)',
      [MATCH, 1, JSON.stringify(payload)],
    );
    expect(replay.rows[0]?.apply_turn).toBe('replayed');

    const replayed = await db.query<{ turn: number; events: number; resolutions: number }>(
      `select
         (select turn from public.matches where id = $1) as turn,
         (select count(*)::int from public.turn_events where match_id = $1 and turn = 1) as events,
         (select count(*)::int from public.turn_resolutions where match_id = $1) as resolutions`,
      [MATCH],
    );
    expect(replayed.rows[0]).toEqual({ turn: 2, events: result.events.length, resolutions: 1 });

    // El Fe es entero y la fidelidad admite el rango de §4 [0–1,5].
    await db.query('update public.seat_state set fidelity = 1.4 where match_id = $1 and seat_idx = 0', [
      MATCH,
    ]);
    const high = await db.query<{ fidelity: string }>(
      'select fidelity from public.seat_state where match_id = $1 and seat_idx = 0',
      [MATCH],
    );
    expect(Number(high.rows[0]?.fidelity)).toBeCloseTo(1.4, 4);
  }, 30_000);

  it('el cliente autenticado no puede ejecutar las funciones de servidor', async () => {
    const payload = JSON.stringify({ digest: 'x', state: {}, events: [], chronicle: {} });

    await db.exec(`set role authenticated`);
    const denied = await db
      .query('select public.apply_turn($1::uuid, $2::int, $3::jsonb)', [MATCH, 2, payload])
      .then(() => undefined)
      .catch((error: { code?: string }) => error.code);
    const claimDenied = await db
      .query('select public.claim_turn($1::uuid, $2::int)', [MATCH, 2])
      .then(() => undefined)
      .catch((error: { code?: string }) => error.code);
    await db.exec('reset role');

    expect(denied).toBe('42501');
    expect(claimDenied).toBe('42501');
  }, 30_000);
});
