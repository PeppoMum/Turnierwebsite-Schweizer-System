// @vitest-environment node
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { simulateTournament } from '../pairing/testing/simulate';
import { solveAssignment } from './assignment';
import { createWaveSchedule, planWaves, restSummary, roundMinutes, waveSizes, wavesPerRound } from './plan';
import { previewShift } from './shift';
import { formatLocalTime, minutesBetween, timeZoneOffsetMinutes, zonedLocalToISO } from './time';
import type { RoundToSchedule, ScheduleConstraints, ScheduleField, TimedMatch } from './types';
import { validateSchedule } from './validate';

const fieldsOf = (n: number): ScheduleField[] =>
  Array.from({ length: n }, (_, i) => ({ id: `f${i + 1}`, name: `Platz ${String.fromCharCode(65 + i)}`, order: i, active: true }));

const constraints = (over: Partial<ScheduleConstraints> = {}): ScheduleConstraints => ({
  tournamentStartISO: '2026-06-13T08:00:00.000Z',
  matchMinutes: 12,
  turnoverMinutes: 3,
  roundBreakMinutes: 0,
  allocation: 'balanced_waves',
  ...over,
});

function roundsFrom(seed: string, teams: number, rounds: number): RoundToSchedule[] {
  const sim = simulateTournament({ teams, rounds, preDrawRounds: 2, seed });
  return sim.plans.map((p) => ({
    roundNumber: p.roundNumber,
    matches: p.pairings.map((m, i) => ({ id: `r${p.roundNumber}m${i}`, teamAId: m.teamAId, teamBId: m.teamBId })),
  }));
}

const timed = (plan: ReturnType<typeof createWaveSchedule>, duration = 12): TimedMatch[] =>
  plan.matches.map((m) => ({
    id: m.matchId,
    teamAId: m.teamAId,
    teamBId: m.teamBId,
    fieldId: m.fieldId,
    startISO: m.startISO,
    durationMinutes: duration,
    roundNumber: m.roundNumber,
  }));

describe('Wellen', () => {
  it('berechnet Wellengrößen nach Auslastungsmodus (§8.1)', () => {
    expect(waveSizes(8, 4, 'max_capacity')).toEqual([4, 4]);
    expect(waveSizes(8, 4, 'balanced_waves')).toEqual([4, 4]);
    expect(waveSizes(8, 5, 'max_capacity')).toEqual([5, 3]);
    expect(waveSizes(8, 5, 'balanced_waves')).toEqual([4, 4]);
    expect(waveSizes(9, 4, 'max_capacity')).toEqual([4, 4, 1]);
    expect(waveSizes(9, 4, 'balanced_waves')).toEqual([3, 3, 3]);
    expect(waveSizes(7, 8, 'balanced_waves')).toEqual([7]);
    expect(waveSizes(0, 4, 'max_capacity')).toEqual([]);
  });

  it('16 Teams, 4 Felder: 8 Spiele in 2 Wellen, Anstoß im Takt Spielzeit + Wechselpause', () => {
    const plan = createWaveSchedule(roundsFrom('w', 16, 2), fieldsOf(4), constraints({ roundBreakMinutes: 10 }));
    expect(plan.problems).toEqual([]);
    expect(plan.rounds).toHaveLength(2);
    const [r1, r2] = plan.rounds;
    expect(r1!.waves.map((w) => w.matchIds.length)).toEqual([4, 4]);
    expect(r1!.waves[0]!.startISO).toBe('2026-06-13T08:00:00.000Z');
    expect(r1!.waves[1]!.startISO).toBe('2026-06-13T08:15:00.000Z');
    expect(r1!.endISO).toBe('2026-06-13T08:27:00.000Z');
    expect(r2!.startISO).toBe('2026-06-13T08:37:00.000Z'); // Ende + 10 Min Rundenpause
    expect(validateSchedule(timed(plan), { turnoverMinutes: 3 }).conflicts).toEqual([]);
  });

  it('16 Teams, 5 Felder: 5 + 3 oder 4 + 4, ungenutztes Feld wird gemeldet', () => {
    const rounds = roundsFrom('f5', 16, 1);
    const max = createWaveSchedule(rounds, fieldsOf(5), constraints({ allocation: 'max_capacity' }));
    expect(max.rounds[0]!.waves.map((w) => w.matchIds.length)).toEqual([5, 3]);
    const balanced = createWaveSchedule(rounds, fieldsOf(5), constraints({ allocation: 'balanced_waves' }));
    expect(balanced.rounds[0]!.waves.map((w) => w.matchIds.length)).toEqual([4, 4]);
    expect(balanced.warnings.join()).toMatch(/Nicht genutzte Felder: Platz E/);
  });

  it('ändert die Paarungen nie und benutzt nur aktive Felder in Reihenfolge', () => {
    const rounds = roundsFrom('keep', 14, 3);
    const fields = [...fieldsOf(4), { id: 'zu', name: 'Gesperrt', order: 0, active: false }];
    const plan = createWaveSchedule(rounds, fields, constraints());
    for (const r of rounds) {
      for (const m of r.matches) {
        const s = plan.matches.find((x) => x.matchId === m.id)!;
        expect([s.teamAId, s.teamBId]).toEqual([m.teamAId, m.teamBId]);
        expect(s.fieldId).not.toBe('zu');
      }
    }
    expect(plan.matches).toHaveLength(rounds.reduce((n, r) => n + r.matches.length, 0));
  });

  it('meldet fehlende Felder und zu früh gesetzte Rundenstarts', () => {
    expect(createWaveSchedule(roundsFrom('x', 6, 1), [], constraints()).problems[0]).toMatch(/kein aktives Spielfeld/);
    const rounds = roundsFrom('x', 8, 2);
    rounds[1] = { ...rounds[1]!, startISO: '2026-06-13T08:13:00.000Z' }; // Runde 1 endet 08:12, Wechsel 3 Min
    const plan = createWaveSchedule(rounds, fieldsOf(4), constraints());
    expect(plan.problems[0]).toMatch(/Runde 2 soll beginnen, bevor Runde 1/);
  });
});

describe('Pausen', () => {
  it('Optimierung vermeidet „letzte Welle → erste Welle“ besser als die naive Reihenfolge', () => {
    let optimized = 0;
    let naive = 0;
    for (let s = 0; s < 25; s++) {
      const rounds = roundsFrom(`rest-${s}`, 16, 8);
      const plan = createWaveSchedule(rounds, fieldsOf(4), constraints({ desiredRestMinutes: 12 }));
      // naive: Spiele einfach in Paarungsreihenfolge auf die Wellen legen
      const naivePlan = createWaveSchedule(rounds, fieldsOf(4), constraints({ desiredRestMinutes: 0, evenRest: false }));
      const o = restSummary(plan).backToBack;
      const n = restSummary(naivePlan).backToBack;
      expect(o).toBeLessThanOrEqual(n);
      optimized += o;
      naive += n;
      // Jede gemeldete Pausenwarnung entspricht einer echten zu kurzen Pause
      for (const w of plan.restWarnings) expect(w.restMinutes).toBeLessThan(12);
    }
    // Viele Übergänge sind durch die Paarungen erzwungen; vermeidbare werden vermieden.
    expect(optimized).toBeLessThan(naive);
  });

  it('gleicht die Pausen aller Teams an (evenRest, Standard)', () => {
    // Pausen je Team und Übergang, in Minuten.
    const rests = (plan: ReturnType<typeof createWaveSchedule>): number[] => {
      const byTeam = new Map<string, { startISO: string; endISO: string }[]>();
      for (const m of plan.matches) for (const t of [m.teamAId, m.teamBId]) byTeam.set(t, [...(byTeam.get(t) ?? []), m]);
      const out: number[] = [];
      for (const list of byTeam.values()) {
        list.sort((a, b) => Date.parse(a.startISO) - Date.parse(b.startISO));
        for (let i = 1; i < list.length; i++) out.push(minutesBetween(list[i - 1]!.endISO, list[i]!.startISO));
      }
      return out;
    };
    const stats = (xs: number[]) => {
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      return {
        mean,
        spread: Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length),
        worst: Math.max(...xs.map((x) => Math.abs(x - mean))),
      };
    };
    const sum = { even: { spread: 0, worst: 0 }, plain: { spread: 0, worst: 0 } };
    for (let s = 0; s < 10; s++) {
      for (const [teams, fields] of [[16, 4], [24, 4], [20, 3], [30, 4], [15, 2]] as const) {
        const rounds = roundsFrom(`even-${s}-${teams}`, teams, 7);
        const even = stats(rests(createWaveSchedule(rounds, fieldsOf(fields), constraints())));
        const plain = stats(rests(createWaveSchedule(rounds, fieldsOf(fields), constraints({ evenRest: false }))));
        // Ohne Freilos hängt der Durchschnitt nur vom Format ab, nicht von der Verteilung.
        if (teams % 2 === 0) expect(Math.abs(even.mean - plain.mean)).toBeLessThan(1e-9);
        sum.even.spread += even.spread;
        sum.even.worst += even.worst;
        sum.plain.spread += plain.spread;
        sum.plain.worst += plain.worst;
      }
    }
    expect(sum.even.spread).toBeLessThan(sum.plain.spread);
    expect(sum.even.worst).toBeLessThan(sum.plain.worst * 0.9);
  });

  it('warnt mit Teamnamen, wenn das weiche Pausenziel nicht erreichbar ist', () => {
    const rounds: RoundToSchedule[] = [
      { roundNumber: 1, matches: [{ id: 'a', teamAId: 'A', teamBId: 'B' }, { id: 'b', teamAId: 'C', teamBId: 'D' }] },
      { roundNumber: 2, matches: [{ id: 'c', teamAId: 'A', teamBId: 'C' }, { id: 'd', teamAId: 'B', teamBId: 'D' }] },
    ];
    const plan = createWaveSchedule(rounds, fieldsOf(1), constraints({ desiredRestMinutes: 20 }), {
      teamNames: new Map([['A', 'FC Adler']]),
    });
    expect(plan.restWarnings.length).toBeGreaterThan(0);
    expect(plan.restWarnings.some((w) => w.message.includes('FC Adler'))).toBe(true);
    expect(plan.restWarnings.every((w) => !w.hard)).toBe(true);
  });

  it('harte Mindestpause verschiebt den Rundenstart und wird nie still ignoriert', () => {
    const rounds = roundsFrom('hart', 16, 4);
    const plan = createWaveSchedule(rounds, fieldsOf(4), constraints({ optionalHardRestMinutes: 20 }));
    expect(restSummary(plan).minRestMinutes).toBeGreaterThanOrEqual(20);
    expect(plan.restWarnings.filter((w) => w.hard)).toEqual([]);
    const shifted = plan.rounds.filter((r) => r.startShiftedByMinutes > 0);
    expect(shifted.length).toBeGreaterThan(0);
    expect(plan.warnings.join()).toMatch(/harte Mindestpause von 20 Minuten/);
    expect(validateSchedule(timed(plan), { turnoverMinutes: 3 }).conflicts).toEqual([]);
  });

  it('berücksichtigt Spielende vor dem Planungsfenster', () => {
    const rounds: RoundToSchedule[] = [
      { roundNumber: 3, matches: [{ id: 'x', teamAId: 'A', teamBId: 'B' }, { id: 'y', teamAId: 'C', teamBId: 'D' }] },
    ];
    const plan = createWaveSchedule(rounds, fieldsOf(1), constraints({ tournamentStartISO: '2026-06-13T09:00:00.000Z' }), {
      teamLastEndISO: { A: '2026-06-13T08:58:00.000Z', B: '2026-06-13T08:58:00.000Z' },
    });
    // A/B haben gerade gespielt → sie kommen in die zweite Welle
    expect(plan.matches.find((m) => m.matchId === 'x')!.waveIndex).toBe(1);
  });
});

describe('Kollisionsprüfung und Verschiebung', () => {
  const base: TimedMatch[] = [
    { id: 'm1', teamAId: 'A', teamBId: 'B', fieldId: 'f1', startISO: '2026-06-13T08:00:00.000Z', durationMinutes: 12, status: 'completed', roundNumber: 1 },
    { id: 'm2', teamAId: 'C', teamBId: 'D', fieldId: 'f1', startISO: '2026-06-13T08:15:00.000Z', durationMinutes: 12, status: 'live', roundNumber: 1 },
    { id: 'm3', teamAId: 'A', teamBId: 'C', fieldId: 'f1', startISO: '2026-06-13T08:30:00.000Z', durationMinutes: 12, status: 'scheduled', roundNumber: 2 },
    { id: 'm4', teamAId: 'B', teamBId: 'D', fieldId: 'f2', startISO: '2026-06-13T08:30:00.000Z', durationMinutes: 12, status: 'scheduled', roundNumber: 2 },
  ];

  it('erkennt doppelt belegte Felder, zu kurze Wechselpausen und Teams in zwei Spielen', () => {
    const v = validateSchedule(
      [
        ...base,
        { id: 'm5', teamAId: 'A', teamBId: 'E', fieldId: 'f3', startISO: '2026-06-13T08:35:00.000Z', durationMinutes: 12 },
        { id: 'm6', teamAId: 'F', teamBId: 'G', fieldId: 'f2', startISO: '2026-06-13T08:43:00.000Z', durationMinutes: 12 },
      ],
      { turnoverMinutes: 3, fieldNames: new Map([['f2', 'Platz B']]) },
    );
    expect(v.conflicts.map((c) => c.kind).sort()).toEqual(['field', 'team']);
    expect(v.conflicts.find((c) => c.kind === 'field')!.message).toMatch(/Platz B: nur 1 Minuten Wechselpause/);
    expect(validateSchedule(base, { turnoverMinutes: 3 }).conflicts).toEqual([]);
  });

  it('+20 Minuten: nur noch nicht begonnene Spiele verschieben sich (Akzeptanzkriterium H)', () => {
    const preview = previewShift(base, 20, { turnoverMinutes: 3 });
    expect(preview.changes.map((c) => c.matchId)).toEqual(['m3', 'm4']);
    expect(preview.unchangedMatchIds).toEqual(['m1', 'm2']);
    expect(preview.matches.find((m) => m.id === 'm3')!.startISO).toBe('2026-06-13T08:50:00.000Z');
    expect(preview.matches.find((m) => m.id === 'm2')!.startISO).toBe(base[1]!.startISO);
    expect(preview.validation.conflicts).toEqual([]);
    expect(base[2]!.startISO).toBe('2026-06-13T08:30:00.000Z'); // Eingabe unverändert
  });

  it('Vorziehen in ein laufendes Spiel wird als Kollision gemeldet', () => {
    const preview = previewShift(base, -10, { turnoverMinutes: 3 });
    expect(preview.validation.conflicts.some((c) => c.kind === 'field')).toBe(true);
  });

  it('kann auf spätere Runden beschränkt werden', () => {
    const preview = previewShift(base, 5, { fromRoundNumber: 3 });
    expect(preview.changes).toEqual([]);
  });
});

describe('Zeitzone und Sommerzeit', () => {
  it('rechnet lokale Berliner Zeit in Sommer und Winter korrekt um', () => {
    expect(zonedLocalToISO('2026-06-13', '10:00', 'Europe/Berlin')).toBe('2026-06-13T08:00:00.000Z');
    expect(zonedLocalToISO('2026-12-05', '10:00', 'Europe/Berlin')).toBe('2026-12-05T09:00:00.000Z');
    expect(timeZoneOffsetMinutes(Date.parse('2026-06-13T08:00:00Z'), 'Europe/Berlin')).toBe(120);
  });

  it('behandelt Lücke und doppelte Stunde der Umstellung', () => {
    // 29.03.2026: 02:30 gibt es nicht → 03:30 Sommerzeit
    expect(zonedLocalToISO('2026-03-29', '02:30', 'Europe/Berlin')).toBe('2026-03-29T01:30:00.000Z');
    // 25.10.2026: 02:30 gibt es zweimal → erstes Vorkommen (Sommerzeit)
    expect(zonedLocalToISO('2026-10-25', '02:30', 'Europe/Berlin')).toBe('2026-10-25T00:30:00.000Z');
  });

  it('ein Plan über die Zeitumstellung hinweg behält exakte Abstände', () => {
    const rounds = roundsFrom('dst', 8, 4);
    const start = zonedLocalToISO('2026-10-25', '01:45', 'Europe/Berlin');
    const plan = createWaveSchedule(rounds, fieldsOf(4), constraints({ tournamentStartISO: start, matchMinutes: 30, turnoverMinutes: 0 }));
    const starts = plan.rounds.map((r) => r.startISO);
    for (let i = 1; i < starts.length; i++) expect(minutesBetween(starts[i - 1]!, starts[i]!)).toBe(30);
    // Lokal: 01:45, 02:15, 02:45 (Sommerzeit), dann 02:15 (Winterzeit)
    expect(starts.map((s) => formatLocalTime(s, 'Europe/Berlin'))).toEqual(['01:45', '02:15', '02:45', '02:15']);
  });
});

describe('Zuordnungsverfahren', () => {
  it('findet das Kostenminimum (Vergleich mit vollständiger Suche)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 7 }).chain((n) =>
          fc.array(fc.array(fc.integer({ min: 0, max: 100 }), { minLength: n, maxLength: n }), { minLength: n, maxLength: n }),
        ),
        (cost) => {
          const n = cost.length;
          const perm = solveAssignment(cost);
          expect(new Set(perm).size).toBe(n);
          const total = perm.reduce((s, j, i) => s + cost[i]![j]!, 0);
          let best = Infinity;
          const go = (i: number, used: number, acc: number) => {
            if (i === n) best = Math.min(best, acc);
            else for (let j = 0; j < n; j++) if (!(used & (1 << j))) go(i + 1, used | (1 << j), acc + cost[i]![j]!);
          };
          go(0, 0, 0);
          expect(total).toBe(best);
        },
      ),
      { numRuns: 300, seed: 3 },
    );
  });
});

describe('Eigenschaften zufälliger Spielpläne', () => {
  it('nie doppelt belegte Felder oder Teams, Wellenzahl minimal', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 40 }),
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 8 }),
        fc.constantFrom<ScheduleConstraints['allocation']>('max_capacity', 'balanced_waves'),
        fc.option(fc.integer({ min: 0, max: 40 }), { nil: undefined }),
        fc.string({ maxLength: 5 }),
        (teams, roundCount, fieldCount, allocation, hardRest, seed) => {
          const rounds = roundsFrom(`p${seed}`, teams, roundCount);
          const c = constraints({ allocation, matchMinutes: 10, turnoverMinutes: 2, roundBreakMinutes: 5 });
          if (hardRest !== undefined) c.optionalHardRestMinutes = hardRest;
          const plan = createWaveSchedule(rounds, fieldsOf(fieldCount), c);
          expect(plan.problems).toEqual([]);
          expect(validateSchedule(timed(plan, 10), { turnoverMinutes: 2 }).conflicts).toEqual([]);
          for (const r of plan.rounds) {
            const matches = rounds.find((x) => x.roundNumber === r.roundNumber)!.matches.length;
            expect(r.waves.length).toBe(Math.ceil(matches / fieldCount));
            for (const w of r.waves) expect(w.matchIds.length).toBeLessThanOrEqual(fieldCount);
          }
          if (hardRest !== undefined) {
            const summary = restSummary(plan);
            if (Number.isFinite(summary.minRestMinutes)) expect(summary.minRestMinutes).toBeGreaterThanOrEqual(hardRest);
          }
        },
      ),
      { numRuns: 100, seed: 11 },
    );
  }, 120_000);
});

describe('Einfache Vorschau (planWaves, roundMinutes)', () => {
  it('verteilt wie die echte Planung auf Wellen und Felder', () => {
    const plan = planWaves(8, ['a', 'b', 'c', 'd', 'e'], '2026-06-13T08:00:00.000Z', 12, 3, 'max_capacity');
    expect(plan.map((p) => p.waveIndex)).toEqual([0, 0, 0, 0, 0, 1, 1, 1]);
    expect(plan[5]).toEqual({ fieldId: 'a', waveIndex: 1, startISO: '2026-06-13T08:15:00.000Z' });
    expect(planWaves(8, ['a', 'b', 'c', 'd', 'e'], '2026-06-13T08:00:00.000Z', 12, 3, 'balanced_waves').filter((p) => p.waveIndex === 0)).toHaveLength(4);
    expect(wavesPerRound(16, 4)).toBe(2);
    expect(roundMinutes(16, 4, 12, 3)).toBe(27);
  });
});
