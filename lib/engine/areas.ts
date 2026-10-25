import { Seat } from './types';

/**
 * Cartas de área (§3, §6.1).
 *
 * §6.1: cada área pequeña da un descuento o una pasiva temática. En la Fase 0
 * solo están implementadas las tres pasivas que afectan a la resolución; el
 * catálogo de 32 áreas con sus dos acciones exclusivas es contenido de Fase 5.
 *
 * Módulo aparte: tanto la economía como la resolución necesitan las pasivas y
 * la economía ya alimenta a contenido, así que el ciclo de imports es peor que
 * este archivo.
 */
export interface AreaPassive {
  /** Multiplicador sobre el ingreso mensual. */
  income: number;
  /** Ajuste sobre la fidelidad objetivo por turno. */
  fidelity: number;
  /** Magia inicial al fundar la civilización. */
  magia: number;
}

const AREA_PASSIVES: Record<string, AreaPassive> = {
  Minerales: { income: 1.2, fidelity: 0, magia: 0 },
  Ganado: { income: 1, fidelity: 0.05, magia: 0 },
  'Magia Demoníaca': { income: 0.9, fidelity: 0, magia: 1 },
};

export const DEFAULT_PASSIVE: AreaPassive = { income: 1, fidelity: 0, magia: 0 };

export function areaPassive(seat: Seat): AreaPassive {
  return passiveForArea(seat.areaCard);
}

export function passiveForArea(area: string): AreaPassive {
  return AREA_PASSIVES[area] ?? DEFAULT_PASSIVE;
}
