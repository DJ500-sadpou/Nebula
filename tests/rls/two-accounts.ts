/**
 * Test de dos cuentas (PLAN.md §4.1 y §6, Fase 1).
 *
 * Crea dos usuarios reales, una partida y sus asientos, y comprueba que A no
 * puede leer el estado privado de B por REST ni escribir en su asiento.
 *
 * Necesita un proyecto Supabase real con las migraciones aplicadas:
 *   NEXT_PUBLIC_SUPABASE_URL, clave pública y SUPABASE_SERVICE_ROLE_KEY.
 * En la nube no hay claves: sin ellas el script termina con código 2 y no
 * cuenta como fallo. Ver PENDIENTES.md P-03.
 *
 * Uso: npm run test:rls
 */

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readPublicSupabaseEnv } from '../../lib/db/env';

const ENV_FILE = '.env.local';
if (existsSync(ENV_FILE)) {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch (error) {
    console.warn(`No se pudo leer ${ENV_FILE}:`, error instanceof Error ? error.message : error);
  }
}

const env = readPublicSupabaseEnv();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!env || !serviceKey) {
  console.error(
    [
      'PENDIENTE: faltan claves de Supabase para el test de dos cuentas.',
      '  · NEXT_PUBLIC_SUPABASE_URL y la clave pública',
      '  · SUPABASE_SERVICE_ROLE_KEY (solo servidor)',
      'Rellena .env.local y aplica las migraciones. Checklist: PENDIENTES.md P-03.',
    ].join('\n'),
  );
  process.exit(2);
}

const config = env;
const PASSWORD = `Prueba-${randomUUID()}`;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const matchId = randomUUID();
const code = Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');

const admin = createClient(config.url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const failures: string[] = [];
let checks = 0;

function check(label: string, ok: boolean, detail = ''): void {
  checks += 1;
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
}

async function makeAccount(tag: string): Promise<{ id: string; email: string; client: SupabaseClient }> {
  const email = `rls-${tag}-${Date.now()}@example.test`;
  const created = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { nick: `Cuenta ${tag.toUpperCase()}` },
  });
  if (created.error || !created.data.user) {
    throw new Error(`No se pudo crear la cuenta ${tag}: ${created.error?.message ?? 'sin usuario'}`);
  }

  const client = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const session = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (session.error || !session.data.session) {
    throw new Error(`No se pudo entrar como ${tag}: ${session.error?.message ?? 'sin sesión'}`);
  }

  return { id: created.data.user.id, email, client };
}

let accountA: Awaited<ReturnType<typeof makeAccount>> | null = null;
let accountB: Awaited<ReturnType<typeof makeAccount>> | null = null;

try {
  console.log('Preparando dos cuentas y una partida…');
  accountA = await makeAccount('a');
  accountB = await makeAccount('b');

  const match = await admin.from('matches').insert({
    id: matchId,
    code,
    status: 'orders',
    phase: 'orders',
    seed: 42,
    turn: 1,
    window_id: '1d',
  });
  if (match.error) throw new Error(`No se pudo crear la partida: ${match.error.message}`);

  const seats = await admin.from('seats').insert([
    { match_id: matchId, seat_idx: 0, kind: 'human', user_id: accountA.id, name: 'Cuenta A' },
    { match_id: matchId, seat_idx: 1, kind: 'human', user_id: accountB.id, name: 'Cuenta B' },
  ]);
  if (seats.error) throw new Error(`No se pudieron crear los asientos: ${seats.error.message}`);

  const states = await admin.from('seat_state').insert([
    { match_id: matchId, seat_idx: 0, fe: 111, believers: 10 },
    { match_id: matchId, seat_idx: 1, fe: 222, believers: 20 },
  ]);
  if (states.error) throw new Error(`No se pudo crear seat_state: ${states.error.message}`);

  await admin.from('orders').insert({
    match_id: matchId,
    seat_idx: 1,
    turn: 1,
    payload: { window: '1d', schedule: [] },
  });

  await admin.from('turn_events').insert([
    {
      match_id: matchId,
      turn: 1,
      visibility: 'public',
      kind: 'prueba',
      text: 'Evento público',
    },
    {
      match_id: matchId,
      turn: 1,
      visibility: 'seat',
      seat_idx: 1,
      kind: 'prueba',
      text: 'Evento privado de B',
    },
  ]);

  await admin.from('chronicle').insert({
    match_id: matchId,
    turn: 1,
    public_text: 'Crónica pública del turno.',
    private: { 1: 'B investigó minerales en secreto.' },
  });

  console.log('\nComprobaciones con la cuenta A:');

  const seatState = await accountA.client.from('seat_state').select('*');
  check(
    'A no lee ninguna fila de seat_state',
    !seatState.error && (seatState.data ?? []).length === 0,
    seatState.error?.message,
  );

  const rivalState = await accountA.client
    .from('seat_state')
    .select('fe')
    .eq('match_id', matchId)
    .eq('seat_idx', 1);
  check(
    'A no ve la Fe de B (222)',
    !rivalState.error && (rivalState.data ?? []).length === 0,
    rivalState.error?.message ?? JSON.stringify(rivalState.data),
  );

  const ownOrders = await accountA.client.from('orders').select('*');
  check(
    'A no lee la orden secreta de B',
    !ownOrders.error && (ownOrders.data ?? []).length === 0,
    ownOrders.error?.message,
  );

  const insertForB = await accountA.client.from('orders').insert({
    match_id: matchId,
    seat_idx: 1,
    turn: 1,
    payload: { window: '1d', schedule: [] },
  });
  check('A no puede insertar una orden en el asiento de B', insertForB.error !== null, insertForB.error?.message);

  const claimB = await accountA.client
    .from('seats')
    .update({ user_id: accountA.id })
    .eq('match_id', matchId)
    .eq('seat_idx', 1)
    .select();
  check('A no puede reclamar el asiento de B', (claimB.data ?? []).length === 0, claimB.error?.message);

  const events = await accountA.client.from('turn_events').select('visibility, seat_idx');
  const rows = events.data ?? [];
  check(
    'A solo ve el evento público',
    !events.error && rows.length === 1 && rows[0]?.visibility === 'public',
    events.error?.message ?? JSON.stringify(rows),
  );

  const chronicle = await accountA.client.from('chronicle').select('*');
  check(
    'A no lee la crónica privada directamente',
    !chronicle.error && (chronicle.data ?? []).length === 0,
    chronicle.error?.message,
  );

  const publicChronicle = await accountA.client.from('chronicle_public').select('*');
  const publicRow = (publicChronicle.data ?? [])[0] as Record<string, unknown> | undefined;
  check(
    'A lee la crónica pública sin el campo private',
    !publicChronicle.error && publicRow !== undefined && !('private' in publicRow),
    publicChronicle.error?.message ?? JSON.stringify(publicRow),
  );

  const matches = await accountA.client.from('matches').select('id');
  check(
    'A ve su partida como participante',
    !matches.error && (matches.data ?? []).length === 1,
    matches.error?.message,
  );

  const ownStateB = await accountB.client.from('seat_state').select('*');
  check(
    'B tampoco lee seat_state: ni siquiera el suyo',
    !ownStateB.error && (ownStateB.data ?? []).length === 0,
    ownStateB.error?.message,
  );
} catch (error) {
  console.error('\nError inesperado:', error instanceof Error ? error.message : error);
  failures.push('excepción');
} finally {
  console.log('\nLimpiando datos de prueba…');
  await admin.from('matches').delete().eq('id', matchId);
  for (const account of [accountA, accountB]) {
    if (account) await admin.auth.admin.deleteUser(account.id);
  }
}

if (failures.length > 0) {
  console.error(`\nFALLAN ${failures.length} comprobaciones:`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}

console.log(`\nRLS correcta: 2 cuentas, ${checks} comprobaciones en verde.`);
