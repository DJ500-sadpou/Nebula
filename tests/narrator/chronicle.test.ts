import { describe, expect, it } from 'vitest';
import { chronicleFor, eventsOfTurn } from '../../lib/narrator/chronicle';
import {
  ALDIN,
  CLOSERS,
  OPENERS,
  PRIVATE,
  SYSTEM,
  TEMPLATE_COUNT,
  fillTemplate,
} from '../../lib/narrator/templates';
import { makeSeat, makeState } from '../helpers';

const ALL_TEMPLATES = [
  ...Object.values(OPENERS).flat(),
  ...Object.values(CLOSERS).flat(),
  ...ALDIN,
  ...SYSTEM,
  ...PRIVATE,
];

const SLOTS = new Set([
  'seat',
  'era',
  'window',
  'day',
  'year',
  'month',
  'turn',
  'bar',
  'fe',
  'believers',
  'divinity',
  'fidelity',
  'temples',
  'regions',
]);

const CONTEXT = Object.fromEntries([...SLOTS].map((slot) => [slot, slot === 'seat' ? 'Nebula' : 1]));

describe('plantillas de crónica (§17.3)', () => {
  it('hay al menos cuarenta plantillas y todas son distintas', () => {
    expect(TEMPLATE_COUNT).toBeGreaterThanOrEqual(40);
    expect(new Set(ALL_TEMPLATES).size).toBe(ALL_TEMPLATES.length);
  });

  it('todos los slots son conocidos y se rellenan sin dejar llaves', () => {
    for (const template of ALL_TEMPLATES) {
      for (const match of template.matchAll(/\{(\w+)\}/g)) {
        expect(SLOTS.has(match[1]!), `slot desconocido en «${template}»`).toBe(true);
      }
      const filled = fillTemplate(template, CONTEXT);
      expect(filled).not.toMatch(/[{}]/);
    }
  });

  it('un slot sin valor es un error, no un texto a medias', () => {
    expect(() => fillTemplate('Hola {inexistente}', CONTEXT)).toThrow(/Slot sin rellenar/);
  });
});

describe('crónica del turno', () => {
  function stateWithEvents() {
    const state = makeState(
      [makeSeat({ id: 0, name: 'Nebula' }), makeSeat({ id: 1, name: 'Eldar' })],
      { turn: 2, fictionDay: 30, seed: 5 },
    );
    state.events.push(
      {
        turn: 1,
        visibility: 'public',
        seatId: 0,
        kind: 'world',
        text: 'Una tormenta barre los sembrados.',
      },
      {
        turn: 1,
        visibility: 'seat',
        seatId: 0,
        kind: 'milestone',
        text: 'Has alcanzado los cien fieles.',
      },
      {
        turn: 1,
        visibility: 'seat',
        seatId: 1,
        kind: 'milestone',
        text: 'Eldar ha alcanzado los cien fieles.',
      },
    );
    return state;
  }

  it('es determinista', () => {
    const state = stateWithEvents();
    expect(chronicleFor(state, 0)).toEqual(chronicleFor(structuredClone(state), 0));
  });

  it('el texto público incluye los eventos públicos y no los privados ajenos', () => {
    const state = stateWithEvents();
    const { publicText } = chronicleFor(state, 0);
    expect(publicText).toContain('Una tormenta barre los sembrados.');
    expect(publicText).not.toContain('Eldar ha alcanzado');
    expect(publicText).not.toMatch(/[{}]/);
  });

  it('el texto privado es del asiento y lleva sus eventos', () => {
    const state = stateWithEvents();
    const { privateText } = chronicleFor(state, 0);
    expect(privateText).toContain('Has alcanzado los cien fieles.');
    expect(privateText).toContain('Nebula');
    expect(privateText).not.toContain('Eldar ha alcanzado');
  });

  it('el turno 1 sin eventos también produce crónica', () => {
    const state = makeState([makeSeat({ id: 0, name: 'Nebula' })], { turn: 1, fictionDay: 0 });
    expect(eventsOfTurn(state)).toEqual([]);
    const chronicle = chronicleFor(state, 0);
    expect(chronicle.publicText.length).toBeGreaterThan(40);
    expect(chronicle.privateText.length).toBeGreaterThan(20);
  });

  it('un asiento inexistente es un error de programación', () => {
    const state = makeState([makeSeat({ id: 0 })]);
    expect(() => chronicleFor(state, 9)).toThrow(/Asiento 9/);
  });
});
