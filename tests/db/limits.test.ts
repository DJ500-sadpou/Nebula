import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSoloState } from '../../lib/match/solo';

/**
 * Límites del servicio (Fase 7A, REGLAS.md §21) en Postgres 17 (PGlite):
 *
 *   §21.1 — máximo 3 mesas activas por jugador, con el guard en SQL (creación
 *           y asiento) para que tampoco entre por REST directo.
 *   §21.2 — retención: terminadas de más de 30 días → solo resumen; el
 *           disparo vive dentro de la creación de mesas y `prune_finished_matches`
 *           es la llave manual. `apply_turn` fija `closed_at` al terminar.
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

const H = '11111111-1111-4111-8111-111111111111';
const I = '22222222-2222-4222-8222-222222222222';
const J = '33333333-3333-4333-8333-333333333333';

const L1 = '00000000-0000-4000-8000-0000000a0001';
const L2 = '00000000-0000-4000-8000-0000000a0002';
const L3 = '00000000-0000-4000-8000-0000000a0003';
const L4 = '00000000-0000-4000-8000-0000000a0004';
const SOLO = '00000000-0000-4000-8000-0000000a0005';
const IRIA = '00000000-0000-4000-8000-0000000a0006';
const P1 = '00000000-0000-4000-8000-0000000b0001';
const P2 = '00000000-0000-4000-8000-0000000b0002';
const P3 = '00000000-0000-4000-8000-0000000b0003';
const P4 = '00000000-0000-4000-8000-0000000b0004';

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

const FIXTURES = [H, I, J]
  .map((id, idx) => {
    const nicks = ['Halcón', 'Iria', 'Jade'];
    return `insert into auth.users (id, raw_user_meta_data) values ('${id}', '{"nick":"${nicks[idx]}"}');`;
  })
  .join('\n');

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

async function rpc<T>(sql: string, params: unknown[]): Promise<T | null> {
  const rows = await all<Row>(sql, params);
  const first = Object.values(rows[0] ?? {})[0];
  return (first as T) ?? null;
}

async function createLobby(id: string, code: string, seed: number, host: string): Promise<void> {
  await rpc('select public.create_lobby($1::uuid, $2, $3::bigint, $4::jsonb, $5::uuid)', [
    id,
    code,
    seed,
    JSON.stringify({ mode: 'multi', seats: 6, turnLimit: 12, turnSeconds: 120, unlockEvery: 1 }),
    host,
  ]);
}

/** Payload mínimo que `apply_turn` acepta para terminar una partida. */
function finishedPayload(turn: number): string {
  return JSON.stringify({
    digest: `digest-${turn}`,
    state: {
      turn,
      finished: true,
      windowId: '1d',
      windowsUnlocked: ['1d'],
      unlockEvery: 1,
      fictionDay: turn,
      era: 'tribal',
      eraBar: 0.1,
      lastBarRiseTurn: 1,
      tableVoters: 0,
      peaceUntilTurn: 0,
      winnerSeat: 0,
      seats: [],
      milestones: {},
      events: [],
    },
    events: [],
    chronicle: { public: 'El mundo queda en silencio.', private: {} },
  });
}

describe('límite de mesas activas (§21.1)', () => {
  beforeAll(async () => {
    await db.exec(PRELUDE);
    await db.exec(migrationSql);
    await db.exec(FIXTURES);
  });

  it('el anfitrión mantiene como máximo 3 mesas activas', async () => {
    await createLobby(L1, 'LIM001', 11, H);
    await createLobby(L2, 'LIM002', 11, H);
    await createLobby(L3, 'LIM003', 11, H);

    await expect(createLobby(L4, 'LIM004', 11, H)).rejects.toThrow('too_many_active');
    expect(await rpc<number>('select public.active_seat_count($1::uuid)', [H])).toBe(3);
  });

  it('el guard también vela la creación del modo de un jugador', async () => {
    await expect(
      db.query('select public.create_solo_match($1::uuid, $2, $3::jsonb, $4::jsonb, $5::uuid)', [
        SOLO,
        'SOLO01',
        JSON.stringify(createSoloState(77)),
        JSON.stringify({ mode: 'peor_carta', turnLimit: 12 }),
        H,
      ]),
    ).rejects.toThrow('too_many_active');
  });

  it('sentarse en mesa ajena cuenta igual y responde -4', async () => {
    await createLobby(IRIA, 'IRIA01', 12, I);
    await rpc<number>('select public.join_lobby($1::uuid, $2::uuid)', [L1, I]);
    await rpc<number>('select public.join_lobby($1::uuid, $2::uuid)', [L2, I]);

    // I ya mantiene 3 activas (IRIA01 + dos de H): la tercera se rechaza.
    await expect(rpc<number>('select public.join_lobby($1::uuid, $2::uuid)', [L3, I])).resolves.toBe(
      -4,
    );
  });

  it('abandonar y terminar liberan el asiento', async () => {
    // H deja LIM001 (fase lobby: el asiento desaparece) y queda con 2.
    await rpc<string>('select public.leave_seat($1::uuid, $2::uuid)', [L1, H]);
    expect(await rpc<number>('select public.active_seat_count($1::uuid)', [H])).toBe(2);

    // La cuarta mesa ya entra.
    await createLobby(L4, 'LIM004', 11, H);
    expect(await rpc<number>('select public.active_seat_count($1::uuid)', [H])).toBe(3);

    // Terminar una partida también libera (el motor la cierra con apply_turn).
    await db.query(
      "update public.matches set status = 'finished', phase = 'finished' where code = 'LIM002'",
    );
    expect(await rpc<number>('select public.active_seat_count($1::uuid)', [H])).toBe(2);
  });
});

describe('retención de terminadas (§21.2)', () => {
  it('apply_turn fija closed_at al terminar y el replay no lo mueve', async () => {
    await createLobby(P1, 'PRUNE1', 21, J);

    const applied = await rpc<string>('select public.apply_turn($1::uuid, $2::int, $3::jsonb)', [
      P1,
      1,
      finishedPayload(2),
    ]);
    expect(applied).toBe('applied');

    const first = (
      await all<{ status: string; closed_at: string }>(
        'select status, closed_at from public.matches where code = $1',
        ['PRUNE1'],
      )
    )[0];
    expect(first.status).toBe('finished');
    expect(first.closed_at).not.toBeNull();

    // Replay del mismo turno: la primera fecha de cierre es la que queda.
    await rpc<string>('select public.apply_turn($1::uuid, $2::int, $3::jsonb)', [
      P1,
      1,
      finishedPayload(2),
    ]);
    const second = (
      await all<{ closed_at: string | Date }>('select closed_at from public.matches where code = $1', [
        'PRUNE1',
      ])
    )[0];
    // PGlite devuelve `timestamptz` como Date: se compara el instante.
    expect(new Date(second.closed_at).getTime()).toBe(new Date(first.closed_at).getTime());
  });

  it('prune archiva las terminadas viejas guardando el resumen', async () => {
    // El turno 1 dejó crónica; se añaden órdenes y eventos como fixture del
    // detalle pesado que la retención debe liberar.
    await db.query(
      `insert into public.orders (match_id, seat_idx, turn, payload)
       values ('${P1}', 0, 1, '{}'::jsonb)`,
    );
    await db.query(
      `insert into public.turn_events (match_id, turn, visibility, kind, text)
       values ('${P1}', 1, 'public', 'tormenta', 'Llueve.')`,
    );

    // Cuarenta días de antigüedad desde el cierre real.
    await db.query("update public.matches set closed_at = now() - interval '40 days' where code = 'PRUNE1'");

    const pruned = await rpc<number>('select public.prune_finished_matches($1::int)', [30]);
    expect(pruned).toBe(1);

    const match = (
      await all<Row>('select * from public.matches where code = $1', ['PRUNE1'])
    )[0];
    expect(match.status).toBe('closed');
    expect(match.phase).toBe('closed');
    expect(match.pruned_at).not.toBeNull();

    const summary = match.summary as Record<string, unknown>;
    expect(summary.mode).toBe('multi');
    expect(Number(summary.seats)).toBe(1);
    expect(Number(summary.turns)).toBe(2);
    expect(Number(summary.winnerSeat)).toBe(0);
    expect(summary.winnerName).toBe('Jade');

    // El resumen conserva el cierre real (40 días atrás), no el momento del prune.
    const closedOld = (
      await all<{ old_enough: boolean }>(
        `select ((summary ->> 'closedAt')::timestamptz < now() - interval '39 days') as old_enough
           from public.matches where code = $1`,
        ['PRUNE1'],
      )
    )[0];
    expect(closedOld.old_enough).toBe(true);

    // El detalle pesado desaparece; la mesa y sus jugadores quedan.
    const counts = (
      await all<Record<string, number>>(
        `select
           (select count(*)::int from public.seat_state where match_id = $1) as seat_state,
           (select count(*)::int from public.seat_public where match_id = $1) as seat_public,
           (select count(*)::int from public.orders where match_id = $1) as orders,
           (select count(*)::int from public.turn_events where match_id = $1) as turn_events,
           (select count(*)::int from public.chronicle where match_id = $1) as chronicle,
           (select count(*)::int from public.turn_resolutions where match_id = $1) as resolutions,
           (select count(*)::int from public.seats where match_id = $1) as seats`,
        [P1],
      )
    )[0];
    expect(counts.seat_state).toBe(0);
    expect(counts.seat_public).toBe(0);
    expect(counts.orders).toBe(0);
    expect(counts.turn_events).toBe(0);
    expect(counts.chronicle).toBe(0);
    expect(counts.resolutions).toBe(0);
    expect(counts.seats).toBe(1);
  });

  it('no toca activas ni terminadas recientes, y es idempotente', async () => {
    // Terminada hace 5 días: dentro del período de gracia.
    await createLobby(P2, 'PRUNE2', 22, J);
    await rpc<string>('select public.apply_turn($1::uuid, $2::int, $3::jsonb)', [
      P2,
      1,
      finishedPayload(2),
    ]);
    await db.query("update public.matches set closed_at = now() - interval '5 days' where code = 'PRUNE2'");

    // Segunda pasada sobre lo ya archivado: nada nuevo.
    expect(await rpc<number>('select public.prune_finished_matches($1::int)', [30])).toBe(0);

    const recent = (
      await all<{ status: string; pruned: boolean }>(
        'select status, (pruned_at is not null) as pruned from public.matches where code = $1',
        ['PRUNE2'],
      )
    )[0];
    expect(recent.status).toBe('finished');
    expect(recent.pruned).toBe(false);

    const active = (
      await all<{ status: string }>('select status from public.matches where code = $1', ['LIM004'])
    )[0];
    expect(active.status).toBe('lobby');
  });

  it('crear una mesa dispara la retención dentro de la misma transacción', async () => {
    await createLobby(P3, 'PRUNE3', 23, J);
    await rpc<string>('select public.apply_turn($1::uuid, $2::int, $3::jsonb)', [
      P3,
      1,
      finishedPayload(3),
    ]);
    await db.query("update public.matches set closed_at = now() - interval '35 days' where code = 'PRUNE3'");

    // La creación de la sala nueva barre a PRUNE3.
    await createLobby(P4, 'PRUNE4', 24, J);

    const swept = (
      await all<{ status: string; pruned: boolean }>(
        'select status, (pruned_at is not null) as pruned from public.matches where code = $1',
        ['PRUNE3'],
      )
    )[0];
    expect(swept.status).toBe('closed');
    expect(swept.pruned).toBe(true);

    const fresh = (
      await all<{ status: string; pruned: boolean }>(
        'select status, (pruned_at is not null) as pruned from public.matches where code = $1',
        ['PRUNE4'],
      )
    )[0];
    expect(fresh.status).toBe('lobby');
    expect(fresh.pruned).toBe(false);
  });
});
