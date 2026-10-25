import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, expect, it } from 'vitest';

/**
 * Verificación real de las migraciones en Postgres 17 (PGlite, WASM).
 *
 * La auditoría de `rls.test.ts` comprueba que las políticas *están escritas*;
 * esto comprueba que *funcionan*: aplica el SQL, crea dos cuentas y consulta
 * con los roles `anon`, `authenticated` y `service_role`, como haría Supabase.
 *
 * No sustituye a `npm run test:rls` (P-03): aquel usa Supabase Auth, PostgREST
 * y las claves reales. Este corre en cada `npm test`, sin red ni credenciales.
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
const B = '22222222-2222-4222-8222-222222222222';
const MATCH = '33333333-3333-4333-8333-333333333333';
const PROPOSAL = '44444444-4444-4444-8444-444444444444';

/** Reproduce lo mínimo del entorno de Supabase: auth.users, auth.uid() y roles. */
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

const FIXTURES = `
  insert into auth.users (id, raw_user_meta_data) values
    ('${A}', '{"nick":"Cuenta A"}'),
    ('${B}', '{"nick":"Cuenta B"}');

  insert into public.matches (id, code, status, phase, seed, turn, window_id)
  values ('${MATCH}', 'ABC234', 'orders', 'orders', 42, 1, '1d');

  insert into public.seats (match_id, seat_idx, kind, user_id, name, area_card)
  values
    ('${MATCH}', 0, 'human', '${A}', 'Cuenta A', 'Minerales'),
    ('${MATCH}', 1, 'human', '${B}', 'Cuenta B', 'Mar');

  insert into public.seat_state (match_id, seat_idx, fe, believers)
  values ('${MATCH}', 0, 111, 10), ('${MATCH}', 1, 222, 20);

  insert into public.orders (match_id, seat_idx, turn, payload)
  values ('${MATCH}', 1, 1, '{"window":"1d","schedule":[]}'::jsonb);

  insert into public.turn_events (match_id, turn, visibility, kind, text)
  values ('${MATCH}', 1, 'public', 'prueba', 'Evento público');

  insert into public.turn_events (match_id, turn, visibility, seat_idx, kind, text)
  values ('${MATCH}', 1, 'seat', 1, 'prueba', 'Evento privado de B');

  insert into public.chronicle (match_id, turn, public_text, private)
  values ('${MATCH}', 1, 'Crónica pública.', '{"1":"B investigó en secreto"}'::jsonb);

  insert into public.whispers (match_id, turn, from_seat, to_seat, body)
  values ('${MATCH}', 1, 1, 0, 'Un secreto de B para A');

  insert into public.turn_proposals (id, match_id, turn, proposer_seat, window_id, status)
  values ('${PROPOSAL}', '${MATCH}', 1, 0, '7d', 'open');

  insert into public.turn_votes (match_id, proposal_id, seat_idx, choice)
  values ('${MATCH}', '${PROPOSAL}', 0, 'proposal'), ('${MATCH}', '${PROPOSAL}', 1, 'current');
`;

const db = new PGlite();

async function asRole(role: string, sub: string | null = null): Promise<void> {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [
    sub ? JSON.stringify({ sub }) : '',
  ]);
  await db.exec(`set role ${role}`);
}

async function count(sql: string): Promise<number> {
  const result = await db.query<{ n: number }>(sql);
  return Number(result.rows[0]?.n ?? 0);
}

async function denialCode(sql: string): Promise<string | undefined> {
  try {
    await db.query(sql);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

afterAll(async () => {
  await db.close();
});

it('aplica el esquema y hace cumplir la RLS en Postgres', async () => {
  await db.exec(PRELUDE);
  await db.exec(migrationSql);
  await db.exec(FIXTURES);

  // Trigger de perfiles
  expect.soft(await count('select count(*)::int as n from public.profiles')).toBe(2);
  expect
    .soft(await count(`select count(*)::int as n from public.profiles where nick = 'Cuenta A'`))
    .toBe(1);

  // Cuenta A: estado privado invisible, datos de mesa visibles
  await asRole('authenticated', A);
  expect.soft(await count('select count(*)::int as n from public.seat_state')).toBe(0);
  expect
    .soft(await count(`select count(*)::int as n from public.seat_state where seat_idx = 1`))
    .toBe(0);
  expect.soft(await count('select count(*)::int as n from public.orders')).toBe(0);
  expect.soft(await count('select count(*)::int as n from public.matches')).toBe(1);
  expect.soft(await count('select count(*)::int as n from public.profiles')).toBe(2);
  expect.soft(await count('select count(*)::int as n from public.turn_events')).toBe(1);
  expect
    .soft(
      await count(
        `select count(*)::int as n from public.turn_events where visibility = 'public'`,
      ),
    )
    .toBe(1);
  expect.soft(await count('select count(*)::int as n from public.chronicle')).toBe(0);
  expect.soft(await count('select count(*)::int as n from public.whispers')).toBe(1);
  expect.soft(await count('select count(*)::int as n from public.turn_votes')).toBe(1);

  const view = await db.query<{ [key: string]: unknown }>('select * from public.chronicle_public');
  expect.soft(view.rows.length).toBe(1);
  expect.soft(view.rows[0] && !('private' in view.rows[0])).toBe(true);

  // Escrituras: solo la orden propia y en la fase correcta
  expect
    .soft(
      await denialCode(
        `insert into public.orders (match_id, seat_idx, turn, payload)
         values ('${MATCH}', 0, 1, '{"window":"1d","schedule":[]}'::jsonb)`,
      ),
    )
    .toBeUndefined();
  expect
    .soft(
      await denialCode(
        `insert into public.orders (match_id, seat_idx, turn, payload)
         values ('${MATCH}', 1, 1, '{"window":"1d","schedule":[]}'::jsonb)`,
      ),
    )
    .toBe('42501');
  const claim = await db.query<{ seat_idx: number }>(
    `update public.seats set user_id = '${A}'
     where match_id = '${MATCH}' and seat_idx = 1
     returning seat_idx`,
  );
  expect.soft(claim.rows.length).toBe(0);
  expect
    .soft(
      await denialCode(
        `insert into public.seat_state (match_id, seat_idx, fe) values ('${MATCH}', 0, 999)`,
      ),
    )
    .toBe('42501');

  // Cuenta B
  await asRole('authenticated', B);
  expect.soft(await count('select count(*)::int as n from public.seat_state')).toBe(0);

  // Voto secreto hasta el cierre de la papeleta
  await asRole('postgres');
  await db.exec(`update public.turn_proposals set status = 'passed' where id = '${PROPOSAL}'`);
  await asRole('authenticated', A);
  expect.soft(await count('select count(*)::int as n from public.turn_votes')).toBe(2);

  // Anónimo: sin acceso a datos de partida
  await asRole('anon');
  expect.soft(await count('select count(*)::int as n from public.matches')).toBe(0);
  expect.soft(await count('select count(*)::int as n from public.profiles')).toBe(0);
  expect
    .soft(await denialCode('select count(*)::int as n from public.chronicle_public'))
    .toBe('42501');
  expect
    .soft(
      await denialCode(
        `insert into public.orders (match_id, seat_idx, turn, payload)
         values ('${MATCH}', 0, 1, '{"window":"1d","schedule":[]}'::jsonb)`,
      ),
    )
    .toBe('42501');

  // service_role se salta RLS
  await asRole('service_role');
  expect.soft(await count('select count(*)::int as n from public.seat_state')).toBe(2);
  expect.soft(await count('select count(*)::int as n from public.chronicle')).toBe(1);

  await asRole('postgres');
  expect
    .soft(await count(`select count(*)::int as n from pg_policies where tablename = 'seat_state'`))
    .toBe(0);
}, 30_000);
