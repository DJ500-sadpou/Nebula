import {
  Buff,
  MatchState,
  Seat,
  SeatKind,
  WindowId,
  WindowPolicy,
  WarState,
} from '../engine/types';

/**
 * Mapeo entre el estado del motor y las filas de Postgres (PLAN.md §4).
 *
 * Es el único sitio donde se traduce: el motor no sabe que existe una base de
 * datos y las rutas no construyen `MatchState` a mano. Si un campo del motor no
 * tiene columna, la partida deja de reproducirse: por eso `tests/db/map.test.ts`
 * exige que el viaje de ida y vuelta conserve la huella exacta.
 */

export interface MatchRow {
  id: string;
  code: string;
  status: string;
  phase: string;
  seed: number | string;
  turn: number;
  config: MatchConfigRow;
  window_id: string;
  windows_unlocked: string[];
  unlock_every: number;
  fiction_day: number;
  horizon_years: number;
  era: string;
  era_progress: number | string;
  era_advanced_turn: number | null;
  last_bar_rise_turn: number;
  table_voters: number;
  war: WarState | null;
  window_before_war: string | null;
  peace_until_turn: number;
  window_override: { windowId: WindowId; untilDay: number } | null;
  winner_seat: number | null;
  resolving: boolean;
}

export interface MatchConfigRow {
  mode?: string;
  turnLimit?: number;
  windowPolicy?: WindowPolicy;
  fixedWindow?: WindowId | null;
}

export interface SeatRow {
  seat_idx: number;
  kind: string;
  name: string;
  area_card: string | null;
  domain_card: string | null;
}

export interface SeatStateRow {
  seat_idx: number;
  fe: number;
  xp: number;
  divinity: number;
  fidelity: number | string;
  fame: number;
  magic: number;
  essence: number;
  relics: number;
  believers: number;
  techs: string[];
  culture: string[];
  debuff_primitive: boolean;
  debuff_from_culture: boolean;
  debuff_turns: number;
  debuff_level: number;
  debuff_mission_turn: number | null;
  created_at_turn: number;
  buffs: Buff[];
}

export interface SeatPublicRow {
  seat_idx: number;
  regions: number;
  temples: number;
  vassal_of: number | null;
}

export interface LoadedRows {
  match: MatchRow;
  seats: SeatRow[];
  states: SeatStateRow[];
  publics: SeatPublicRow[];
  milestones: Record<string, number>;
}

const KIND_FROM_DB: Record<string, SeatKind> = {
  human: 'human',
  bot: 'bot',
  dormant: 'dormant',
  empty: 'dormant',
};

/** Estado del motor a partir de las filas. Los eventos no vienen de aquí: la
 *  crónica y los eventos ya resueltos son un registro aparte. */
export function stateFromRows(rows: LoadedRows): MatchState {
  const { match } = rows;
  const seats: Seat[] = rows.seats.map((seat) => {
    const state = rows.states.find((item) => item.seat_idx === seat.seat_idx);
    const publicRow = rows.publics.find((item) => item.seat_idx === seat.seat_idx);
    if (!state || !publicRow) {
      throw new Error(`Asiento ${seat.seat_idx} sin seat_state o seat_public`);
    }
    return {
      id: seat.seat_idx,
      name: seat.name,
      kind: KIND_FROM_DB[seat.kind] ?? 'bot',
      areaCard: seat.area_card ?? 'Insectos',
      domainCard: seat.domain_card ?? 'Guerra',
      believers: state.believers,
      fidelity: Number(state.fidelity),
      fame: state.fame,
      fe: state.fe,
      xp: state.xp,
      divinity: state.divinity,
      temples: publicRow.temples,
      regions: publicRow.regions,
      essence: state.essence,
      relics: state.relics,
      magic: state.magic,
      techs: state.techs,
      culture: state.culture,
      buffs: state.buffs,
      debuffPrimitive: state.debuff_primitive,
      debuffTurns: state.debuff_turns,
      debuffFromCulture: state.debuff_from_culture,
      debuffLevel: state.debuff_level,
      debuffMissionTurn: state.debuff_mission_turn,
      vassalOf: publicRow.vassal_of,
      createdAtTurn: state.created_at_turn,
    };
  });

  const config = match.config ?? {};

  return {
    seed: Number(match.seed),
    turn: match.turn,
    windowId: match.window_id as WindowId,
    windowPolicy: config.windowPolicy ?? 'table',
    fixedWindow: config.fixedWindow ?? null,
    windowsUnlocked: match.windows_unlocked as WindowId[],
    unlockEvery: match.unlock_every,
    fictionDay: match.fiction_day,
    era: match.era as MatchState['era'],
    eraBar: Number(match.era_progress),
    eraAdvancedTurn: match.era_advanced_turn,
    lastBarRiseTurn: match.last_bar_rise_turn,
    tableVoters: match.table_voters,
    war: match.war,
    windowBeforeWar: match.window_before_war as WindowId | null,
    peaceUntilTurn: match.peace_until_turn,
    horizonYears: match.horizon_years,
    seats,
    milestones: rows.milestones,
    events: [],
    finished: match.status === 'finished' || match.status === 'closed',
    winnerSeat: match.winner_seat,
    pendingIncome: [],
    windowOverride: match.window_override,
  };
}

export interface StateRows {
  match: Partial<MatchRow> & { config: MatchConfigRow };
  seats: SeatRow[];
  states: SeatStateRow[];
  publics: SeatPublicRow[];
}

/** Filas a partir del estado. `config` conserva lo que no tiene columna propia:
 *  modo, tope de turnos y política de ventana. */
export function rowsFromState(state: MatchState, config: MatchConfigRow): StateRows {
  return {
    match: {
      seed: state.seed,
      turn: state.turn,
      config: {
        ...config,
        windowPolicy: state.windowPolicy,
        fixedWindow: state.fixedWindow,
      },
      window_id: state.windowId,
      windows_unlocked: state.windowsUnlocked,
      unlock_every: state.unlockEvery,
      fiction_day: state.fictionDay,
      horizon_years: state.horizonYears,
      era: state.era,
      era_progress: state.eraBar,
      era_advanced_turn: state.eraAdvancedTurn,
      last_bar_rise_turn: state.lastBarRiseTurn,
      table_voters: state.tableVoters,
      war: state.war,
      window_before_war: state.windowBeforeWar,
      peace_until_turn: state.peaceUntilTurn,
      window_override: state.windowOverride,
      winner_seat: state.winnerSeat,
      status: state.finished ? 'finished' : 'orders',
      phase: state.finished ? 'finished' : 'orders',
      resolving: false,
    },
    seats: state.seats.map((seat) => ({
      seat_idx: seat.id,
      kind: seat.kind,
      name: seat.name,
      area_card: seat.areaCard,
      domain_card: seat.domainCard,
    })),
    states: state.seats.map((seat) => ({
      seat_idx: seat.id,
      fe: seat.fe,
      xp: seat.xp,
      divinity: seat.divinity,
      fidelity: seat.fidelity,
      fame: seat.fame,
      magic: seat.magic,
      essence: seat.essence,
      relics: seat.relics,
      believers: seat.believers,
      techs: seat.techs,
      culture: seat.culture,
      debuff_primitive: seat.debuffPrimitive,
      debuff_from_culture: seat.debuffFromCulture,
      debuff_turns: seat.debuffTurns,
      debuff_level: seat.debuffLevel,
      debuff_mission_turn: seat.debuffMissionTurn,
      created_at_turn: seat.createdAtTurn,
      buffs: seat.buffs,
    })),
    publics: state.seats.map((seat) => ({
      seat_idx: seat.id,
      regions: seat.regions,
      temples: seat.temples,
      vassal_of: seat.vassalOf,
    })),
  };
}

/** Banda pública de Divinidad (§16): el nivel exacto nunca se publica. */
export function divinityBand(divinity: number): string {
  if (divinity <= 3) return 'baja';
  if (divinity <= 7) return 'media';
  return 'alta';
}
