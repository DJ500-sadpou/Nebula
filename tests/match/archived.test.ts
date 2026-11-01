import { describe, expect, it } from 'vitest';
import { archivedViewOf } from '../../lib/db/matches';

/**
 * Proyección del resumen de una partida archivada (REGLAS.md §21.2, Fase 7A).
 * Es pura: tolera columnas a medias porque el `summary` lo escribe SQL y lo
 * consume la interfaz.
 */

describe('archivedViewOf', () => {
  it('proyecta un resumen completo', () => {
    const view = archivedViewOf({
      code: 'ARCHIV',
      closed_at: '2027-01-01T12:00:00+00:00',
      summary: {
        mode: 'multi',
        seats: 8,
        turns: 24,
        era: 'reinos',
        fictionDay: 340,
        winnerSeat: 3,
        winnerName: 'Bruma',
        createdAt: '2026-12-01T12:00:00+00:00',
        closedAt: '2027-01-01T12:00:00+00:00',
      },
    });

    expect(view.code).toBe('ARCHIV');
    expect(view.closedAt).toBe('2027-01-01T12:00:00+00:00');
    expect(view.summary).toEqual({
      mode: 'multi',
      seats: 8,
      turns: 24,
      era: 'reinos',
      fictionDay: 340,
      winnerSeat: 3,
      winnerName: 'Bruma',
      createdAt: '2026-12-01T12:00:00+00:00',
      closedAt: '2027-01-01T12:00:00+00:00',
    });
  });

  it('un summary nulo deja la ficha sin resumen, sin romperse', () => {
    const view = archivedViewOf({ code: 'VACIA1', closed_at: null, summary: null });
    expect(view.code).toBe('VACIA1');
    expect(view.closedAt).toBeNull();
    expect(view.summary).toBeNull();
  });

  it('las columnas a medias se proyectan como null, no como basura', () => {
    const view = archivedViewOf({
      code: 'A_MEDI',
      closed_at: '2027-02-02T12:00:00+00:00',
      summary: { mode: 'peor_carta', seats: 'cuatro', turns: 12 },
    });
    expect(view.summary?.mode).toBe('peor_carta');
    expect(view.summary?.seats).toBeNull();
    expect(view.summary?.turns).toBe(12);
    expect(view.summary?.winnerName).toBeNull();
  });

  it('ausencia de summary (undefined) también queda sin romper', () => {
    const view = archivedViewOf({});
    expect(view.code).toBe('');
    expect(view.summary).toBeNull();
  });
});
