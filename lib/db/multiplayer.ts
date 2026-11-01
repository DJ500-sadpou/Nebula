import type { SupabaseClient } from '@supabase/supabase-js';
import { countBallot, ballotOptions, ballotChoices } from '../engine/ballot';
import type { BallotInput, BallotOutcome } from '../engine/ballot';
import { digestState } from '../engine/digest';
import type { WindowId } from '../engine/types';
import { buildMatchState, fillSeatDefs, resolveMultiTurn, sanitizeLobbyConfig } from '../match/lobby';
import type { SubmittedOrders } from '../match/lobby';
import { sanitizePlan, sanitizeProblemOption } from '../match/solo';
import { createAdminSupabase } from './admin';
import { logError } from '../server/log';
import { randomCode, randomSeed } from './matches';
import { isWakingError, withRetry } from '../server/retry';
import {
  LoadedRows,
  MatchRow,
  SeatPublicRow,
  SeatRow,
  SeatStateRow,
  stateFromRows,
} from './map';

/**
 * Acceso multijugador con `service_role` (Fase 4). Mismas reglas que el modo
 * de un jugador: el cliente nunca escribe estado, solo envía órdenes crudas y
 * votos; el servidor valida, resuelve y aplica.
 *
 * El turno se cierra cuando todos los humanos han enviado sus órdenes o cuando
 * vence `turn_ends_at` (§5). La resolución es perezosa: no hay planificador
 * dentro del Worker — cualquier acción o *polling* después del vencimiento la
 * dispara, y si nadie mira, la mesa simplemente espera a la siguiente visita.
 */

export interface MultiSeatView {
  seatIdx: number;
  kind: 'human' | 'bot' | 'dormant' | 'empty';
  name: string;
  ready: boolean;
  /** Solo durante la fase de órdenes: si ya envió las de este turno. */
  submitted: boolean;
  mine: boolean;
  /** §17.2: un asiento `dormant` que despertó como dios maligno. */
  awakened: boolean;
}

export interface MultiLobbyView {
  code: string;
  phase: 'lobby';
  seats: MultiSeatView[];
  seatCount: number;
  hostSeat: number;
  mySeat: number;
  allReady: boolean;
  turnSeconds: number;
}

export interface MultiBallotView {
  /** Hay papeleta abierta para el turno en curso. */
  open: boolean;
  /** Ventana propuesta y quién la propuso (papeleta abierta). */
  proposal: WindowId | null;
  proposerSeat: number | null;
  /** Opciones legales de la papeleta (A.2.1 + A.2.2). */
  options: WindowId[];
  /** Voto propio en la papeleta abierta. */
  myVote: WindowId | null;
  /** Resultado del turno anterior, ya publicado con la crónica (A.2.7). */
  last: { turn: number; status: string; resultWindow: WindowId | null } | null;
  /** La ventana está forzada por un choque (A.11): no se puede proponer. */
  forced: boolean;
}

export interface MultiTurnView {
  code: string;
  phase: 'orders' | 'finished';
  turn: number;
  windowId: WindowId;
  /** Vencimiento del turno en ISO; `null` si ya venció o no aplica. */
  turnEndsAt: string | null;
  seats: MultiSeatView[];
  mySeat: number;
  mySubmitted: boolean;
  ballot: MultiBallotView;
  finished: boolean;
  winnerSeat: number | null;
  turnLimit: number;
}

export type LobbyActionResult =
  | { ok: true; status: string; seat?: number }
  | { ok: false; reason: string; detail?: string; waking?: boolean };

interface MatchRowWithExtras extends MatchRow {
  code: string;
  turn_ends_at: string | null;
  host_seat: number;
}

interface SeatRowFull extends SeatRow {
  user_id: string | null;
  ready: boolean;
}

async function loadMultiRows(
  admin: SupabaseClient,
  code: string,
): Promise<{ match: MatchRowWithExtras; rows: LoadedRows; seats: SeatRowFull[] } | null> {
  // Lectura idempotente: se reintenta si la base parece despertar (§21.3).
  return withRetry(async () => {
    const { data: match, error } = await admin
      .from('matches')
      .select('*')
      .eq('code', code)
      .maybeSingle();

    if (error) throw new Error(`No se pudo leer la partida: ${error.message}`);
    if (!match) return null;
    const matchRow = match as unknown as MatchRowWithExtras;

    const [seatsResult, statesResult, publicsResult, milestonesResult] = await Promise.all([
      admin
        .from('seats')
        .select('seat_idx, kind, name, area_card, domain_card, user_id, ready, awakened')
        .eq('match_id', matchRow.id)
        .order('seat_idx'),
      admin.from('seat_state').select('*').eq('match_id', matchRow.id).order('seat_idx'),
      admin.from('seat_public').select('*').eq('match_id', matchRow.id).order('seat_idx'),
      admin.from('milestones').select('key, claimed_by_seat').eq('match_id', matchRow.id),
    ]);

    if (seatsResult.error || statesResult.error || publicsResult.error || milestonesResult.error) {
      throw new Error('No se pudieron leer los asientos de la partida');
    }

    const milestoneRows = (milestonesResult.data ?? []) as unknown as {
      key: string;
      claimed_by_seat: number;
    }[];
    const milestones: Record<string, number> = {};
    for (const row of milestoneRows) milestones[row.key] = row.claimed_by_seat;

    const rows: LoadedRows = {
      match: matchRow,
      seats: (seatsResult.data ?? []) as unknown as SeatRow[],
      states: (statesResult.data ?? []) as unknown as SeatStateRow[],
      publics: (publicsResult.data ?? []) as unknown as SeatPublicRow[],
      milestones,
    };

    return {
      match: matchRow,
      rows,
      seats: (seatsResult.data ?? []) as unknown as SeatRowFull[],
    };
  });
}

function seatCountOf(match: MatchRowWithExtras): number {
  const raw = (match.config as Record<string, unknown>)?.seats;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 4 && parsed <= 32 ? parsed : 8;
}

// --------------------------------------------------------------------- --
// Crear sala                                                            --
// --------------------------------------------------------------------- //

export async function createLobbyMatch(
  userId: string,
  rawConfig: unknown,
): Promise<
  | { ok: true; code: string }
  | {
      ok: false;
      reason: 'unconfigured' | 'bad_config' | 'failed' | 'limit';
      detail?: string;
      waking?: boolean;
    }
> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, reason: 'unconfigured' };

  const config = sanitizeLobbyConfig(rawConfig);
  if (!config) return { ok: false, reason: 'bad_config' };

  const seed = randomSeed();
  let lastDetail = 'No se pudo crear la sala';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode();
    const id = crypto.randomUUID();
    const { error } = await admin.rpc('create_lobby', {
      p_match: id,
      p_code: code,
      p_seed: seed,
      p_config: {
        mode: 'multi',
        seats: config.seats,
        turnLimit: config.turnLimit,
        turnSeconds: config.turnSeconds,
        unlockEvery: config.unlockEvery,
      },
      p_host: userId,
    });
    if (!error) return { ok: true, code };
    lastDetail = error.message;
    // §21.1: el guard SQL del límite de mesas activas.
    if (error.message.includes('too_many_active')) {
      return { ok: false, reason: 'limit', detail: 'too_many_active' };
    }
    // §21.3: la base despertaba mientras se creaba la sala.
    if (isWakingError(error)) {
      return { ok: false, reason: 'failed', detail: lastDetail, waking: true };
    }
    if (error.code !== '23505') break;
  }
  return { ok: false, reason: 'failed', detail: lastDetail };
}

// --------------------------------------------------------------------- --
// Vista del lobby                                                       --
// --------------------------------------------------------------------- //

export async function loadLobbyView(
  code: string,
  userId: string,
): Promise<
  | { ok: true; view: MultiLobbyView }
  | {
      ok: false;
      reason: 'unconfigured' | 'not_found' | 'not_lobby' | 'failed';
      waking?: boolean;
    }
> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, reason: 'unconfigured' };

  let loaded: Awaited<ReturnType<typeof loadMultiRows>>;
  try {
    loaded = await loadMultiRows(admin, code.toUpperCase());
  } catch (error) {
    return { ok: false, reason: 'failed', waking: isWakingError(error) };
  }
  if (!loaded) return { ok: false, reason: 'not_found' };
  if (loaded.match.phase !== 'lobby') return { ok: false, reason: 'not_lobby' };

  const seatCount = seatCountOf(loaded.match);
  const mySeatRow = loaded.seats.find((seat) => seat.user_id === userId);
  const seats: MultiSeatView[] = [];
  for (let idx = 0; idx < seatCount; idx += 1) {
    const seat = loaded.seats.find((item) => item.seat_idx === idx);
    seats.push({
      seatIdx: idx,
      kind: seat ? (seat.kind as MultiSeatView['kind']) : 'empty',
      name: seat?.name ?? '—',
      ready: seat?.ready ?? false,
      submitted: false,
      mine: seat?.user_id === userId,
      awakened: false,
    });
  }

  const seated = seats.filter((seat) => seat.kind !== 'empty');
  return {
    ok: true,
    view: {
      code: loaded.match.code,
      phase: 'lobby',
      seats,
      seatCount,
      hostSeat: loaded.match.host_seat,
      mySeat: mySeatRow?.seat_idx ?? -1,
      allReady: seated.length > 0 && seated.every((seat) => seat.ready),
      turnSeconds: Number(loaded.match.config?.turnSeconds) || 0,
    },
  };
}

// --------------------------------------------------------------------- --
// Acciones del lobby                                                    --
// --------------------------------------------------------------------- //

export async function lobbyAction(
  code: string,
  userId: string,
  action: string,
  payload: { seat?: unknown; ready?: unknown },
): Promise<LobbyActionResult> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, reason: 'unconfigured' };

  let loaded: Awaited<ReturnType<typeof loadMultiRows>>;
  try {
    loaded = await loadMultiRows(admin, code.toUpperCase());
  } catch (error) {
    return {
      ok: false,
      reason: 'failed',
      detail: (error as Error).message,
      waking: isWakingError(error),
    };
  }
  if (!loaded) return { ok: false, reason: 'not_found' };
  const { match } = loaded;

  if (action === 'join') {
    if (match.phase !== 'lobby') return { ok: false, reason: 'not_lobby' };
    const { data, error } = await admin.rpc('join_lobby', {
      p_match: match.id,
      p_user: userId,
    });
    if (error) {
      return {
        ok: false,
        reason: 'failed',
        detail: error.message,
        waking: isWakingError(error),
      };
    }
    const seat = Number(data);
    if (seat < 0) {
      const reasons: Record<number, string> = {
        [-1]: 'full',
        [-2]: 'already_seated',
        [-3]: 'not_lobby',
        // §21.1: el jugador ya mantiene 3 mesas activas.
        [-4]: 'seat_limit',
      };
      return { ok: false, reason: reasons[seat] ?? 'failed' };
    }
    return { ok: true, status: 'seated', seat };
  }

  if (action === 'ready' || action === 'unready') {
    const { data, error } = await admin.rpc('set_ready', {
      p_match: match.id,
      p_user: userId,
      p_ready: action === 'ready',
    });
    if (error) return { ok: false, reason: 'failed', detail: error.message };
    if (data !== 'ok') return { ok: false, reason: String(data) };
    return { ok: true, status: action };
  }

  if (action === 'leave') {
    const { data, error } = await admin.rpc('leave_seat', {
      p_match: match.id,
      p_user: userId,
    });
    if (error) return { ok: false, reason: 'failed', detail: error.message };
    return { ok: true, status: String(data) };
  }

  if (action === 'kick') {
    const seat = Number(payload.seat);
    if (!Number.isInteger(seat)) return { ok: false, reason: 'bad_seat' };
    const { data, error } = await admin.rpc('kick_seat', {
      p_match: match.id,
      p_host: userId,
      p_seat: seat,
    });
    if (error) return { ok: false, reason: 'failed', detail: error.message };
    if (data !== 'ok') return { ok: false, reason: String(data) };
    return { ok: true, status: 'kicked' };
  }

  if (action === 'start') {
    if (match.phase !== 'lobby') return { ok: false, reason: 'not_lobby' };
    const hostSeat = loaded.match.host_seat;
    const hostRow = loaded.seats.find((seat) => seat.seat_idx === hostSeat);
    if (!hostRow || hostRow.user_id !== userId) return { ok: false, reason: 'not_host' };
    const seated = loaded.seats.filter((seat) => seat.kind === 'human');
    if (seated.length === 0) return { ok: false, reason: 'empty' };
    if (!seated.every((seat) => seat.ready)) return { ok: false, reason: 'not_all_ready' };

    const seatCount = seatCountOf(loaded.match);
    // §2 (D61): bots hasta la mesa de referencia (8); más allá, dioses dormidos.
    const fillDefs = fillSeatDefs(
      seatCount,
      seated.map((seat) => seat.seat_idx),
    );

    const state = buildMatchState(
      Number(match.seed),
      [
        ...seated.map((seat) => ({ seatIdx: seat.seat_idx, kind: 'human' as const, name: seat.name })),
        ...fillDefs,
      ],
      {
        seats: seatCount,
        turnLimit: Number(match.config?.turnLimit) || 24,
        turnSeconds: Number(match.config?.turnSeconds) || 0,
        unlockEvery: Number(match.unlock_every) || 5,
      },
    );

    const { events: _events, ...stateWithoutEvents } = state;
    const { error } = await admin.rpc('begin_orders', {
      p_match: match.id,
      p_state: { ...stateWithoutEvents, events: [] },
      p_turn_seconds: Number(match.config?.turnSeconds) || 0,
    });
    if (error) return { ok: false, reason: 'failed', detail: error.message };
    return { ok: true, status: 'started' };
  }

  return { ok: false, reason: 'unknown_action' };
}

// --------------------------------------------------------------------- --
// Vista del turno (polling de respaldo, ≥ 30 s: D55)                    --
// --------------------------------------------------------------------- //

export async function loadMultiTurnView(
  code: string,
  userId: string,
): Promise<
  | { ok: true; view: MultiTurnView }
  | {
      ok: false;
      reason: 'unconfigured' | 'not_found' | 'forbidden' | 'lobby' | 'failed';
      waking?: boolean;
    }
> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, reason: 'unconfigured' };

  let loaded: Awaited<ReturnType<typeof loadMultiRows>>;
  try {
    loaded = await loadMultiRows(admin, code.toUpperCase());
  } catch (error) {
    return { ok: false, reason: 'failed', waking: isWakingError(error) };
  }
  if (!loaded) return { ok: false, reason: 'not_found' };
  if (loaded.match.phase === 'lobby') return { ok: false, reason: 'lobby' };

  const mySeatRow = loaded.seats.find((seat) => seat.user_id === userId);
  if (!mySeatRow) return { ok: false, reason: 'forbidden' };

  const state = stateFromRows(loaded.rows);
  const turn = loaded.match.turn;

  const current = loaded;
  const [ordersResult, proposalResult, lastProposalResult] = await withRetry(() =>
    Promise.all([
      admin.from('orders').select('seat_idx').eq('match_id', current.match.id).eq('turn', turn),
      admin
        .from('turn_proposals')
        .select('id, proposer_seat, window_id')
        .eq('match_id', current.match.id)
        .eq('turn', turn)
        .eq('status', 'open')
        .maybeSingle(),
      admin
        .from('turn_proposals')
        .select('turn, status, result_window')
        .eq('match_id', current.match.id)
        .lt('turn', turn)
        .order('turn', { ascending: false })
        .limit(1),
    ]),
  );

  if (ordersResult.error || proposalResult.error || lastProposalResult.error) {
    return {
      ok: false,
      reason: 'failed',
      waking: isWakingError(ordersResult.error ?? proposalResult.error ?? lastProposalResult.error),
    };
  }

  const submittedSeats = new Set(
    ((ordersResult.data ?? []) as unknown as { seat_idx: number }[]).map((row) => row.seat_idx),
  );
  const proposal = (proposalResult.data ?? null) as
    | { id: string; proposer_seat: number; window_id: WindowId }
    | null;

  let myVote: WindowId | null = null;
  if (proposal) {
    const { data: vote } = await admin
      .from('turn_votes')
      .select('choice')
      .eq('proposal_id', proposal.id)
      .eq('seat_idx', mySeatRow.seat_idx)
      .maybeSingle();
    myVote = (vote as { choice: WindowId } | null)?.choice ?? null;
  }

  const seats: MultiSeatView[] = loaded.seats
    .filter((seat) => seat.seat_idx < seatCountOf(loaded.match))
    .map((seat) => ({
      seatIdx: seat.seat_idx,
      kind: seat.kind as MultiSeatView['kind'],
      name: seat.name,
      ready: seat.ready,
      // Quién ya envió es información de mesa: un booleano, nunca las órdenes.
      submitted: submittedSeats.has(seat.seat_idx),
      mine: seat.user_id === userId,
      awakened: seat.awakened === true,
    }));

  const lastProposal = (lastProposalResult.data ?? []) as unknown as {
    turn: number;
    status: string;
    result_window: WindowId | null;
  }[];
  const last = lastProposal[0]
    ? {
        turn: lastProposal[0].turn,
        status: lastProposal[0].status,
        resultWindow: lastProposal[0].result_window,
      }
    : null;

  const finished = loaded.match.status === 'finished' || loaded.match.status === 'closed';
  const endsAt = finished ? null : loaded.match.turn_ends_at;

  return {
    ok: true,
    view: {
      code: loaded.match.code,
      phase: finished ? 'finished' : 'orders',
      turn,
      windowId: state.windowId,
      turnEndsAt: endsAt ? new Date(endsAt).toISOString() : null,
      seats,
      mySeat: mySeatRow.seat_idx,
      mySubmitted: submittedSeats.has(mySeatRow.seat_idx),
      ballot: {
        open: Boolean(proposal),
        proposal: proposal?.window_id ?? null,
        proposerSeat: proposal?.proposer_seat ?? null,
        options: ballotChoices(state, proposal?.window_id ?? state.windowId),
        myVote,
        last,
        forced: state.windowOverride !== null,
      },
      finished,
      winnerSeat: loaded.match.winner_seat,
      turnLimit: Number(loaded.match.config?.turnLimit) || 24,
    },
  };
}

// --------------------------------------------------------------------- --
// Enviar órdenes y votar                                                --
// --------------------------------------------------------------------- //

export type SubmitResult =
  | { ok: true; status: 'stored' | 'applied' | 'replayed' | 'waiting'; turn: number; finished: boolean }
  | {
      ok: false;
      reason:
        | 'unconfigured'
        | 'not_found'
        | 'forbidden'
        | 'not_orders'
        | 'stale'
        | 'bot_seat'
        | 'failed';
      detail?: string;
      waking?: boolean;
    };

export async function submitMultiOrders(
  code: string,
  userId: string,
  planInput: unknown,
  problemInput: unknown,
  expectedTurn?: number,
): Promise<SubmitResult> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, reason: 'unconfigured' };

  let loaded: Awaited<ReturnType<typeof loadMultiRows>>;
  try {
    loaded = await loadMultiRows(admin, code.toUpperCase());
  } catch (error) {
    return {
      ok: false,
      reason: 'failed',
      detail: (error as Error).message,
      waking: isWakingError(error),
    };
  }
  if (!loaded) return { ok: false, reason: 'not_found' };
  if (loaded.match.phase === 'lobby') return { ok: false, reason: 'not_orders' };
  if (loaded.match.status === 'finished' || loaded.match.status === 'closed') {
    return { ok: false, reason: 'not_orders' };
  }

  const mySeatRow = loaded.seats.find((seat) => seat.user_id === userId);
  if (!mySeatRow) return { ok: false, reason: 'forbidden' };
  if (mySeatRow.kind !== 'human') return { ok: false, reason: 'bot_seat' };

  const turn = loaded.match.turn;
  if (Number.isInteger(expectedTurn) && expectedTurn !== turn) {
    return { ok: false, reason: 'stale' };
  }

  const plan = sanitizePlan(planInput);
  const problemOption = sanitizeProblemOption(problemInput);
  // Idempotente por asiento y turno (`on conflict do nothing`): se puede
  // reintentar sin duplicar (§21.3).
  const { data, error } = await withRetry(async () =>
    admin.rpc('submit_orders', {
      p_match: loaded.match.id,
      p_turn: turn,
      p_seat: mySeatRow.seat_idx,
      p_payload: problemOption ? { plan, problemOption } : { plan },
    }),
  );
  if (error) {
    return { ok: false, reason: 'failed', detail: error.message, waking: isWakingError(error) };
  }
  if (data !== 'stored' && data !== 'exists') {
    return { ok: false, reason: 'failed', detail: String(data) };
  }

  // ¿Ya están todos? Si es así, este mismo envío cierra el turno.
  const resolution = await tryResolveTurn(admin, loaded, userId);
  if (resolution.ok && (resolution.status === 'applied' || resolution.status === 'replayed')) {
    return {
      ok: true,
      status: resolution.status,
      turn: resolution.turn,
      finished: resolution.finished,
    };
  }

  return { ok: true, status: 'waiting', turn, finished: false };
}

export type VoteResult =
  | { ok: true; status: 'proposed' | 'voted' | 'changed'; proposal: WindowId }
  | {
      ok: false;
      reason:
        | 'unconfigured'
        | 'not_found'
        | 'forbidden'
        | 'bot_seat'
        | 'not_orders'
        | 'forced_window'
        | 'illegal_window'
        | 'same_window'
        | 'failed';
      detail?: string;
      waking?: boolean;
    };

export async function castMultiVote(
  code: string,
  userId: string,
  windowInput: unknown,
): Promise<VoteResult> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, reason: 'unconfigured' };

  let loaded: Awaited<ReturnType<typeof loadMultiRows>>;
  try {
    loaded = await loadMultiRows(admin, code.toUpperCase());
  } catch (error) {
    return {
      ok: false,
      reason: 'failed',
      detail: (error as Error).message,
      waking: isWakingError(error),
    };
  }
  if (!loaded) return { ok: false, reason: 'not_found' };
  if (loaded.match.phase !== 'orders') return { ok: false, reason: 'not_orders' };

  const mySeatRow = loaded.seats.find((seat) => seat.user_id === userId);
  if (!mySeatRow) return { ok: false, reason: 'forbidden' };
  if (mySeatRow.kind !== 'human') return { ok: false, reason: 'bot_seat' };

  const windowId = String(windowInput ?? '');
  const state = stateFromRows(loaded.rows);

  // A.11: durante un choque la ventana está forzada y no se vota nada.
  if (state.windowOverride !== null) return { ok: false, reason: 'forced_window' };
  // A.12: el ritmo pactado no se vota.
  if (state.windowPolicy === 'fixed') return { ok: false, reason: 'forced_window' };
  if (!(ballotOptions(state) as string[]).includes(windowId)) {
    return { ok: false, reason: 'illegal_window' };
  }
  const choice = windowId as WindowId;

  const { data: existing, error: existingError } = await admin
    .from('turn_proposals')
    .select('id, window_id')
    .eq('match_id', loaded.match.id)
    .eq('turn', loaded.match.turn)
    .eq('status', 'open')
    .maybeSingle();
  if (existingError) return { ok: false, reason: 'failed', detail: existingError.message };

  let proposalId = (existing as { id: string; window_id: WindowId } | null)?.id ?? null;
  let status: 'proposed' | 'voted' | 'changed' = 'voted';

  if (!proposalId) {
    // A.2.1: proponer la ventana actual no abre papeleta (no hay nada que decidir).
    if (choice === state.windowId) return { ok: false, reason: 'same_window' };
    const { data: id, error } = await admin.rpc('open_ballot', {
      p_match: loaded.match.id,
      p_turn: loaded.match.turn,
      p_seat: mySeatRow.seat_idx,
      p_window: choice,
    });
    if (error) return { ok: false, reason: 'failed', detail: error.message };
    proposalId = id as string | null;
    if (!proposalId) return { ok: false, reason: 'failed', detail: 'open_ballot' };
    status = 'proposed';
  }

  const { data: before, error: beforeError } = await admin
    .from('turn_votes')
    .select('choice')
    .eq('proposal_id', proposalId)
    .eq('seat_idx', mySeatRow.seat_idx)
    .maybeSingle();
  if (beforeError) return { ok: false, reason: 'failed', detail: beforeError.message };
  const previous = (before as { choice: WindowId } | null)?.choice ?? null;

  const { error: voteError } = await admin.rpc('cast_vote', {
    p_match: loaded.match.id,
    p_proposal: proposalId,
    p_seat: mySeatRow.seat_idx,
    p_choice: choice,
  });
  if (voteError) return { ok: false, reason: 'failed', detail: voteError.message };

  if (status === 'proposed') return { ok: true, status, proposal: choice };
  return { ok: true, status: previous ? 'changed' : 'voted', proposal: choice };
}

// --------------------------------------------------------------------- --
// Resolución del turno multijugador                                    --
// --------------------------------------------------------------------- //

export type MultiResolveResult =
  | { ok: true; status: 'applied' | 'replayed' | 'waiting'; turn: number; finished: boolean }
  | {
      ok: false;
      reason:
        | 'unconfigured'
        | 'not_found'
        | 'forbidden'
        | 'not_orders'
        | 'finished'
        | 'busy'
        | 'failed';
      detail?: string;
      waking?: boolean;
    };

/**
 * Cierra el turno si la mesa está lista: todos los humanos enviaron o el
 * temporizador venció (§5). Idempotente y con claim atómico: dos clics (o dos
 * pestañas) no resuelven dos veces.
 */
export async function resolveMultiMatchTurn(code: string, userId: string): Promise<MultiResolveResult> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, reason: 'unconfigured' };

  let loaded: Awaited<ReturnType<typeof loadMultiRows>>;
  try {
    loaded = await loadMultiRows(admin, code.toUpperCase());
  } catch (error) {
    return {
      ok: false,
      reason: 'failed',
      detail: (error as Error).message,
      waking: isWakingError(error),
    };
  }
  if (!loaded) return { ok: false, reason: 'not_found' };
  if (loaded.match.phase === 'lobby') return { ok: false, reason: 'not_orders' };
  if (loaded.match.status === 'finished' || loaded.match.status === 'closed') {
    return { ok: false, reason: 'finished' };
  }
  const mySeatRow = loaded.seats.find((seat) => seat.user_id === userId);
  if (!mySeatRow) return { ok: false, reason: 'forbidden' };

  const result = await tryResolveTurn(admin, loaded, userId);
  if (result.ok) {
    return {
      ok: true,
      status: result.status,
      turn: result.turn,
      finished: result.finished,
    };
  }
  return result;
}

type TryResolveOutcome =
  | { ok: true; status: 'applied' | 'replayed' | 'waiting'; turn: number; finished: boolean }
  | { ok: false; reason: 'busy' | 'not_orders' | 'failed'; detail?: string; waking?: boolean };

async function tryResolveTurn(
  admin: SupabaseClient,
  loaded: { match: MatchRowWithExtras; rows: LoadedRows; seats: SeatRowFull[] },
  _userId: string,
): Promise<TryResolveOutcome> {
  const { match } = loaded;
  const turn = match.turn;
  const humans = loaded.seats.filter((seat) => seat.kind === 'human');

  const { data: ordersData, error: ordersError } = await withRetry(async () =>
    admin
      .from('orders')
      .select('seat_idx, payload')
      .eq('match_id', match.id)
      .eq('turn', turn),
  );
  if (ordersError) {
    return { ok: false, reason: 'failed', detail: ordersError.message, waking: isWakingError(ordersError) };
  }

  const submittedSeats = new Set(
    ((ordersData ?? []) as unknown as { seat_idx: number }[]).map((row) => row.seat_idx),
  );
  const allSubmitted = humans.every((seat) => submittedSeats.has(seat.seat_idx));

  const deadline = match.turn_ends_at ? new Date(match.turn_ends_at).getTime() : null;
  const expired = deadline !== null && deadline <= Date.now();
  // §5: un jugador ausente nunca bloquea la partida.
  if (!allSubmitted && !expired) return { ok: true, status: 'waiting', turn, finished: false };

  const { data: claimed, error: claimError } = await admin.rpc('claim_turn', {
    p_match: match.id,
    p_turn: turn,
  });
  if (claimError) return { ok: false, reason: 'failed', detail: claimError.message };
  if (claimed !== true) return { ok: false, reason: 'busy' };

  try {
    const state = stateFromRows(loaded.rows);
    const turnLimit = Number(match.config?.turnLimit) || 24;

    const submitted: SubmittedOrders[] = (
      (ordersData ?? []) as unknown as { seat_idx: number; payload: Record<string, unknown> }[]
    ).map((row) => ({
      seatId: row.seat_idx,
      plan: sanitizePlan(row.payload.plan),
      problemOption: sanitizeProblemOption(row.payload.problemOption),
    }));

    // Papeleta abierta del turno, si la hay: sus votos deciden la ventana.
    const { data: proposal } = await admin
      .from('turn_proposals')
      .select('id, window_id')
      .eq('match_id', match.id)
      .eq('turn', turn)
      .eq('status', 'open')
      .maybeSingle();
    let ballot: BallotInput | null = null;
    const proposalRow = (proposal ?? null) as { id: string; window_id: WindowId } | null;
    if (proposalRow) {
      const { data: votes } = await admin
        .from('turn_votes')
        .select('seat_idx, choice')
        .eq('proposal_id', proposalRow.id);
      ballot = {
        proposal: proposalRow.window_id,
        votes: ((votes ?? []) as unknown as { seat_idx: number; choice: WindowId }[]).map((row) => ({
          seatId: row.seat_idx,
          choice: row.choice,
        })),
      };
    }

    const outcome: BallotOutcome | null = ballot ? countBallot(state, ballot) : null;
    const result = resolveMultiTurn(state, submitted, ballot, turnLimit);

    const { events: _events, ...stateWithoutEvents } = result.state;
    // `apply_turn` va PRIMERO y es idempotente (replay): se reintenta si la base
    // despertaba a mitad de la escritura (§21.3). Si `close_ballot` corriera
    // antes y `apply_turn` fallara, el reintento ya no encontraría la propuesta
    // abierta y los votos de la mesa se perderían (hallazgo de auditoría).
    const { data: applied, error: applyError } = await withRetry(async () =>
      admin.rpc('apply_turn', {
        p_match: match.id,
        p_turn: turn,
        p_payload: {
          digest: digestState(result.state),
          state: { ...stateWithoutEvents, events: [] },
          events: result.events,
          chronicle: {
            public: result.chronicle.publicText,
            private: result.chronicle.privateBySeat,
          },
        },
      }),
    );
    if (applyError) throw new Error(applyError.message);

    // La papeleta se cierra DESPUÉS de aplicar: los votos ya cuentan y se
    // publican con la crónica de este turno. Si el cierre fallara del todo, lo
    // único que queda es una propuesta «open» cosmetica de un turno ya pasado
    // (nadie la vota: `cast_vote` exige que sea del turno en curso).
    if (ballot) {
      const { error: closeError } = await withRetry(async () =>
        admin.rpc('close_ballot', {
          p_match: match.id,
          p_turn: turn,
          p_status: outcome?.status ?? 'quorum_failed',
          p_result: outcome?.winner ?? null,
        }),
      );
      if (closeError) {
        logError('ballot_close_failed', closeError.message, {
          code: match.code,
          turn,
          status: outcome?.status ?? 'quorum_failed',
        });
      }
    }

    return {
      ok: true,
      status: applied === 'replayed' ? 'replayed' : 'applied',
      turn: result.state.turn,
      finished: result.closed || result.state.finished,
    };
  } catch (error) {
    await admin.rpc('release_turn', { p_match: match.id });
    return {
      ok: false,
      reason: 'failed',
      detail: (error as Error).message,
      waking: isWakingError(error),
    };
  }
}
