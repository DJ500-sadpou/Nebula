import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Auditoría estática de las migraciones.
 *
 * No sustituye al test de dos cuentas (`npm run test:rls`, que necesita un
 * proyecto real), pero se ejecuta en cada `npm test` y detecta el fallo más
 * probable: añadir una tabla y olvidar su RLS, o abrir una política de más.
 */

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

const TABLES = [
  'profiles',
  'matches',
  'seats',
  'seat_state',
  'seat_public',
  'orders',
  'turn_proposals',
  'turn_votes',
  'wars',
  'pacts',
  'missions',
  'milestones',
  'turn_resolutions',
  'turn_events',
  'chronicle',
  'whispers',
] as const;

function loadSql(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  expect(files.length).toBeGreaterThanOrEqual(2);

  const sql = files
    .map((name) => readFileSync(join(MIGRATIONS_DIR, name), 'utf8'))
    .join('\n');

  // Los comentarios mencionan tablas y políticas: fuera para no dar falsos positivos.
  return sql.replace(/--[^\n]*/g, '');
}

const SQL = loadSql();

function hasRls(table: string): boolean {
  const pattern = new RegExp(
    `alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`,
    'i',
  );
  return pattern.test(SQL);
}

function policiesOn(table: string): number {
  const pattern = new RegExp(`on\\s+public\\.${table}\\b`, 'gi');
  return SQL.match(pattern)?.length ?? 0;
}

describe('migraciones de esquema', () => {
  it.each(TABLES)('la tabla %s tiene RLS activa', (table) => {
    expect(hasRls(table)).toBe(true);
  });

  it('no crea tablas fuera del modelo documentado', () => {
    const created = [...SQL.matchAll(/create\s+table\s+public\.([a-z_]+)/gi)].map((m) => m[1]);
    expect(new Set(created)).toEqual(new Set(TABLES));
  });

  it('todas las tablas se crean con claves y sin duplicados', () => {
    const created = [...SQL.matchAll(/create\s+table\s+public\.([a-z_]+)/gi)].map((m) => m[1]);
    expect(created).toHaveLength(new Set(created).size);
  });

  it('crea el perfil automático al registrarse', () => {
    expect(/after\s+insert\s+on\s+auth\.users/i.test(SQL)).toBe(true);
    expect(/function\s+public\.handle_new_user\(\)/i.test(SQL)).toBe(true);
  });
});

describe('privacidad', () => {
  it('seat_state no tiene ninguna política: solo service_role la lee', () => {
    expect(policiesOn('seat_state')).toBe(0);
  });

  it('chronicle no se expone directamente; solo la vista pública', () => {
    expect(policiesOn('chronicle')).toBe(0);
    expect(/create\s+view\s+public\.chronicle_public/i.test(SQL)).toBe(true);
    expect(/grant\s+select\s+on\s+public\.chronicle_public\s+to\s+authenticated/i.test(SQL)).toBe(
      true,
    );
    expect(/revoke\s+all\s+on\s+public\.chronicle_public\s+from\s+anon/i.test(SQL)).toBe(true);
  });

  it('los helpers de pertenencia son security definer y fijan search_path', () => {
    for (const fn of ['is_match_participant', 'my_seat', 'match_phase', 'match_turn']) {
      const block = new RegExp(
        `create\\s+function\\s+public\\.${fn}\\([^)]*\\)[\\s\\S]*?;\\s*\\n`,
        'i',
      ).exec(SQL)?.[0];
      expect(block, `falta la función ${fn}`).toBeTruthy();
      expect(block).toMatch(/security\s+definer/i);
      expect(block).toMatch(/set\s+search_path\s*=\s*''/i);
    }
  });

  it('las órdenes solo se insertan en el asiento propio, en fase y turno correctos', () => {
    const policy =
      /create\s+policy\s+orders_insert_own[\s\S]*?;/.exec(SQL)?.[0] ?? '';
    expect(policy).toMatch(/seat_idx\s*=\s*public\.my_seat\(match_id\)/i);
    expect(policy).toMatch(/public\.match_phase\(match_id\)\s*=\s*'orders'/i);
    expect(policy).toMatch(/turn\s*=\s*public\.match_turn\(match_id\)/i);
  });

  it('los eventos privados se filtran por asiento y por pareja', () => {
    const policy = /create\s+policy\s+turn_events_read_visible[\s\S]*?;/.exec(SQL)?.[0] ?? '';
    expect(policy).toMatch(/visibility\s*=\s*'seat'\s+and\s+seat_idx\s*=\s*public\.my_seat/i);
    expect(policy).toMatch(/pair_seat\s*=\s*public\.my_seat/i);
  });

  it('los susurros solo los ven emisor y receptor', () => {
    const policy = /create\s+policy\s+whispers_read_involved[\s\S]*?;/.exec(SQL)?.[0] ?? '';
    expect(policy).toMatch(/from_seat\s*=\s*public\.my_seat/i);
    expect(policy).toMatch(/to_seat\s*=\s*public\.my_seat/i);
  });

  it('los votos ajenos no se leen hasta cerrar la papeleta', () => {
    const policy = /create\s+policy\s+turn_votes_read_after_close[\s\S]*?;/.exec(SQL)?.[0] ?? '';
    expect(policy).toMatch(/p\.status\s*<>\s*'open'/i);
  });
});
