// @vitest-environment node
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FORMAT_TEMPLATES } from '../format/templates';
import type { KnockoutStage, TournamentFormat } from '../format/types';
import { buildFormatSkeleton, evenGroupSizes, previewFormat, roundRobinRounds } from './skeleton';
import { planTournamentDay, sideKeys, type DayPlan, type DayPlanConstraints, type StageMatchToPlan } from './stages';
import { checkStageSchedule, type EditableMatch } from './swap';
import { minutesBetween } from './time';
import type { ScheduleField } from './types';

const fieldsOf = (n: number): ScheduleField[] =>
  Array.from({ length: n }, (_, i) => ({ id: `f${i + 1}`, name: `Platz ${String.fromCharCode(65 + i)}`, order: i, active: true }));

const constraints = (over: Partial<DayPlanConstraints> = {}): DayPlanConstraints => ({
  tournamentStartISO: '2026-06-13T08:00:00.000Z',
  matchMinutes: 12,
  turnoverMinutes: 3,
  roundBreakMinutes: 5,
  ...over,
});

const template = (id: string): TournamentFormat => FORMAT_TEMPLATES.find((t) => t.id === id)!.build();

/** Plan zurück in bearbeitbare Spiele, um ihn mit der Prüfung der Handänderungen zu prüfen. */
function editable(plan: DayPlan, matches: readonly StageMatchToPlan[]): EditableMatch[] {
  const byId = new Map(matches.map((m) => [m.id, m]));
  return plan.matches.map((p) => {
    const m = byId.get(p.matchId)!;
    return { ...m, fieldId: p.fieldId, startISO: p.startISO, durationMinutes: minutesBetween(p.startISO, p.endISO) };
  });
}

function planOf(format: TournamentFormat, teams: number, fields: number, over: Partial<DayPlanConstraints> = {}) {
  const { matches } = buildFormatSkeleton(format, teams);
  const plan = planTournamentDay(format, matches, fieldsOf(fields), constraints(over));
  return { matches, plan };
}

describe('Spielgerüst und Vorschau beim Anlegen', () => {
  it('verteilt Gruppen gleichmäßig und erzeugt jeder gegen jeden', () => {
    expect(evenGroupSizes(18, 4)).toEqual([5, 5, 4, 4]);
    expect(evenGroupSizes(16, 4)).toEqual([4, 4, 4, 4]);
    for (const n of [2, 3, 4, 5, 6, 7]) {
      const rounds = roundRobinRounds(n);
      const pairs = rounds.flat().map(([a, b]) => [Math.min(a, b), Math.max(a, b)].join('-'));
      expect(new Set(pairs).size).toBe((n * (n - 1)) / 2);
      expect(pairs).toHaveLength((n * (n - 1)) / 2);
      for (const r of rounds) expect(new Set(r.flat()).size).toBe(r.length * 2);
    }
    expect(roundRobinRounds(4, true).flat()).toHaveLength(12);
  });

  it('zählt Spiele und Spiele pro Team für Phils Vorlagen', () => {
    const f = fieldsOf(4);
    const c = constraints();
    const t8 = previewFormat(template('t8'), 8, f, c);
    expect(t8.matchCount).toBe(12 + 4 + 2); // 2 Gruppen zu 4, Halbfinale + Finale + Platz 3, Platz 5 und 7
    expect(t8.gamesPerTeam).toEqual({ min: 4, max: 5 });
    const t12 = previewFormat(template('t12'), 12, f, c);
    expect(t12.matchCount).toBe(18 + 8); // Viertelfinale, Halbfinale, Finale, Platz 3
    expect(t12.gamesPerTeam).toEqual({ min: 3, max: 6 }); // Vierte fahren heim
    const t16 = previewFormat(template('t16'), 16, f, c);
    expect(t16.matchCount).toBe(24 + 8 + 8);
    expect(t16.gamesPerTeam).toEqual({ min: 4, max: 6 });
    const t20 = previewFormat(template('t20'), 20, f, c);
    expect(t20.matchCount).toBe(40 + 16);
    expect(t20.gamesPerTeam).toEqual({ min: 4, max: 7 }); // Fünfte: nur Vorrunde
    for (const p of [t8, t12, t16, t20]) {
      expect(p.problems).toEqual([]);
      expect(p.lastEndISO).toBeDefined();
      expect(p.stages.every((s) => s.startISO && s.endISO)).toBe(true);
    }
    expect(t16.stages.map((s) => s.teamCount)).toEqual([16, 8, 8]);
  });

  it('K.-o. mit allen Plätzen: jedes Team spielt gleich oft', () => {
    const format: TournamentFormat = {
      version: 1,
      tieBreakVariant: 'h2h_first',
      breakBeforeFinalsMinutes: 10,
      stages: [
        { ...(template('t8').stages[0]! as Extract<TournamentFormat['stages'][number], { kind: 'groups' }>), groupCount: 2 },
        { ...(template('t8').stages[1] as KnockoutStage), size: 8, allPlaces: true, entry: { fromStageId: 'vorrunde', places: [1, 2, 3, 4] } },
      ],
    };
    const p = previewFormat(format, 8, fieldsOf(4), constraints());
    expect(p.matchCount).toBe(12 + 12);
    expect(p.gamesPerTeam).toEqual({ min: 6, max: 6 });
  });
});

describe('Ganzen Turniertag planen', () => {
  it('16 Teams, 4 Felder: Gruppen auf festen Feldern, Pause vor der Endrunde, K.-o. in Reihenfolge', () => {
    const format = template('t16');
    const { matches, plan } = planOf(format, 16, 4);
    expect(plan.problems).toEqual([]);
    expect(plan.matches).toHaveLength(matches.length);
    const vorrunde = plan.matches.filter((p) => p.stageId === 'vorrunde');
    for (let g = 0; g < 4; g++) {
      const ids = new Set(matches.filter((m) => m.groupIndex === g).map((m) => m.id));
      expect(new Set(vorrunde.filter((p) => ids.has(p.matchId)).map((p) => p.fieldId))).toEqual(new Set([`f${g + 1}`]));
    }
    const [p0, p1] = plan.phases;
    expect(minutesBetween(p0!.endISO, p1!.startISO)).toBeGreaterThanOrEqual(format.breakBeforeFinalsMinutes);
    // Gold und Silber laufen nebeneinander (teilen sich die Felder).
    const gold = plan.stages.find((s) => s.stageId === 'gold')!;
    const silber = plan.stages.find((s) => s.stageId === 'silber')!;
    expect(Date.parse(silber.startISO)).toBeLessThan(Date.parse(gold.endISO));
    expect(Date.parse(gold.startISO)).toBeLessThan(Date.parse(silber.endISO));
    const at = (stage: string, key: string) => {
      const id = matches.find((m) => m.stageId === stage && m.matchKey === key)!.id;
      return plan.matches.find((p) => p.matchId === id)!;
    };
    for (const stage of ['gold', 'silber']) {
      for (const sf of ['SF1', 'SF2']) {
        for (const qf of ['QF1', 'QF2', 'QF3', 'QF4']) {
          expect(Date.parse(at(stage, sf).startISO)).toBeGreaterThanOrEqual(Date.parse(at(stage, qf).endISO));
        }
        expect(Date.parse(at(stage, 'F').startISO)).toBeGreaterThanOrEqual(Date.parse(at(stage, sf).endISO));
      }
      // Das Finale ist das letzte Spiel seines Abschnitts.
      expect(Date.parse(at(stage, 'F').startISO)).toBeGreaterThanOrEqual(Date.parse(at(stage, 'P3').startISO));
    }
    expect(checkStageSchedule(editable(plan, matches), { turnoverMinutes: 3 }).filter((i) => i.kind !== 'rest')).toEqual([]);
  });

  it('Spieldauer je Abschnitt und Pause vor der Endrunde werden beachtet', () => {
    const format = template('t8');
    format.stages[1] = { ...format.stages[1]!, matchMinutes: 20 };
    format.breakBeforeFinalsMinutes = 30;
    const { plan } = planOf(format, 8, 2);
    for (const p of plan.matches.filter((x) => x.stageId === 'endrunde')) expect(minutesBetween(p.startISO, p.endISO)).toBe(20);
    for (const p of plan.matches.filter((x) => x.stageId === 'vorrunde')) expect(minutesBetween(p.startISO, p.endISO)).toBe(12);
    expect(minutesBetween(plan.phases[0]!.endISO, plan.phases[1]!.startISO)).toBe(30);
  });

  it('zu wenig Felder für feste Gruppenfelder: Hinweis, trotzdem alles geplant', () => {
    const { matches, plan } = planOf(template('t16'), 16, 3);
    expect(plan.warnings.join()).toMatch(/feste Gruppenfelder fehlen Felder/);
    expect(plan.problems).toEqual([]);
    expect(plan.matches).toHaveLength(matches.length);
  });

  it('meldet fehlende Felder', () => {
    const { matches } = buildFormatSkeleton(template('t8'), 8);
    expect(planTournamentDay(template('t8'), matches, [], constraints()).problems[0]).toMatch(/kein aktives Spielfeld/);
  });

  it('gleichmäßige Pausen: wer am längsten gewartet hat, spielt zuerst', () => {
    // Gruppe mit 5 Teams auf einem Feld: 10 Spiele, niemand muss zweimal hintereinander ran.
    const format: TournamentFormat = {
      version: 1,
      tieBreakVariant: 'h2h_first',
      breakBeforeFinalsMinutes: 10,
      stages: [{ id: 'liga', kind: 'groups', name: 'Liga', phase: 0, color: 'neutral', entry: null, groupCount: 1, doubleRoundRobin: false, draw: 'random', fixedFields: false }],
    };
    const { plan } = planOf(format, 5, 1);
    expect(plan.matches).toHaveLength(10);
    expect(plan.restWarnings).toEqual([]);
  });

  it('Handänderungen und angepfiffene Spiele bleiben bei einer Neuberechnung stehen', () => {
    const format = template('t8');
    const { matches, plan } = planOf(format, 8, 2);
    const first = plan.matches[0]!;
    const moved = plan.matches.find((p) => p.stageId === 'endrunde')!;
    const late = '2026-06-13T15:00:00.000Z';
    const input: StageMatchToPlan[] = matches.map((m) =>
      m.id === first.matchId
        ? { ...m, status: 'completed', fieldId: first.fieldId, startISO: first.startISO }
        : m.id === moved.matchId
          ? { ...m, manual: true, fieldId: 'f2', startISO: late }
          : m,
    );
    const again = planTournamentDay(format, input, fieldsOf(2), constraints());
    const a = again.matches.find((p) => p.matchId === first.matchId)!;
    const b = again.matches.find((p) => p.matchId === moved.matchId)!;
    expect([a.startISO, a.fieldId, a.kept]).toEqual([first.startISO, first.fieldId, true]);
    expect([b.startISO, b.fieldId, b.kept]).toEqual([late, 'f2', true]);
    expect(again.matches).toHaveLength(matches.length);
    expect(checkStageSchedule(editable(again, input), { turnoverMinutes: 3 }).filter((i) => i.kind === 'field')).toEqual([]);
  });

  it('Eigenschaft: alle Vorlagen auf 1–8 Feldern ohne Doppelbelegung, K.-o. immer nach dem Vorgänger', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...FORMAT_TEMPLATES),
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 6, max: 20 }),
        fc.integer({ min: 0, max: 5 }),
        fc.boolean(),
        (t, fields, matchMinutes, turnoverMinutes, fixedFields) => {
          const format = t.build();
          format.stages = format.stages.map((s) => (s.kind === 'groups' ? { ...s, fixedFields } : s));
          const { matches, plan } = planOf(format, t.teamCount, fields, { matchMinutes, turnoverMinutes });
          expect(plan.problems).toEqual([]);
          expect(plan.matches).toHaveLength(matches.length);
          const issues = checkStageSchedule(editable(plan, matches), { turnoverMinutes });
          expect(issues.filter((i) => i.kind !== 'rest')).toEqual([]);
          // Jede Phase beginnt erst nach der vorigen.
          for (let i = 1; i < plan.phases.length; i++) {
            expect(Date.parse(plan.phases[i]!.startISO)).toBeGreaterThan(Date.parse(plan.phases[i - 1]!.endISO));
          }
          // Kein Teilnehmer zweimal in derselben Welle.
          const byWave = new Map<number, string[]>();
          for (const p of plan.matches) {
            const m = matches.find((x) => x.id === p.matchId)!;
            byWave.set(p.waveIndex, [...(byWave.get(p.waveIndex) ?? []), ...sideKeys(m)]);
          }
          for (const keys of byWave.values()) expect(new Set(keys).size).toBe(keys.length);
        },
      ),
      { numRuns: 60 },
    );
  });
});
