/**
 * Retención manual (REGLAS.md §21.2, Fase 7A): archiva las partidas
 * terminadas con más de 30 días, guardando su resumen y liberando el detalle.
 *
 * La creación de una mesa nueva ya dispara la misma limpieza dentro de la
 * propia transacción (`create_solo_match` / `create_lobby`), así que esto no
 * es obligatorio para jugar: es la llave manual para barrer sin abrir mesa,
 * con las claves del `.env.local` del equipo del usuario.
 *
 * Uso: npm run prune        (30 días)
 *      npm run prune -- 60  (otro período)
 */

import { existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { readPublicSupabaseEnv } from '../lib/db/env';

const ENV_FILE = '.env.local';
if (existsSync(ENV_FILE)) {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch (error) {
    console.warn(
      `No se pudo leer ${ENV_FILE}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

const env = readPublicSupabaseEnv();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!env || !serviceKey) {
  console.error(
    [
      'PENDIENTE: faltan claves de Supabase para ejecutar la retención.',
      '  · NEXT_PUBLIC_SUPABASE_URL y la clave pública',
      '  · SUPABASE_SERVICE_ROLE_KEY (solo servidor)',
      'Rellena .env.local y aplica las migraciones. Checklist: PENDIENTES.md P-02.',
    ].join('\n'),
  );
  process.exit(2);
}

const days = Math.max(1, Number(process.argv[2] ?? 30) || 30);

const admin = createClient(env.url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await admin.rpc('prune_finished_matches', { p_days: days });

if (error) {
  console.error(`No se pudo ejecutar la retención: ${error.message}`);
  process.exit(1);
}

console.log(
  `Retención aplicada: ${data ?? 0} partida(s) archivada(s) con más de ${days} día(s). ` +
    'Cada una conserva su resumen (REGLAS.md §21.2).',
);
