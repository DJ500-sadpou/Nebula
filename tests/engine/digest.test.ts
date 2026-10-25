import { describe, expect, it } from 'vitest';
import { canonical, digestOf, digestState } from '../../lib/engine/digest';
import { makeState } from '../helpers';

describe('huella determinista', () => {
  it('el orden de las claves no cambia la huella', () => {
    expect(digestOf({ a: 1, b: 2 })).toBe(digestOf({ b: 2, a: 1 }));
    expect(digestOf({ a: [1, { x: 1, y: 2 }] })).toBe(digestOf({ a: [1, { y: 2, x: 1 }] }));
  });

  it('los números enteros y los decimales son estables', () => {
    expect(canonical(12)).toBe('12');
    expect(canonical(0.5)).toBe('0.500000');
    expect(canonical(null)).toBe('null');
    expect(() => canonical(undefined)).toThrow();
    expect(() => canonical(Number.NaN)).toThrow();
  });

  it('las dos mitades de la huella dependen del contenido, no de la longitud', () => {
    // Regresión: en la primera versión el byte alto era siempre 0 en ASCII y
    // media huella solo reflejaba la longitud del texto.
    const a = digestOf('aaaa');
    const b = digestOf('bbbb');
    expect(a).not.toBe(b);
    expect(a.slice(0, 8)).not.toBe(b.slice(0, 8));
    expect(a.slice(8)).not.toBe(b.slice(8));
    expect(digestOf('abcd').slice(8)).not.toBe(digestOf('abce').slice(8));
  });

  it('cambia al cambiar un solo dato del estado', () => {
    const state = makeState([]);
    const before = digestState(state);
    state.seats.push({ ...state.seats[0]!, id: 99 });
    expect(digestState(state)).not.toBe(before);
  });

  it('los eventos no entran en la huella, solo su cantidad', () => {
    const state = makeState([]);
    const before = digestState(state);
    state.events.push({ turn: 1, visibility: 'public', seatId: null, kind: 'x', text: 'uno' });
    expect(digestState(state)).not.toBe(before);
    const afterText = digestState(state);
    state.events[0]!.text = 'otro texto';
    expect(digestState(state)).toBe(afterText);
  });
});
