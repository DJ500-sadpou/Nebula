import { describe, expect, it } from 'vitest';
import { ACTIONS, MISSION_IDS, MISSION_TURNS } from '../../lib/engine/content';
import { areaPassive, passiveForArea } from '../../lib/engine/areas';
import { income30d } from '../../lib/engine/economy';
import { makeSeat, makeState } from '../helpers';

describe('misiones de recuperación (§5-B.5)', () => {
  it('hay ocho y corresponden a las tres dimensiones', () => {
    expect(MISSION_IDS.size).toBe(8);
    expect(MISSION_TURNS).toBe(5);
    const dims = {
      tecnologia: ['emisarios', 'copiar_oficio', 'contratar_sabios', 'reforma_educativa'],
      poblacion: ['tierra_prometida', 'anio_cosechas'],
      cultura: ['mecenazgo', 'reforma_religiosa'],
    };
    for (const ids of Object.values(dims)) {
      for (const id of ids) {
        expect(MISSION_IDS.has(id), `falta la misión ${id}`).toBe(true);
        expect(ACTIONS[id]).toBeDefined();
      }
    }
  });

  it('la tabla de costes y compases coincide con la regla', () => {
    const expected: Record<string, [number, number]> = {
      emisarios: [40, 2],
      copiar_oficio: [60, 3],
      contratar_sabios: [100, 4],
      reforma_educativa: [150, 6],
      tierra_prometida: [60, 3],
      anio_cosechas: [80, 4],
      mecenazgo: [50, 3],
      reforma_religiosa: [120, 5],
    };
    for (const [id, [cost, beats]] of Object.entries(expected)) {
      const def = ACTIONS[id]!;
      expect(def.cost(makeSeat(), makeState([])), id).toBe(cost);
      expect(def.beats, id).toBe(beats);
    }
    expect(ACTIONS.reforma_educativa!.minWindow).toBe('1y');
    expect(ACTIONS.anio_cosechas!.minWindow).toBe('6m');
    expect(ACTIONS.reforma_religiosa!.minWindow).toBe('1y');
  });

  it('solo se ofrecen mientras dura el debuff', () => {
    const clean = makeSeat();
    const behind = makeSeat({ debuffPrimitive: true });
    // copiar_oficio exige además un rival con más tecnologías.
    const advanced = makeSeat({ id: 2, techs: ['fuego'] });
    const state = makeState([clean, behind, advanced]);
    for (const id of MISSION_IDS) {
      const def = ACTIONS[id]!;
      expect(def.available?.(clean, state), `${id} sin debuff`).toBe(false);
      expect(def.available?.(behind, state), `${id} con debuff`).toBe(true);
    }
  });

  it('las misiones reparan exactamente lo que prometen', () => {
    const tech = makeSeat({ debuffPrimitive: true, techs: [] });
    const state = makeState([tech], { era: 'tribal' });
    ACTIONS.contratar_sabios!.effect(tech, state, () => 1);
    expect(tech.techs).toHaveLength(2);

    const culture = makeSeat({ debuffPrimitive: true, culture: [] });
    const stateC = makeState([culture], { era: 'tribal' });
    ACTIONS.mecenazgo!.effect(culture, stateC, () => 1);
    expect(culture.culture).toHaveLength(2);

    const pop = makeSeat({ debuffPrimitive: true, believers: 1000, regions: 2 });
    ACTIONS.tierra_prometida!.effect(pop, makeState([pop]), () => 1);
    expect(pop.believers).toBe(1300);
  });

  it('copiar el oficio exige que exista un rival más avanzado', () => {
    const seat = makeSeat({ debuffPrimitive: true, techs: ['fuego'] });
    const state = makeState([seat]);
    expect(ACTIONS.copiar_oficio!.available?.(seat, state)).toBe(false);
    state.seats.push(makeSeat({ id: 1, techs: ['fuego', 'lanza'] }));
    expect(ACTIONS.copiar_oficio!.available?.(seat, state)).toBe(true);
  });

  it('el debuff escala con las misiones caducadas: −15 % hasta −30 %', () => {
    const seat = makeSeat({ believers: 3_000, fidelity: 0.9 });
    const base = income30d(seat);
    expect(income30d({ ...seat, debuffPrimitive: true, debuffLevel: 0 })).toBe(
      Math.floor(base * 0.85),
    );
    expect(income30d({ ...seat, debuffPrimitive: true, debuffLevel: 3 })).toBe(
      Math.floor(base * 0.7),
    );
  });
});

describe('cartas de área (§3, §6.1)', () => {
  it('Minerales gana un 20 % de ingresos y Magia Demoníaca pierde un 10 %', () => {
    expect(passiveForArea('Minerales').income).toBe(1.2);
    expect(passiveForArea('Magia Demoníaca').income).toBe(0.9);
    expect(passiveForArea('Ganado').fidelity).toBeGreaterThan(0);
    expect(passiveForArea('Mar').income).toBe(1);
  });

  it('el ingreso aplica la pasiva del área', () => {
    const plain = makeSeat({ areaCard: 'Mar', believers: 1_000, fidelity: 0.8 });
    const rich = makeSeat({ areaCard: 'Minerales', believers: 1_000, fidelity: 0.8 });
    const poor = makeSeat({ areaCard: 'Magia Demoníaca', believers: 1_000, fidelity: 0.8 });
    const base = income30d(plain);
    expect(income30d(rich)).toBe(Math.floor(base * 1.2));
    expect(income30d(poor)).toBe(Math.floor(base * 0.9));
    expect(areaPassive(plain).magia).toBe(0);
    expect(passiveForArea('Magia Demoníaca').magia).toBe(1);
  });
});
