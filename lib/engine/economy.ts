import { areaPassive } from './areas';
import { DIVINITY_CAP_BASE, Seat } from './types';

/**
 * Economía de Fe (§4 de REGLAS.md).
 *
 * - Ingreso sublineal: 6·√(10·fieles)·fidelidad + templos·10 + fama/20.
 * - El turno cobra `max(mensual · días/30, 20 % del mensual)`.
 * - El tope depende de la Divinidad y del logaritmo de la población.
 */

export function capFe(seat: Seat): number {
  const base = DIVINITY_CAP_BASE[seat.divinity] ?? 100;
  const factor = 1 + Math.log10(Math.max(30, seat.believers) / 30);
  return Math.max(1, Math.floor(base * factor));
}

export function baseIncome30d(seat: Seat): number {
  const gross = 6 * Math.sqrt(10 * seat.believers) * seat.fidelity;
  return Math.floor(gross + seat.temples * 10 + Math.round(seat.fame / 20));
}

/** Ingreso mensual efectivo, con el debuff primitivo aplicado. */
export function income30d(seat: Seat): number {
  // §6.1: la pasiva del área pequeña (Minerales +20 %, Magia Demoníaca −10 %…).
  let value = baseIncome30d(seat) * areaPassive(seat).income;
  // §5-B.4/B.5: −15 % base, −5 % más por cada misión caducada, hasta −30 %.
  if (seat.debuffPrimitive) value *= Math.max(0.7, 0.85 - 0.05 * seat.debuffLevel);
  return Math.max(0, Math.floor(value));
}

/** Ingreso del turno completo para una ventana de `days` días. */
export function incomeTurn(seat: Seat, days: number): number {
  const monthly = income30d(seat);
  if (monthly <= 0) return 0;
  const proportional = monthly * (days / 30);
  const floor = 0.2 * monthly;
  return Math.max(proportional, floor);
}

/** Aplica el tope y redondea hacia abajo: el Fe se cuenta en enteros. */
export function clampFe(seat: Seat): void {
  const cap = capFe(seat);
  if (seat.fe > cap) seat.fe = cap;
  if (seat.fe < 0) seat.fe = 0;
  // El Fe se cuenta en enteros: la red de seguridad, no el mecanismo.
  if (!Number.isInteger(seat.fe)) seat.fe = Math.floor(seat.fe);
}
