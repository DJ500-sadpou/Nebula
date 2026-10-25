import { describe, expect, it } from 'vitest';
import { hash3, mulberry32, pick, pickOne, rng } from '../../lib/engine/rng';

describe('rng', () => {
  it('es determinista para la misma semilla', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 32; i += 1) expect(a()).toBe(b());
  });

  it('devuelve valores en [0, 1)', () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 2000; i += 1) {
      const value = rand();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('separa flujos por turno y paso', () => {
    const first = rng(1, 0, 0)();
    expect(rng(1, 0, 1)()).not.toBe(first);
    expect(rng(1, 1, 0)()).not.toBe(first);
    expect(rng(2, 0, 0)()).not.toBe(first);
  });

  it('mantiene hash3 estable (golden)', () => {
    // Si este valor cambia, cambian todas las partidas guardadas: es un fallo.
    expect(hash3(1, 2, 3)).toBe(hash3(1, 2, 3));
    expect(hash3(0, 0, 0)).toBe(857305552);
    expect(hash3(1, 2, 3)).toBe(2302191153);
  });

  it('pick respeta el rango y pickOne exige lista', () => {
    const rand = mulberry32(99);
    for (let i = 0; i < 500; i += 1) {
      const value = pick(5, rand);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(5);
    }
    expect(() => pickOne([], rand)).toThrow();
    expect(pickOne(['a'], rand)).toBe('a');
  });
});
