/**
 * Tipos del motor. Nada de IO, nada de reloj, nada de azar global.
 * El tiempo de ficción es un contador de días; "ahora" no existe aquí.
 */

export type WindowId = '1d' | '7d' | '30d' | '3m' | '6m' | '1y' | '3y';
/** `table` = decide la votación de §5-A.2; `fixed` = ritmo ya fijado (simulación). */
export type WindowPolicy = 'table' | 'fixed';
export type Era = 'tribal' | 'reinos' | 'modernidad';
export type Channel = 'milagro' | 'obra' | 'heroe' | 'palabra';
export type Register = 'escena' | 'crisis' | 'era';
export type Visibility = 'public' | 'seat';

export interface WindowDef {
  id: WindowId;
  days: number;
  label: string;
  register: Register;
}

export const WINDOWS: Record<WindowId, WindowDef> = {
  '1d': { id: '1d', days: 1, label: '1 día', register: 'escena' },
  '7d': { id: '7d', days: 7, label: '7 días', register: 'escena' },
  '30d': { id: '30d', days: 30, label: '30 días', register: 'crisis' },
  '3m': { id: '3m', days: 91, label: '3 meses', register: 'crisis' },
  '6m': { id: '6m', days: 182, label: '6 meses', register: 'crisis' },
  '1y': { id: '1y', days: 365, label: '1 año', register: 'era' },
  '3y': { id: '3y', days: 1095, label: '3 años', register: 'era' },
};

export const WINDOW_LADDER: WindowId[] = ['1d', '7d', '30d', '3m', '6m', '1y', '3y'];
export const BEATS_PER_TURN = 8;

export interface TechDef {
  id: string;
  name: string;
}

export interface EraDef {
  id: Era;
  name: string;
  /** Nombres de las cuatro subetapas (25 %, 50 %, 75 %, 100 %). */
  sub: [string, string, string, string];
  techs: TechDef[];
  culture: string[];
}

export const ERAS: EraDef[] = [
  {
    id: 'tribal',
    name: 'Era tribal',
    sub: ['Tribu Antigua', 'Tribu', 'Tribu Avanzada', 'Tribu Tardía'],
    techs: [
      { id: 'fuego', name: 'Fuego' },
      { id: 'lanza', name: 'Lanza de piedra' },
      { id: 'arco', name: 'Arco' },
      { id: 'cesteria', name: 'Cestería' },
      { id: 'curtido', name: 'Curtido' },
      { id: 'ceramica', name: 'Cerámica' },
      { id: 'agricultura', name: 'Agricultura' },
      { id: 'domesticacion', name: 'Domesticación' },
      { id: 'pesca', name: 'Red de pesca' },
      { id: 'tejido', name: 'Tejido' },
      { id: 'enterramiento', name: 'Enterramiento' },
      { id: 'pintura', name: 'Pintura rupestre' },
    ],
    culture: [
      'mito_origen', 'rito_funerario', 'totem', 'canto', 'danza', 'pacto_sangre',
      'altar', 'calendario_lunar', 'tabu', 'leyenda_heroe', 'ofrenda', 'memoria_muertos',
    ],
  },
  {
    id: 'reinos',
    name: 'Grandes reinos',
    sub: ['Reinos Nacientes', 'Grandes Reinos', 'Reinos Consolidados', 'Reinos Tardíos'],
    techs: [
      { id: 'escritura', name: 'Escritura' },
      { id: 'hierro', name: 'Hierro' },
      { id: 'rueda', name: 'Rueda' },
      { id: 'arado', name: 'Arado' },
      { id: 'moneda', name: 'Moneda' },
      { id: 'canteria', name: 'Cantería' },
      { id: 'calendario', name: 'Calendario' },
      { id: 'papel', name: 'Papel' },
      { id: 'brujula', name: 'Brújula' },
      { id: 'silleria', name: 'Sillería' },
      { id: 'arco_compuesto', name: 'Arco compuesto' },
      { id: 'contabilidad', name: 'Contabilidad' },
    ],
    culture: [
      'codigo_legal', 'templo_monumental', 'epopeya', 'escuela', 'teatro', 'archivo',
      'calendario_solar', 'mecenazgo', 'universidad', 'cronica_oficial', 'herejia', 'fiesta_nacional',
    ],
  },
  {
    id: 'modernidad',
    name: 'Modernidad',
    sub: ['Modernidad Temprana', 'Modernidad Industrial', 'Modernidad Eléctrica', 'Modernidad Tardía'],
    techs: [
      { id: 'polvora', name: 'Pólvora' },
      { id: 'imprenta', name: 'Imprenta' },
      { id: 'resorte', name: 'Resorte' },
      { id: 'quimica', name: 'Química' },
      { id: 'telar', name: 'Telar mecánico' },
      { id: 'electricidad', name: 'Electricidad' },
      { id: 'vapor', name: 'Máquina de vapor' },
      { id: 'medicina', name: 'Medicina' },
      { id: 'ferrocarril', name: 'Ferrocarril' },
      { id: 'fabrica', name: 'Fábrica' },
      { id: 'radio', name: 'Radio' },
      { id: 'motor', name: 'Motor' },
    ],
    culture: [
      'periodico', 'museo', 'constitucion', 'opera', 'novela', 'censo',
      'escuela_publica', 'propaganda', 'academia', 'ideologia', 'cine', 'estadistica',
    ],
  },
];

export const ERAS_BY_ID: Record<Era, EraDef> = {
  tribal: ERAS[0] as EraDef,
  reinos: ERAS[1] as EraDef,
  modernidad: ERAS[2] as EraDef,
};

export interface Buff {
  type: string;
  untilTurn: number;
}

export type SeatKind = 'human' | 'bot' | 'dormant';

export interface Seat {
  id: number;
  name: string;
  kind: SeatKind;
  areaCard: string;
  domainCard: string;
  believers: number;
  fidelity: number;
  fame: number;
  fe: number;
  xp: number;
  divinity: number;
  temples: number;
  regions: number;
  essence: number;
  relics: number;
  magic: number;
  techs: string[];
  culture: string[];
  buffs: Buff[];
  debuffPrimitive: boolean;
  debuffTurns: number;
  debuffFromCulture: boolean;
  /** Escalón del debuff: 0 = −15 %, 3 = −30 % (§5-B.5, por misiones caducadas). */
  debuffLevel: number;
  /** Turno en que caduca la misión de recuperación abierta. */
  debuffMissionTurn: number | null;
  vassalOf: number | null;
  createdAtTurn: number;
}

export interface BeatAction {
  beat: number;
  channel: Channel;
  action: string;
}

export interface Order {
  seatId: number;
  plan: BeatAction[];
  /** Opción elegida en el problema de era del turno (§15). Sin ella, no hay efecto. */
  problemOption?: string;
}

export interface TurnEvent {
  turn: number;
  visibility: Visibility;
  seatId: number | null;
  kind: string;
  text: string;
  data?: Record<string, number | string>;
}

export interface WarState {
  a: number;
  b: number;
  sinceTurn: number;
}

export interface MatchConfig {
  seats: number;
  humans: number;
  seed: number;
  unlockEvery: number;
  horizonYears: number;
  /**
   * Votantes humanos de la mesa simulada. Los bots y los dormidos no votan
   * (§5-A.2.3), así que sin votantes la ventana nunca cambia.
   */
  tableVoters?: number;
  /**
   * Política de ventana. `table` vota; `fixed` juega siempre con `fixedWindow`
   * (se usa para simular cada ventana por separado y para la mesa que ya acordó
   * un ritmo). Si se pasa `fixedWindow` sin política, se entiende `fixed`.
   */
  windowPolicy?: WindowPolicy;
  fixedWindow?: WindowId;
}

export interface MatchState {
  seed: number;
  turn: number;
  windowId: WindowId;
  /** El estado guarda la política: una partida con ritmo fijo debe reproducirse igual. */
  windowPolicy: WindowPolicy;
  /** Ventana jugada cuando `windowPolicy` es `fixed`; `null` si vota la mesa. */
  fixedWindow: WindowId | null;
  windowsUnlocked: WindowId[];
  unlockEvery: number;
  fictionDay: number;
  era: Era;
  eraBar: number;
  eraAdvancedTurn: number | null;
  /** Último turno en que la barra subió: alimenta la válvula de B.8. */
  lastBarRiseTurn: number;
  tableVoters: number;
  war: WarState | null;
  /** Ventana que había antes de la guerra, para restaurarla al firmar la paz. */
  windowBeforeWar: WindowId | null;
  /** Tregua: turno mínimo antes de que vuelva a poder declararse una guerra. */
  peaceUntilTurn: number;
  horizonYears: number;
  seats: Seat[];
  milestones: Record<string, number>;
  events: TurnEvent[];
  finished: boolean;
  winnerSeat: number | null;
  /** Ingreso del turno repartido por compás; se libera de a poco. */
  pendingIncome: number[];
  /** Ventana forzada (choque de civilizaciones) hasta cierto día de ficción. */
  windowOverride: { windowId: WindowId; untilDay: number } | null;
}

export const DIVINITY_CAP_BASE = [0, 100, 200, 400, 700, 1200, 2000, 3500, 6000, 10000, 20000, 100000];

export const XP_THRESHOLDS = [0, 0, 30, 80, 150, 250, 400, 600, 900, 1300, 1800, 2500];
