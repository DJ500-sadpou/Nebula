import { describe, expect, it } from 'vitest';
import { baseIncome30d, capFe, clampFe, income30d, incomeTurn } from '../../lib/engine/economy';
import { makeSeat } from '../helpers';

describe('economía de Fe (§4)', () => {
  it('el tope crece con la Divinidad', () => {
    const low = capFe(makeSeat({ divinity: 1, believers: 30 }));
    const high = capFe(makeSeat({ divinity: 5, believers: 30 }));
    expect(low).toBe(100);
    expect(high).toBe(1200);
  });

  it('cada ×10 de población suma el 100 % de la base (logarítmico)', () => {
    const base = 1200; // Divinidad 5
    expect(capFe(makeSeat({ divinity: 5, believers: 30 }))).toBe(base);
    expect(capFe(makeSeat({ divinity: 5, believers: 300 }))).toBe(base * 2);
    expect(capFe(makeSeat({ divinity: 5, believers: 3_000 }))).toBe(base * 3);
    expect(capFe(makeSeat({ divinity: 5, believers: 30_000 }))).toBe(base * 4);
  });

  it('el tope nunca baja al crecer la población', () => {
    let previous = 0;
    for (const believers of [30, 100, 300, 1_000, 10_000, 100_000, 5_000_000]) {
      const cap = capFe(makeSeat({ believers }));
      expect(cap).toBeGreaterThanOrEqual(previous);
      previous = cap;
    }
  });

  it('el ingreso es sublineal en la población', () => {
    const small = baseIncome30d(makeSeat({ believers: 30 }));
    const large = baseIncome30d(makeSeat({ believers: 100_000 }));
    expect(large).toBeGreaterThan(small);
    expect(large / small).toBeLessThan(120);
    expect(large / small).toBeGreaterThan(20);
  });

  it('un turno de 1 día nunca cobra menos del 20 % del ingreso mensual', () => {
    const seat = makeSeat({ believers: 30, fidelity: 0.7 });
    const monthly = income30d(seat);
    const oneDay = incomeTurn(seat, 1);
    expect(oneDay).toBeGreaterThanOrEqual(monthly * 0.2);
    expect(oneDay).toBeLessThan(monthly);
  });

  it('una ventana de 30 días cobra el mensual completo', () => {
    const seat = makeSeat({ believers: 3_000, fidelity: 0.9, temples: 2, fame: 40 });
    expect(incomeTurn(seat, 30)).toBe(income30d(seat));
  });

  it('el debuff primitivo cuesta el 15 % del ingreso', () => {
    const seat = makeSeat({ believers: 3_000, fidelity: 0.9 });
    const normal = income30d(seat);
    const debuffed = income30d({ ...seat, debuffPrimitive: true });
    expect(debuffed).toBe(Math.floor(normal * 0.85));
  });

  it('clampFe respeta el tope y el cero', () => {
    const seat = makeSeat({ divinity: 1, believers: 30, fe: 999 });
    clampFe(seat);
    expect(seat.fe).toBe(capFe(seat));
    seat.fe = -20;
    clampFe(seat);
    expect(seat.fe).toBe(0);
  });

  it('el Fe es entero en todo el cálculo', () => {
    const seat = makeSeat({ believers: 1_234, fidelity: 0.83, temples: 1, fame: 17 });
    expect(Number.isInteger(baseIncome30d(seat))).toBe(true);
    expect(Number.isInteger(income30d(seat))).toBe(true);
  });
});
