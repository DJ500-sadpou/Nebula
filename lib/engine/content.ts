import { capFe } from './economy';
import {
  Buff,
  Channel,
  ERAS_BY_ID,
  MatchState,
  Seat,
  WindowId,
  WINDOW_LADDER,
} from './types';

/* ------------------------------------------------------------------ */
/* Buffs                                                               */
/* ------------------------------------------------------------------ */

export function hasBuff(seat: Seat, type: string): boolean {
  return seat.buffs.some((b) => b.type === type);
}

/** §10-A: máximo dos buffs activos; del mismo tipo se refresca, y el tercero
 *  desaloja al más antiguo. */
export const MAX_BUFFS = 2;

export function addBuff(seat: Seat, type: string, turn: number, turns = 2): void {
  const untilTurn = turn + turns;
  const existing = seat.buffs.find((b) => b.type === type);
  if (existing) {
    existing.untilTurn = Math.max(existing.untilTurn, untilTurn);
    return;
  }
  seat.buffs.push({ type, untilTurn });
  while (seat.buffs.length > MAX_BUFFS) {
    let oldest = 0;
    for (let i = 1; i < seat.buffs.length; i += 1) {
      const a = seat.buffs[i];
      const b = seat.buffs[oldest];
      if (a && b && a.untilTurn < b.untilTurn) oldest = i;
    }
    seat.buffs.splice(oldest, 1);
  }
}

export function expireBuffs(seat: Seat, turn: number): void {
  seat.buffs = seat.buffs.filter((b) => b.untilTurn >= turn);
}

export function activeBuffCount(seat: Seat): number {
  return seat.buffs.length;
}

/* ------------------------------------------------------------------ */
/* Tecnología y cultura                                                */
/* ------------------------------------------------------------------ */

export function nextTechId(seat: Seat, era: MatchState['era']): string | null {
  const def = ERAS_BY_ID[era];
  for (const tech of def.techs) if (!seat.techs.includes(tech.id)) return tech.id;
  return null;
}

export function nextCultureId(seat: Seat, era: MatchState['era']): string | null {
  const def = ERAS_BY_ID[era];
  for (const item of def.culture) if (!seat.culture.includes(item)) return item;
  return null;
}

/* ------------------------------------------------------------------ */
/* Acciones                                                            */
/* ------------------------------------------------------------------ */

export interface ActionDef {
  id: string;
  name: string;
  channel: Channel;
  beats: number;
  minWindow: WindowId;
  cost: (seat: Seat, state: MatchState) => number;
  available?: (seat: Seat, state: MatchState) => boolean;
  effect: (seat: Seat, state: MatchState, rand: () => number) => void;
}

const windowIndex = (w: WindowId): number => WINDOW_LADDER.indexOf(w);

export function isWindowAllowed(minWindow: WindowId, current: WindowId): boolean {
  return windowIndex(current) >= windowIndex(minWindow);
}

/* ------------------------------------------------------------------ */
/* Misiones de recuperación (§5-B.5)                                   */
/* ------------------------------------------------------------------ */

/** §5-B.5: las misiones caducan a los 5 turnos; si caduca, el debuff sube −5 %. */
export const MISSION_TURNS = 5;

function gainTech(seat: Seat, state: MatchState, amount: number): void {
  for (let i = 0; i < amount; i += 1) {
    const tech = nextTechId(seat, state.era);
    if (!tech) return;
    seat.techs.push(tech);
  }
}

function gainCulture(seat: Seat, state: MatchState, amount: number): void {
  for (let i = 0; i < amount; i += 1) {
    const item = nextCultureId(seat, state.era);
    if (!item) return;
    seat.culture.push(item);
  }
}

function rivalAhead(seat: Seat, state: MatchState): boolean {
  return state.seats.some((s) => s.id !== seat.id && s.techs.length > seat.techs.length);
}

const MISSIONS: Record<string, ActionDef> = {
  emisarios: {
    id: 'emisarios',
    name: 'Emisarios al extranjero',
    channel: 'palabra',
    beats: 2,
    minWindow: '1d',
    cost: () => 40,
    available: (seat) => seat.debuffPrimitive,
    effect: (seat, state) => gainTech(seat, state, 1),
  },
  copiar_oficio: {
    id: 'copiar_oficio',
    name: 'Copiar el oficio',
    channel: 'palabra',
    beats: 3,
    minWindow: '1d',
    cost: () => 60,
    available: (seat, state) => seat.debuffPrimitive && rivalAhead(seat, state),
    effect: (seat, state) => {
      gainTech(seat, state, 1);
      seat.fidelity = Math.max(0.1, seat.fidelity - 0.05);
    },
  },
  contratar_sabios: {
    id: 'contratar_sabios',
    name: 'Contratar sabios',
    channel: 'palabra',
    beats: 4,
    minWindow: '1d',
    cost: () => 100,
    available: (seat) => seat.debuffPrimitive,
    effect: (seat, state) => {
      gainTech(seat, state, 2);
      seat.fidelity = Math.max(0.1, seat.fidelity - 0.1);
    },
  },
  reforma_educativa: {
    id: 'reforma_educativa',
    name: 'Reforma educativa',
    channel: 'palabra',
    beats: 6,
    minWindow: '1y',
    cost: () => 150,
    available: (seat) => seat.debuffPrimitive,
    effect: (seat, state) => {
      gainTech(seat, state, 3);
      seat.xp += 5;
    },
  },
  tierra_prometida: {
    id: 'tierra_prometida',
    name: 'Tierra prometida',
    channel: 'heroe',
    beats: 3,
    minWindow: '1d',
    cost: () => 60,
    available: (seat) => seat.debuffPrimitive && seat.regions >= 1,
    effect: (seat) => {
      seat.believers = Math.round(seat.believers * 1.3);
      seat.xp += 3;
    },
  },
  anio_cosechas: {
    id: 'anio_cosechas',
    name: 'Año de cosechas',
    channel: 'heroe',
    beats: 4,
    minWindow: '6m',
    cost: () => 80,
    available: (seat) => seat.debuffPrimitive,
    effect: (seat) => {
      seat.believers = Math.round(seat.believers * 1.2);
      seat.fidelity = Math.min(1.5, seat.fidelity + 0.1);
      seat.xp += 3;
    },
  },
  mecenazgo: {
    id: 'mecenazgo',
    name: 'Mecenazgo',
    channel: 'obra',
    beats: 3,
    minWindow: '1d',
    cost: () => 50,
    available: (seat) => seat.debuffPrimitive,
    effect: (seat, state) => {
      gainCulture(seat, state, 2);
      seat.xp += 3;
    },
  },
  reforma_religiosa: {
    id: 'reforma_religiosa',
    name: 'Reforma religiosa',
    channel: 'obra',
    beats: 5,
    minWindow: '1y',
    cost: () => 120,
    available: (seat) => seat.debuffPrimitive,
    effect: (seat, state) => {
      gainCulture(seat, state, 3);
      seat.fidelity = Math.min(1.5, seat.fidelity + 0.15);
      seat.xp += 5;
    },
  },
};

export const ACTIONS: Record<string, ActionDef> = {
  milagro: {
    id: 'milagro',
    name: 'Milagro menor',
    channel: 'milagro',
    beats: 1,
    minWindow: '1d',
    cost: () => 10,
    effect: (seat) => {
      seat.fidelity = Math.min(1.5, seat.fidelity + 0.03);
      seat.fame += 2;
      seat.xp += 1;
    },
  },
  silencio: {
    id: 'silencio',
    name: 'Silencio',
    channel: 'palabra',
    beats: 1,
    minWindow: '1d',
    cost: () => 0,
    effect: (seat) => {
      seat.fe += 5;
      seat.fidelity = Math.min(1.5, seat.fidelity + 0.02);
    },
  },
  templo: {
    id: 'templo',
    name: 'Templo',
    channel: 'obra',
    beats: 2,
    minWindow: '30d',
    cost: () => 60,
    effect: (seat) => {
      seat.temples += 1;
      seat.fame += 5;
      seat.xp += 2;
    },
  },
  bendicion: {
    id: 'bendicion',
    name: 'Bendición',
    channel: 'obra',
    beats: 2,
    minWindow: '7d',
    cost: () => 50,
    effect: (seat) => {
      seat.fidelity = Math.min(1.5, seat.fidelity + 0.06);
      seat.xp += 2;
    },
  },
  investigar: {
    id: 'investigar',
    name: 'Investigar',
    channel: 'palabra',
    beats: 1,
    minWindow: '1d',
    cost: (seat) => 11 + 4 * seat.techs.length,
    available: (seat, state) => nextTechId(seat, state.era) !== null,
    effect: (seat, state) => {
      const tech = nextTechId(seat, state.era);
      if (tech) seat.techs.push(tech);
      seat.xp += 3;
    },
  },
  hito_cultural: {
    id: 'hito_cultural',
    name: 'Hito cultural',
    channel: 'obra',
    beats: 2,
    minWindow: '7d',
    cost: () => 25,
    available: (seat, state) => nextCultureId(seat, state.era) !== null,
    effect: (seat, state) => {
      const item = nextCultureId(seat, state.era);
      if (item) seat.culture.push(item);
      seat.fidelity = Math.min(1.5, seat.fidelity + 0.02);
      seat.xp += 3;
    },
  },
  expandir: {
    id: 'expandir',
    name: 'Expansión',
    channel: 'heroe',
    beats: 3,
    minWindow: '30d',
    cost: () => 60,
    effect: (seat) => {
      seat.regions += 1;
      seat.believers = Math.round(seat.believers * 1.12);
      seat.xp += 3;
    },
  },
  profecia: {
    id: 'profecia',
    name: 'Profecía',
    channel: 'palabra',
    beats: 1,
    minWindow: '1d',
    cost: (seat) => Math.floor(capFe(seat) * 0.1),
    effect: (seat, _state, rand) => {
      if (rand() < 0.6) {
        seat.fe += Math.floor(capFe(seat) * 0.1);
        seat.xp += 25;
        seat.fame += 3;
      } else {
        seat.xp = Math.max(0, seat.xp - 30);
      }
    },
  },
  creacion: {
    id: 'creacion',
    name: 'Creación',
    channel: 'heroe',
    beats: 2,
    minWindow: '7d',
    cost: () => 40,
    effect: (seat) => {
      seat.fame += 6;
      seat.fidelity = Math.min(1.5, seat.fidelity + 0.03);
      seat.essence += 1;
      seat.xp += 4;
    },
  },
  ...MISSIONS,
};


export const MISSION_IDS = new Set(Object.keys(MISSIONS));

/* ------------------------------------------------------------------ */
/* Hitos globales                                                      */
/* ------------------------------------------------------------------ */

export type BuffType =
  | 'botin'
  | 'fidelidad+'
  | 'militar+'
  | 'investigacion+'
  | 'cultura+'
  | 'compas+'
  | 'esencia+'
  | 'diplomacia+';

export interface MilestoneDef {
  key: string;
  name: string;
  reward: { buff: BuffType; pct?: number };
  check: (seat: Seat, state: MatchState) => boolean;
}

export const MILESTONES: MilestoneDef[] = [
  { key: 'pop_1000', name: 'Pueblo numeroso', reward: { buff: 'botin', pct: 5 }, check: (s) => s.believers >= 1000 },
  { key: 'pop_10000', name: 'Nación', reward: { buff: 'botin', pct: 7.5 }, check: (s) => s.believers >= 10000 },
  { key: 'pop_100000', name: 'Mundo lleno', reward: { buff: 'compas+' }, check: (s) => s.believers >= 100000 },
  { key: 'temple_1', name: 'Casa del dios', reward: { buff: 'botin', pct: 5 }, check: (s) => s.temples >= 1 },
  { key: 'tech_1', name: 'Chispa', reward: { buff: 'investigacion+' }, check: (s) => s.techs.length >= 1 },
  { key: 'culture_1', name: 'Mito fundacional', reward: { buff: 'cultura+' }, check: (s) => s.culture.length >= 1 },
  { key: 'creation_1', name: 'Engendro', reward: { buff: 'esencia+' }, check: (s) => s.essence >= 1 },
  { key: 'city_1', name: 'Ciudad', reward: { buff: 'botin', pct: 10 }, check: (s) => s.regions >= 3 },
  { key: 'div_5', name: 'Ascenso', reward: { buff: 'botin', pct: 7.5 }, check: (s) => s.divinity >= 5 },
  { key: 'prophecy_1', name: 'Profeta', reward: { buff: 'botin', pct: 5 }, check: (s) => s.fame >= 20 },
  { key: 'recovered', name: 'Renacido', reward: { buff: 'botin', pct: 7.5 }, check: (s) => s.debuffTurns === 0 && s.divinity >= 3 && s.techs.length >= 3 },
  { key: 'fidelity_08', name: 'Pueblo devoto', reward: { buff: 'cultura+' }, check: (s) => s.fidelity >= 0.8 },
  // Hitos de mesa: se otorgan desde la resolución, no por comprobación periódica.
  { key: 'war_1', name: 'Primera sangre', reward: { buff: 'militar+' }, check: () => false },
  { key: 'vassal_1', name: 'Señor de dioses', reward: { buff: 'botin', pct: 12.5 }, check: () => false },
];

export function awardMilestone(state: MatchState, seat: Seat, key: string): boolean {
  if (state.milestones[key] !== undefined) return false;
  const def = MILESTONES.find((m) => m.key === key);
  if (!def) return false;
  state.milestones[key] = seat.id;
  if (def.reward.buff === 'botin') {
    const pct = def.reward.pct ?? 5;
    seat.fe += Math.floor((capFe(seat) * pct) / 100);
  } else {
    addBuff(seat, def.reward.buff, state.turn);
  }
  state.events.push({
    turn: state.turn,
    visibility: 'public',
    seatId: seat.id,
    kind: 'milestone',
    text: `${seat.name} ha ganado el hito «${def.name}».`,
  });
  return true;
}

/* ------------------------------------------------------------------ */
/* Eventos del mundo (d20)                                             */
/* ------------------------------------------------------------------ */

export function applyWorldEvent(state: MatchState, seat: Seat, roll: number): string {
  switch (roll) {
    case 4:
      seat.fidelity = Math.max(0.1, seat.fidelity - 0.1);
      return `${seat.name} sufre una sequía.`;
    case 5:
      seat.essence += 1;
      return `Una abominación cae cerca de ${seat.name}.`;
    case 6:
      seat.xp += 20;
      return `${seat.name} descubre una ruina antigua.`;
    case 7:
      seat.xp += 10;
      return `${seat.name} contacta con un pueblo desconocido.`;
    case 8:
      seat.fidelity = Math.max(0.1, seat.fidelity - 0.12);
      return `Motín interno en ${seat.name}.`;
    case 9:
      seat.xp += 15;
      return `Avance espontáneo en ${seat.name}.`;
    case 10:
      seat.believers = Math.max(1, Math.round(seat.believers * 0.95));
      return `Un profeta rival roba fieles a ${seat.name}.`;
    case 11:
      if (seat.fidelity > 0.6) {
        seat.believers = Math.round(seat.believers * 1.06);
        return `Migración hacia ${seat.name}.`;
      }
      return 'El mundo respira.';
    case 12:
      seat.fame = Math.max(0, seat.fame - 5);
      return `Un héroe de ${seat.name} traiciona.`;
    case 14:
      seat.fidelity = Math.max(0.1, seat.fidelity - 0.05);
      seat.xp += 10;
      return `${seat.name} abre una ruina demoníaca.`;
    case 17:
      seat.believers = Math.max(1, Math.round(seat.believers * 0.92));
      return `Hambruna en ${seat.name}.`;
    case 18:
      seat.relics += 1;
      return `${seat.name} halla una reliquia.`;
    case 19:
      seat.believers = Math.max(1, Math.round(seat.believers * 0.96));
      return `Un dios maligno ataca a ${seat.name}.`;
    default:
      return 'El mundo respira.';
  }
}

export function buffLabel(buff: Buff): string {
  return `${buff.type} (${buff.untilTurn})`;
}
