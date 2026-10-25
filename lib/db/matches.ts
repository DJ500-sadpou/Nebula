import { randomInt, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { digestState } from '../engine/digest';
import { MatchState, TurnEvent } from '../engine/types';
import {
  PEOR_CARTA,
  createSoloState,
  resolveSoloTurn,
  sanitizePlan,
  sanitizeProblemOption,
} from '../match/solo';
import { createAdminSupabase } from './admin';
import {
  LoadedRows,
  MatchRow,
  SeatPublicRow,
  SeatRow,
  SeatStateRow,
  stateFromRows,
} from './map';

/**
 * Acceso a partidas con `service_role`. Es el único sitio donde el servidor
 * habla con la base para jugar: el motor no sabe que existe y el cliente nunca
 * escribe estado (§3.1 de PLAN.md, AGENTS.md invariante 3).
 */

export interface SeatWithUser extends SeatRow {
  user_id: string | null;
}

export interface ChronicleLine {
  turn: number;
  publicText: string;
  privateText: string | null;
}

export interface MatchView {
  match: MatchRow;
  state: MatchState;
  seats: SeatWithUser[];
  chronicle: ChronicleLine[];
  events: TurnEvent[];
  mySeat: number;
}

export type CreateResult =
  | { ok: true; code: string }
  | { ok: false; reason: 'unconfigured' | 'failed'; detail?: string };

export type LoadResult =
  | { ok: true; view: MatchView }
  | { ok: false; reason: 'unconfigured' | 'not_found' | 'forbidden' | 'failed' };

export type TurnResult =
  | { ok: true; status: 'applied' | 'replayed'; finished: boolean; turn: number }
  | {
      ok: false;
      reason: 'unconfigured' | 'not_found' | 'forbidden' | 'finished' | 'busy' | 'stale' | 'failed';
      detail?: string;
    };

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(): string {
  let code = '';
  for (let i = 0; i < 6; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** Semilla de partida. `crypto` vive en la capa de datos, nunca en el motor. */
function randomSeed(): number {
  return randomInt(1, 2_000_000_000);
}

interface MatchRowWithCode extends MatchRow {
  code: string;
}

async function loadRows(
  admin: SupabaseClient,
  code: string,
): Promise<{ match: MatchRowWithCode; rows: LoadedRows; seats: SeatWithUser[] } | null> {
  const { data: match, error } = await admin
    .from('matches')
    .select('*')
    .eq('code', code)
    .maybeSingle();

  if (error) throw new Error(`No se pudo leer la partida: ${error.message}`);
  if (!match) return null;

  const matchRow = match as unknown as MatchRowWithCode;

  const [seatsResult, statesResult, publicsResult, milestonesResult] = await Promise.all([
    admin
      .from('seats')
      .select('seat_idx, kind, name, area_card, domain_card, user_id')
      .eq('match_id', matchRow.id)
      .order('seat_idx'),
    admin.from('seat_state').select('*').eq('match_id', matchRow.id).order('seat_idx'),
    admin.from('seat_public').select('*').eq('match_id', matchRow.id).order('seat_idx'),
    admin.from('milestones').select('key, claimed_by_seat').eq('match_id', matchRow.id),
  ]);

  if (seatsResult.error || statesResult.error || publicsResult.error || milestonesResult.error) {
    throw new Error('No se pudieron leer los asientos de la partida');
  }

  const seats = (seatsResult.data ?? []) as unknown as SeatWithUser[];
  const milestoneRows = (milestonesResult.data ?? []) as unknown as {
    key: string;
    claimed_by_seat: number;
  }[];
  const milestones: Record<string, number> = {};
  for (const row of milestoneRows) milestones[row.key] = row.claimed_by_seat;

  const rows: LoadedRows = {
    match: matchRow,
    seats,
    states: (statesResult.data ?? []) as unknown as SeatStateRow[],
    publics: (publicsResult.data ?? []) as unknown as SeatPublicRow[],
    milestones,
  };

  return { match: matchRow, rows, seats };
}

export async function createSoloMatch(userId: string): Promise<CreateResult> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, reason: 'unconfigured' };

  const state = createSoloState(randomSeed());
  const id = randomUUID();
  const config = {
    mode: PEOR_CARTA.mode,
    turnLimit: PEOR_CARTA.turnLimit,
  };

  let lastDetail = 'No se pudo crear la partida';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode();
    const { error } = await admin.rpc('create_solo_match', {
      p_match: id,
      p_code: code,
      p_state: state,
      p_config: config,
      p_human: userId,
    });

    if (!error) return { ok: true, code };
    lastDetail = error.message;
    // 23505 = código repetido: se prueba otro. Cualquier otro error es real.
    if (error.code !== '23505') break;
  }

  return { ok: false, reason: 'failed', detail: lastDetail };
}

export async function loadMatchForUser(
  code: string,
  userId: string,
): Promise<LoadResult> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, reason: 'unconfigured' };

  let loaded: Awaited<ReturnType<typeof loadRows>>;
  try {
    loaded = await loadRows(admin, code.toUpperCase());
  } catch {
    return { ok: false, reason: 'failed' };
  }
  if (!loaded) return { ok: false, reason: 'not_found' };

  const mySeat = loaded.seats.find((seat) => seat.user_id === userId);
  if (!mySeat) return { ok: false, reason: 'forbidden' };

  const [chronicleResult, eventsResult] = await Promise.all([
    admin
      .from('chronicle')
      .select('turn, public_text, private')
      .eq('match_id', loaded.match.id)
      .order('turn'),
    admin
      .from('turn_events')
      .select('turn, visibility, seat_idx, kind, text, payload')
      .eq('match_id', loaded.match.id)
      .order('id'),
  ]);

  if (chronicleResult.error || eventsResult.error) {
    return { ok: false, reason: 'failed' };
  }

  const chronicleRows = (chronicleResult.data ?? []) as unknown as {
    turn: number;
    public_text: string;
    private: Record<string, string>;
  }[];

  const chronicle: ChronicleLine[] = chronicleRows.map((row) => ({
    turn: row.turn,
    publicText: row.public_text,
    privateText: row.private?.[String(mySeat.seat_idx)] ?? null,
  }));

  const events = ((eventsResult.data ?? []) as unknown as {
    turn: number;
    visibility: 'public' | 'seat' | 'pair';
    seat_idx: number | null;
    kind: string;
    text: string;
    payload: Record<string, number | string> | null;
  }[])
    .filter(
      (event) =>
        event.visibility === 'public' ||
        (event.visibility === 'seat' && event.seat_idx === mySeat.seat_idx),
    )
    .map<TurnEvent>((event) => ({
      turn: event.turn,
      visibility: event.visibility === 'seat' ? 'seat' : 'public',
      seatId: event.seat_idx,
      kind: event.kind,
      text: event.text,
      data: event.payload ?? undefined,
    }));

  let state: MatchState;
  try {
    state = stateFromRows(loaded.rows);
  } catch {
    return { ok: false, reason: 'failed' };
  }

  return {
    ok: true,
    view: {
      match: loaded.match,
      state,
      seats: loaded.seats,
      chronicle,
      events,
      mySeat: mySeat.seat_idx,
    },
  };
}

/**
 * Resuelve el turno en curso: claim atómico, motor, y `apply_turn` idempotente.
 * Si algo falla después del claim, se libera para que la mesa pueda reintentar.
 */
export async function resolveMatchTurn(
  code: string,
  userId: string,
  planInput: unknown,
  problemInput: unknown,
  expectedTurn?: number,
): Promise<TurnResult> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, reason: 'unconfigured' };

  let loaded: Awaited<ReturnType<typeof loadRows>>;
  try {
    loaded = await loadRows(admin, code.toUpperCase());
  } catch (error) {
    return { ok: false, reason: 'failed', detail: (error as Error).message };
  }
  if (!loaded) return { ok: false, reason: 'not_found' };

  const mySeat = loaded.seats.find((seat) => seat.user_id === userId);
  if (!mySeat) return { ok: false, reason: 'forbidden' };
  if (loaded.match.status === 'finished' || loaded.match.status === 'closed') {
    return { ok: false, reason: 'finished' };
  }

  // Dos clics no resuelven dos turnos: el segundo envío llega con el turno que
  // el jugador ya no está viendo y se rechaza antes de tocar nada.
  if (Number.isInteger(expectedTurn) && expectedTurn !== loaded.match.turn) {
    return { ok: false, reason: 'stale' };
  }

  const turn = loaded.match.turn;
  const { data: claimed, error: claimError } = await admin.rpc('claim_turn', {
    p_match: loaded.match.id,
    p_turn: turn,
  });
  if (claimError) return { ok: false, reason: 'failed', detail: claimError.message };
  if (claimed !== true) return { ok: false, reason: 'busy' };

  try {
    const state = stateFromRows(loaded.rows);
    const plan = sanitizePlan(planInput);
    const problemOption = sanitizeProblemOption(problemInput);
    const turnLimit = loaded.match.config?.turnLimit ?? PEOR_CARTA.turnLimit;
    const result = resolveSoloTurn(state, mySeat.seat_idx, plan, problemOption, turnLimit);

    const { events: _events, ...stateWithoutEvents } = result.state;
    const payloadState = { ...stateWithoutEvents, events: [] };

    const { data: applied, error: applyError } = await admin.rpc('apply_turn', {
      p_match: loaded.match.id,
      p_turn: turn,
      p_payload: {
        digest: digestState(result.state),
        state: payloadState,
        events: result.events,
        chronicle: {
          public: result.chronicle.publicText,
          private: { [String(mySeat.seat_idx)]: result.chronicle.privateText },
        },
      },
    });

    if (applyError) throw new Error(applyError.message);

    return {
      ok: true,
      status: applied === 'replayed' ? 'replayed' : 'applied',
      finished: result.closed || result.state.finished,
      turn: result.state.turn,
    };
  } catch (error) {
    await admin.rpc('release_turn', { p_match: loaded.match.id });
    return { ok: false, reason: 'failed', detail: (error as Error).message };
  }
}
