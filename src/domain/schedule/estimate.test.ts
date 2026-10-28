// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { estimateRoundTimes } from './estimate';

const timing = { tournamentStartISO: '2026-06-13T08:00:00.000Z', matchMinutes: 12, turnoverMinutes: 3, roundBreakMinutes: 10 };

describe('estimateRoundTimes', () => {
  it('rechnet vor der ersten Runde alle Runden ab Turnierstart hoch', () => {
    // 10 Teams, 2 Felder: 5 Spiele → 3 Wellen à 15 Minuten, Runde dauert 42 Minuten.
    const r = estimateRoundTimes({ roundsTotal: 3, timing, teamCount: 10, fieldCount: 2, known: [] });
    expect(r.map((x) => x.startISO)).toEqual([
      '2026-06-13T08:00:00.000Z',
      '2026-06-13T08:52:00.000Z',
      '2026-06-13T09:44:00.000Z',
    ]);
    expect(r[0]!.waveStartISOs).toEqual(['2026-06-13T08:00:00.000Z', '2026-06-13T08:15:00.000Z', '2026-06-13T08:30:00.000Z']);
    expect(r[0]!.endISO).toBe('2026-06-13T08:42:00.000Z');
    expect(r.every((x) => x.estimated)).toBe(true);
  });

  it('übernimmt echte Zeiten geplanter Runden und rechnet danach weiter', () => {
    const known = [
      {
        number: 1,
        plannedStartISO: '2026-06-13T08:20:00.000Z',
        matches: [
          { startISO: '2026-06-13T08:20:00.000Z', durationMinutes: 12 },
          { startISO: '2026-06-13T08:35:00.000Z', durationMinutes: 12 },
          { startISO: '2026-06-13T08:20:00.000Z', durationMinutes: 12 },
        ],
      },
    ];
    const r = estimateRoundTimes({ roundsTotal: 2, timing, teamCount: 6, fieldCount: 2, known });
    expect(r[0]).toEqual({
      number: 1,
      startISO: '2026-06-13T08:20:00.000Z',
      endISO: '2026-06-13T08:47:00.000Z',
      waveStartISOs: ['2026-06-13T08:20:00.000Z', '2026-06-13T08:35:00.000Z'],
      estimated: false,
    });
    expect(r[1]!.startISO).toBe('2026-06-13T08:57:00.000Z');
    expect(r[1]!.estimated).toBe(true);
  });

  it('nimmt mindestens die Wechselpause zwischen den Runden', () => {
    const r = estimateRoundTimes({ roundsTotal: 2, timing: { ...timing, roundBreakMinutes: 0 }, teamCount: 4, fieldCount: 2, known: [] });
    expect(r[1]!.startISO).toBe('2026-06-13T08:15:00.000Z');
  });
});
