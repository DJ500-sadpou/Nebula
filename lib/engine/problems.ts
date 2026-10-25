import { clampFe } from './economy';
import { rng } from './rng';
import { Era, MatchState, Seat } from './types';

/**
 * Problemas de era (§15 de REGLAS.md, paso 6 de §8).
 *
 * Cada turno, cada dios recibe un problema con tres opciones. Ninguna es gratis
 * y ninguna es óptima para todos los arquetipos. El catálogo completo son doce
 * problemas por era (Fase 5); aquí van los seis que necesita la rebanada de un
 * jugador, con la misma forma que tendrá el resto.
 *
 * Regla de la rebanada (REGLAS.md §15.1): **sin elección no hay efecto**. Los
 * bots no eligen hasta que la Fase 6 les dé política de problemas, y el motor
 * no inventa una opción por ellos; así una partida sin decisiones humanas se
 * resuelve igual que en la Fase 0 y las huellas del motor no se mueven.
 */

export interface ProblemOption {
  id: string;
  label: string;
  /** Coste en Fe; se cobra antes del efecto. */
  cost: number;
  /** Efecto en una línea, para la interfaz. */
  detail: string;
  effect: (seat: Seat, state: MatchState) => void;
}

export interface EraProblem {
  id: string;
  era: Era;
  title: string;
  text: string;
  options: [ProblemOption, ProblemOption, ProblemOption];
}

function keepFidelity(seat: Seat, delta: number): void {
  seat.fidelity = Math.max(0.1, Math.min(1.5, seat.fidelity + delta));
}

function addBelievers(seat: Seat, delta: number): void {
  seat.believers = Math.max(1, seat.believers + delta);
}

export const PROBLEMS: EraProblem[] = [
  {
    id: 'sequia',
    era: 'tribal',
    title: 'Sequía',
    text: 'Los pozos bajan y el ganado adelgaza. Tu pueblo mira al cielo y espera una señal.',
    options: [
      {
        id: 'cavar',
        label: 'Cavar más hondo',
        cost: 0,
        detail: '+0,03 de fidelidad, −8 fieles por el esfuerzo',
        effect: (seat) => {
          keepFidelity(seat, 0.03);
          addBelievers(seat, -8);
        },
      },
      {
        id: 'migrar',
        label: 'Migrar al norte',
        cost: 20,
        detail: '+15 fieles, −1 región',
        effect: (seat) => {
          addBelievers(seat, 15);
          seat.regions = Math.max(1, seat.regions - 1);
        },
      },
      {
        id: 'sacrificio',
        label: 'Sacrificio de reses',
        cost: 0,
        detail: '−8 fieles, +35 Fe, +3 de fama',
        effect: (seat) => {
          addBelievers(seat, -8);
          seat.fe += 35;
          seat.fame += 3;
        },
      },
    ],
  },
  {
    id: 'langostas',
    era: 'tribal',
    title: 'Langostas',
    text: 'Una nube oscura avanza sobre los sembrados. Los ancianos hablan de castigos.',
    options: [
      {
        id: 'humo',
        label: 'Espantar con humo',
        cost: 10,
        detail: '+0,02 de fidelidad',
        effect: (seat) => keepFidelity(seat, 0.02),
      },
      {
        id: 'dejar',
        label: 'Dejarlas pasar',
        cost: 0,
        detail: '−12 fieles, +10 Fe de las reservas',
        effect: (seat) => {
          addBelievers(seat, -12);
          seat.fe += 10;
        },
      },
      {
        id: 'ritual',
        label: 'Ritual de hambre',
        cost: 0,
        detail: '−6 fieles, +0,05 de fidelidad',
        effect: (seat) => {
          addBelievers(seat, -6);
          keepFidelity(seat, 0.05);
        },
      },
    ],
  },
  {
    id: 'herejia',
    era: 'reinos',
    title: 'Herejía',
    text: 'Un predicador niega tu nombre en la plaza y la multitud escucha en silencio.',
    options: [
      {
        id: 'concilio',
        label: 'Convocar un concilio',
        cost: 30,
        detail: '+0,04 de fidelidad',
        effect: (seat) => keepFidelity(seat, 0.04),
      },
      {
        id: 'quemar',
        label: 'Quemar al heresiarca',
        cost: 0,
        detail: '−10 fieles, +0,06 de fidelidad, +2 de fama',
        effect: (seat) => {
          addBelievers(seat, -10);
          keepFidelity(seat, 0.06);
          seat.fame += 2;
        },
      },
      {
        id: 'ignorar',
        label: 'Dejar que se apague',
        cost: 0,
        detail: '−0,04 de fidelidad, +10 Fe',
        effect: (seat) => {
          keepFidelity(seat, -0.04);
          seat.fe += 10;
        },
      },
    ],
  },
  {
    id: 'peste',
    era: 'reinos',
    title: 'Peste en el valle',
    text: 'La fiebre entra por el puerto. Los sacerdotes discuten si es castigo o desgracia.',
    options: [
      {
        id: 'cuarentena',
        label: 'Cerrar las puertas',
        cost: 25,
        detail: '−5 fieles, +0,03 de fidelidad',
        effect: (seat) => {
          addBelievers(seat, -5);
          keepFidelity(seat, 0.03);
        },
      },
      {
        id: 'rezar',
        label: 'Rezar y esperar',
        cost: 0,
        detail: '−15 fieles, +0,05 de fidelidad',
        effect: (seat) => {
          addBelievers(seat, -15);
          keepFidelity(seat, 0.05);
        },
      },
      {
        id: 'acoger',
        label: 'Acoger a los enfermos',
        cost: 0,
        detail: '−10 fieles, +0,08 de fidelidad, +3 de fama',
        effect: (seat) => {
          addBelievers(seat, -10);
          keepFidelity(seat, 0.08);
          seat.fame += 3;
        },
      },
    ],
  },
  {
    id: 'huelga',
    era: 'modernidad',
    title: 'Huelga en las fábricas',
    text: 'Las chimeneas se apagan una a una. Los capataces piden mano dura y los obreros, pan.',
    options: [
      {
        id: 'negociar',
        label: 'Negociar en la sombra',
        cost: 40,
        detail: '+10 fieles, +0,04 de fidelidad',
        effect: (seat) => {
          addBelievers(seat, 10);
          keepFidelity(seat, 0.04);
        },
      },
      {
        id: 'romper',
        label: 'Romper la huelga',
        cost: 0,
        detail: '−20 fieles, +30 Fe, +2 de fama',
        effect: (seat) => {
          addBelievers(seat, -20);
          seat.fe += 30;
          seat.fame += 2;
        },
      },
      {
        id: 'reformar',
        label: 'Reformar las leyes',
        cost: 60,
        detail: '+5 fieles, +0,06 de fidelidad',
        effect: (seat) => {
          addBelievers(seat, 5);
          keepFidelity(seat, 0.06);
        },
      },
    ],
  },
  {
    id: 'crisis',
    era: 'modernidad',
    title: 'Crisis de fe',
    text: 'Los periódicos preguntan para qué sirve un dios. La ciudad celebra sin mirar al cielo.',
    options: [
      {
        id: 'obras',
        label: 'Obras públicas',
        cost: 50,
        detail: '+12 fieles, +0,02 de fidelidad',
        effect: (seat) => {
          addBelievers(seat, 12);
          keepFidelity(seat, 0.02);
        },
      },
      {
        id: 'austeridad',
        label: 'Austeridad del culto',
        cost: 0,
        detail: '−10 fieles, +25 Fe',
        effect: (seat) => {
          addBelievers(seat, -10);
          seat.fe += 25;
        },
      },
      {
        id: 'procesion',
        label: 'Procesión multitudinaria',
        cost: 10,
        detail: '+0,05 de fidelidad',
        effect: (seat) => keepFidelity(seat, 0.05),
      },
    ],
  },
];

/** Problemas de una era, en orden estable. */
export function problemsForEra(era: Era): EraProblem[] {
  return PROBLEMS.filter((problem) => problem.era === era);
}

/**
 * Problema del turno: determinista por semilla y turno, así que el servidor y
 * cualquier reproducción eligen el mismo.
 */
export function problemFor(state: MatchState): EraProblem {
  const list = problemsForEra(state.era);
  const rand = rng(state.seed, state.turn, 303);
  const item = list[Math.min(list.length - 1, Math.floor(rand() * list.length))];
  if (!item) throw new Error(`Sin problemas de era para ${state.era}`);
  return item;
}

export interface ProblemOptionView {
  id: string;
  label: string;
  cost: number;
  detail: string;
  affordable: boolean;
}

export interface ProblemView {
  id: string;
  title: string;
  text: string;
  options: ProblemOptionView[];
}

/**
 * Vista valorada por el servidor: el cliente nunca calcula costes (§3.1 de
 * PLAN.md). La opción no asequible se muestra igual, pero marcada.
 */
export function problemView(state: MatchState, seat: Seat): ProblemView {
  const problem = problemFor(state);
  return {
    id: problem.id,
    title: problem.title,
    text: problem.text,
    options: problem.options.map((option) => ({
      id: option.id,
      label: option.label,
      cost: option.cost,
      detail: option.detail,
      affordable: seat.fe >= option.cost,
    })),
  };
}

/**
 * Aplica la opción elegida. Devuelve `false` si la opción no existe, no es del
 * problema del turno o no se puede pagar: la orden ilegal se descarta sin
 * lanzar, igual que una acción sin Fe.
 */
export function applyProblemChoice(
  state: MatchState,
  seat: Seat,
  optionId: string,
): boolean {
  const problem = problemFor(state);
  const option = problem.options.find((item) => item.id === optionId);
  if (!option) return false;
  if (seat.fe < option.cost) return false;
  seat.fe -= option.cost;
  option.effect(seat, state);
  clampFe(seat);
  return true;
}
