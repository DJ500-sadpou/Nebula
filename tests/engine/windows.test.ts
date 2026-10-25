import { describe, expect, it } from 'vitest';
import {
  ballotOptions,
  chooseWindow,
  createInitialState,
  resolveTurn,
  windowCeiling,
} from '../../lib/engine/resolve';
import { BEATS_PER_TURN, WINDOW_LADDER, WINDOWS, WindowId } from '../../lib/engine/types';
import { makeSeat, makeState } from '../helpers';

/**
 * §5-A: escalera de ventanas, papeleta de la mesa y techos de guerra.
 */

const config = (over: Partial<Parameters<typeof createInitialState>[0]> = {}) => ({
  seats: 6,
  humans: 3,
  seed: 42,
  unlockEvery: 5,
  horizonYears: 30,
  tableVoters: 3,
  ...over,
});

describe('escalera de ventanas (§5-A.2)', () => {
  it('son siete escalones con días crecientes y ocho compases cada uno', () => {
    expect(WINDOW_LADDER).toEqual(['1d', '7d', '30d', '3m', '6m', '1y', '3y']);
    expect(BEATS_PER_TURN).toBe(8);

    let previous = 0;
    for (const id of WINDOW_LADDER) {
      const window = WINDOWS[id];
      expect(window.id).toBe(id);
      expect(window.days).toBeGreaterThan(previous);
      expect(window.label.length).toBeGreaterThan(0);
      expect(window.days / BEATS_PER_TURN).toBeGreaterThan(0);
      previous = window.days;
    }
  });

  it('la partida empieza en 1d con la escalera cerrada', () => {
    const state = createInitialState(config());
    expect(state.windowId).toBe('1d');
    expect(state.windowsUnlocked).toEqual(['1d']);
    expect(state.windowPolicy).toBe('table');
    expect(state.fixedWindow).toBeNull();
  });

  it('se desbloquea un escalón cada `unlockEvery` turnos', () => {
    let state = createInitialState(config({ unlockEvery: 2 }));
    for (let i = 0; i < 14 && !state.finished; i += 1) state = resolveTurn(state, []);
    // Turno 15 con `unlockEvery` 2 ⇒ floor(14/2) = 7, la escalera entera.
    expect(state.windowsUnlocked).toEqual(WINDOW_LADDER);
  });

  it('sin votantes la ventana no cambia', () => {
    const state = makeState([makeSeat()], { windowId: '30d', tableVoters: 0 });
    expect(chooseWindow(state)).toBe('30d');
  });

  it('la votación solo devuelve ventanas desbloqueadas y es determinista', () => {
    const state = makeState([makeSeat()], {
      windowId: '1d',
      windowsUnlocked: ['1d', '7d', '30d'],
      tableVoters: 3,
    });
    const first = chooseWindow(state);
    expect(['1d', '7d', '30d']).toContain(first);
    expect(chooseWindow(state)).toBe(first);
    expect(chooseWindow(structuredClone(state))).toBe(first);
  });
});

describe('ritmo fijo (§5-A.12)', () => {
  it('con ventana fija la partida no vota ni cambia de ritmo', () => {
    let state = createInitialState(config({ fixedWindow: '3y' }));
    expect(state.windowId).toBe('3y');
    expect(state.windowPolicy).toBe('fixed');
    expect(state.fixedWindow).toBe('3y');
    expect(state.windowsUnlocked).toEqual(WINDOW_LADDER);

    for (let i = 0; i < 4; i += 1) {
      state = resolveTurn(state, []);
      expect(state.windowId).toBe('3y');
    }
  });

  it('la ventana fija ya está desbloqueada y no depende de la escalera', () => {
    const state = createInitialState(config({ fixedWindow: '3m', unlockEvery: 5 }));
    expect(state.windowsUnlocked).toContain('3m');
  });

  it('pedir ritmo fijo sin ventana, o una ventana inventada, es un error de configuración', () => {
    expect(() => createInitialState(config({ windowPolicy: 'fixed' }))).toThrow(/fixedWindow/);
    expect(() =>
      createInitialState(config({ fixedWindow: '9y' as WindowId })),
    ).toThrow(/Ventana fija desconocida/);
  });

  it('pasar fixedWindow sin política se entiende como ritmo fijo', () => {
    const state = createInitialState(config({ fixedWindow: '6m' }));
    expect(state.windowPolicy).toBe('fixed');
    expect(state.windowId).toBe('6m');
  });
});

describe('choques y guerras (§5-A.11)', () => {
  it('el techo de guerra depende de la etapa del mundo', () => {
    expect(windowCeiling('tribal')).toBe('7d');
    expect(windowCeiling('reinos')).toBe('30d');
    expect(windowCeiling('modernidad')).toBe('3m');
  });

  it('sin guerra la papeleta ofrece todo lo desbloqueado', () => {
    const state = makeState([makeSeat()], { windowsUnlocked: WINDOW_LADDER });
    expect(ballotOptions(state)).toEqual(WINDOW_LADDER);
  });

  it('en guerra la papeleta recorta por encima del techo', () => {
    const base = makeState([makeSeat({ id: 0 }), makeSeat({ id: 1 })], {
      windowsUnlocked: WINDOW_LADDER,
      war: { a: 0, b: 1, sinceTurn: 1 },
    });
    expect(ballotOptions({ ...base, era: 'tribal' })).toEqual(['1d', '7d']);
    expect(ballotOptions({ ...base, era: 'reinos' })).toEqual(['1d', '7d', '30d']);
    expect(ballotOptions({ ...base, era: 'modernidad' })).toEqual(['1d', '7d', '30d', '3m']);
  });

  it('un choque fuerza 1d dos turnos y después devuelve el mando a la mesa', () => {
    let state = makeState([makeSeat()], {
      windowId: '3y',
      windowsUnlocked: [...WINDOW_LADDER],
      windowOverride: { windowId: '1d', untilDay: 2 },
    });

    state = resolveTurn(state, []);
    expect(state.windowId).toBe('1d');
    state = resolveTurn(state, []);
    expect(state.windowId).toBe('1d');

    state = resolveTurn(state, []);
    expect(state.windowOverride).toBeNull();
    expect(WINDOW_LADDER).toContain(state.windowId);
  });

  it('con ritmo fijo, un choque no rompe la ventana acordada', () => {
    let state = createInitialState(config({ fixedWindow: '30d' }));
    state.windowOverride = { windowId: '1d', untilDay: state.fictionDay + 10 };
    state = resolveTurn(state, []);
    expect(state.windowId).toBe('30d');
    expect(state.fictionDay).toBe(WINDOWS['30d'].days);
  });
});
