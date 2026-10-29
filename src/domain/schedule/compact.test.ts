// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FORMAT_TEMPLATES } from '../format/templates';
import type { GroupStage, TournamentFormat } from '../format/types';
import {
  compactStagePlan,
  earlyStartHints,
  longerGroupOptions,
  longerGroupPlacements,
  type CompactMatch,
  type MatchPlacement,
} from './compact';
import { buildFormatSkeleton } from './skeleton';
import { planTournamentDay } from './stages';
import { checkStageSchedule } from './swap';
import { addMinutes } from './time';

const T0 = '2026-06-13T08:00:00.000Z';
const at = (min: number) => addMinutes(T0, min);

const template = (id: string): TournamentFormat => FORMAT_TEMPLATES.find((t) => t.id === id)!.build();

/** Ganzer Tag aus der Vorlage, Gruppenspiele mit echten Team-IDs. */
function dayOf(format: TournamentFormat, teams: number, fields: number): CompactMatch[] {
  const { matches } = buildFormatSkeleton(format, teams);
  const f = Array.from({ length: fields }, (_, i) => ({ id: `f${i + 1}`, name: `Platz ${i + 1}`, order: i, active: true }));
  const plan = planTournamentDay(format, matches, f, { tournamentStartISO: T0, matchMinutes: 12, turnoverMinutes: 3, roundBreakMinutes: 5 });
  const byId = new Map(plan.matches.map((p) => [p.matchId, p]));
  return matches.map((m) => {
    const p = byId.get(m.id)!;
    const team = (s: typeof m.slotA) => (s?.kind === 'team' ? s.teamId : undefined);
    return {
      id: m.id,
      stageId: m.stageId,
      groupIndex: m.groupIndex,
      matchKey: m.matchKey,
      teamAId: team(m.slotA),
      teamBId: team(m.slotB),
      slotA: m.slotA?.kind === 'team' ? undefined : m.slotA,
      slotB: m.slotB?.kind === 'team' ? undefined : m.slotB,
      fieldId: p.fieldId,
      startISO: p.startISO,
      waveIndex: p.waveIndex,
      durationMinutes: 12,
      status: 'scheduled',
    };
  });
}

function withdraw(matches: CompactMatch[], teamId: string): CompactMatch[] {
  return matches.map((m) => (m.teamAId === teamId || m.teamBId === teamId ? { ...m, status: 'not_played' } : m));
}

function apply(matches: CompactMatch[], moves: MatchPlacement[]): CompactMatch[] {
  const byId = new Map(moves.map((x) => [x.matchId, x]));
  return matches.map((m) => {
    const mv = byId.get(m.id);
    return mv ? { ...m, fieldId: mv.fieldId, startISO: mv.startISO, durationMinutes: mv.durationMinutes ?? m.durationMinutes } : m;
  });
}

const conflicts = (matches: CompactMatch[]) =>
  checkStageSchedule(
    matches
      .filter((m) => m.status !== 'not_played')
      .map((m) => ({ ...m, fieldId: m.fieldId!, startISO: m.startISO! })),
    { turnoverMinutes: 3 },
  ).filter((i) => i.kind !== 'rest');

/** Eine Gruppe mit 4 Teams auf einem Feld, Takt 15 Minuten; Team D ist ausgefallen. */
const oneGroup: TournamentFormat = {
  version: 1,
  tieBreakVariant: 'h2h_first',
  breakBeforeFinalsMinutes: 10,
  stages: [
    { id: 'v', kind: 'groups', name: 'Vorrunde', phase: 0, color: 'neutral', entry: null, groupCount: 1, doubleRoundRobin: false, draw: 'random', fixedFields: true },
  ],
};
const g = (id: string, a: string, b: string, min: number, status: CompactMatch['status'] = 'scheduled'): CompactMatch => ({
  id,
  stageId: 'v',
  groupIndex: 0,
  teamAId: a,
  teamBId: b,
  fieldId: 'f1',
  startISO: at(min),
  durationMinutes: 12,
  status,
});
const groupOfThree = [
  g('m1', 'A', 'B', 0),
  g('m2', 'C', 'D', 15, 'not_played'),
  g('m3', 'A', 'C', 30),
  g('m4', 'B', 'D', 45, 'not_played'),
  g('m5', 'A', 'D', 60, 'not_played'),
  g('m6', 'B', 'C', 75),
];
const opts = { format: oneGroup, nowISO: at(-60), turnoverMinutes: 3, desiredRestMinutes: 12 };

describe('Plan straffen', () => {
  it('zieht spätere Spiele in die Lücken, ohne neue Überschneidungen', () => {
    const res = compactStagePlan(groupOfThree, opts);
    expect(res.moves.map((m) => [m.matchId, m.startISO])).toEqual([
      ['m3', at(15)],
      ['m6', at(30)],
    ]);
    expect(res.oldEndISO).toBe(at(87));
    expect(res.newEndISO).toBe(at(42));
    // Pause wird nicht extra eingebaut: C spielt dann direkt hintereinander, mit Warnung.
    expect(res.restWarnings.some((w) => w.startsWith('C hat dann nur 3 Minuten Pause'))).toBe(true);
    expect(conflicts(apply(groupOfThree, res.moves))).toEqual([]);
  });

  it('lässt angepfiffene, beendete und von Hand gesetzte Spiele stehen', () => {
    const fixed = groupOfThree.map((m) => (m.id === 'm3' ? { ...m, manual: true } : m.id === 'm1' ? { ...m, status: 'completed' as const } : m));
    const res = compactStagePlan(fixed, opts);
    expect(res.moves.map((m) => m.matchId)).toEqual(['m6']);
    expect(res.moves[0]!.startISO).toBe(at(15));
  });

  it('füllt keine Lücken, die schon vorbei sind', () => {
    const res = compactStagePlan(groupOfThree, { ...opts, nowISO: at(50) });
    expect(res.moves.map((m) => [m.matchId, m.startISO])).toEqual([['m6', at(60)]]);
  });

  it('nimmt zuerst Teams, die da sind, und meldet die anderen', () => {
    // Lücke um 15 Uhr: A–C (A und C noch nicht abgehakt) oder B–C wären möglich.
    const res = compactStagePlan(groupOfThree, { ...opts, presentTeamIds: new Set(['A', 'B', 'C']) });
    expect(res.hints).toEqual([]);
    const hints = earlyStartHints(groupOfThree, [{ matchId: 'm6', startISO: at(15) }], new Set(['A']), new Map([['B', 'Blau']]));
    // B spielte schon um 0 Uhr, C hatte sein erstes Spiel um 15 Uhr: kein Hinweis.
    expect(hints).toEqual([]);
    const early = earlyStartHints(groupOfThree, [{ matchId: 'm3', startISO: at(0) }], new Set(['A']), new Map([['C', 'Cyan']]));
    expect(early.map((h) => h.message)).toEqual(['Cyan spielt dann früher als bisher geplant und ist vielleicht noch nicht da.']);
  });

  it('bevorzugt Spiele mit Teams, die als „ist da“ abgehakt sind', () => {
    // Zwei Kandidaten für die Lücke um 15: E–F (nicht abgehakt, erstes Spiel erst um 45) und G–H (abgehakt).
    const matches: CompactMatch[] = [
      { ...g('x1', 'A', 'B', 0), fieldId: 'f2' },
      { ...g('x2', 'C', 'D', 15, 'not_played'), stageId: 'v' },
      { ...g('x3', 'E', 'F', 45), fieldId: 'f1' },
      { ...g('x4', 'G', 'H', 60), fieldId: 'f1' },
    ];
    const format: TournamentFormat = { ...oneGroup, stages: [{ ...(oneGroup.stages[0] as GroupStage), fixedFields: false }] };
    const res = compactStagePlan(matches, { ...opts, format, presentTeamIds: new Set(['G', 'H']) });
    expect(res.moves[0]).toMatchObject({ matchId: 'x4', startISO: at(15) });
    expect(res.hints).toEqual([]);
    // Ohne Haken: das nächste Spiel rückt nach, mit Hinweis.
    const without = compactStagePlan(matches, { ...opts, format });
    expect(without.moves[0]).toMatchObject({ matchId: 'x3', startISO: at(15) });
    expect(without.hints.map((h) => h.teamId).sort()).toEqual(['E', 'F', 'G', 'H']);
  });

  it('16 Teams, ein Team fällt aus: Vorrunde kürzer, Endrunde rückt nach, alles ohne Überschneidung', () => {
    const day = dayOf(template('t16'), 16, 2);
    const out = withdraw(day, 'team1');
    const res = compactStagePlan(out, { format: template('t16'), nowISO: at(-1), turnoverMinutes: 3, desiredRestMinutes: 12 });
    expect(res.moves.length).toBeGreaterThan(0);
    expect(Date.parse(res.newEndISO!)).toBeLessThan(Date.parse(res.oldEndISO!));
    for (const mv of res.moves) expect(Date.parse(mv.startISO)).toBeLessThan(Date.parse(mv.fromStartISO));
    expect(conflicts(apply(out, res.moves))).toEqual([]);
    // Endrunde beginnt weiter erst nach der Vorrunde (mit Pause davor).
    const after = apply(out, res.moves).filter((m) => m.status !== 'not_played');
    const groupEnd = Math.max(...after.filter((m) => m.stageId === 'vorrunde').map((m) => Date.parse(m.startISO!) + 12 * 60_000));
    const finalsStart = Math.min(...after.filter((m) => m.stageId !== 'vorrunde').map((m) => Date.parse(m.startISO!)));
    expect(finalsStart).toBeGreaterThan(groupEnd);
  });

  it('alle Vorlagen, 1 oder 2 Ausfälle, 2 bis 4 Felder: nur nach vorne, keine Überschneidung, Phasen in Reihenfolge', () => {
    for (const id of ['t8', 't10', 't12', 't16', 't20']) {
      const format = template(id);
      const teams = FORMAT_TEMPLATES.find((t) => t.id === id)!.teamCount;
      for (const fields of [2, 3, 4]) {
        for (const out of [['team1'], ['team2', `team${teams}`]]) {
          let day = dayOf(format, teams, fields);
          for (const t of out) day = withdraw(day, t);
          const res = compactStagePlan(day, { format, nowISO: at(-1), turnoverMinutes: 3, desiredRestMinutes: 12 });
          for (const mv of res.moves) expect(Date.parse(mv.startISO)).toBeLessThan(Date.parse(mv.fromStartISO));
          const after = apply(day, res.moves);
          expect(conflicts(after), `${id}, ${fields} Felder, ohne ${out.join('+')}`).toEqual([]);
          expect(Date.parse(res.newEndISO!)).toBeLessThanOrEqual(Date.parse(res.oldEndISO!));
          const phase = new Map(format.stages.map((s) => [s.id, s.phase]));
          const live = after.filter((m) => m.status !== 'not_played');
          for (const p of [...new Set(phase.values())].filter((x) => x > 0)) {
            const prevEnd = Math.max(...live.filter((m) => phase.get(m.stageId)! < p).map((m) => Date.parse(m.startISO!) + m.durationMinutes * 60_000));
            const start = Math.min(...live.filter((m) => phase.get(m.stageId) === p).map((m) => Date.parse(m.startISO!)));
            expect(start).toBeGreaterThan(prevEnd);
          }
        }
      }
    }
  });

  it('bewegt nichts, wenn nichts ausgefallen ist', () => {
    const day = dayOf(template('t16'), 16, 2);
    expect(compactStagePlan(day, { format: template('t16'), nowISO: at(-1), turnoverMinutes: 3, desiredRestMinutes: 12 }).moves).toEqual([]);
  });
});

describe('Dreiergruppe spielt länger', () => {
  const groups = new Map([['v|0', ['A', 'B', 'C']]]);

  it('bietet die längere Spielzeit nur an, wenn jedes Spiel in die freie Zeit passt', () => {
    const [opt] = longerGroupOptions(groupOfThree, groups, { format: oneGroup, turnoverMinutes: 3 });
    expect(opt).toMatchObject({ stageId: 'v', groupIndex: 0, currentMinutes: 12, maxMinutes: 27, suggestedMinutes: 18 });
    expect(opt!.matchIds.sort()).toEqual(['m1', 'm3', 'm6']);
    const longer = apply(groupOfThree, longerGroupPlacements(groupOfThree, opt!, 18));
    expect(longer.filter((m) => m.status === 'scheduled').map((m) => m.durationMinutes)).toEqual([18, 18, 18]);
    expect(conflicts(longer)).toEqual([]);
  });

  it('bietet nichts an, wenn ein Spiel direkt auf das nächste folgt', () => {
    const tight = groupOfThree.map((m) => (m.id === 'm3' ? { ...m, startISO: at(15) } : m.id === 'm2' ? { ...m, startISO: at(30) } : m));
    expect(longerGroupOptions(tight, groups, { format: oneGroup, turnoverMinutes: 3 })).toEqual([]);
  });

  it('nur für Gruppen mit genau 3 Teams', () => {
    expect(longerGroupOptions(groupOfThree, new Map([['v|0', ['A', 'B', 'C', 'D']]]), { format: oneGroup, turnoverMinutes: 3 })).toEqual([]);
  });

  it('beim Straffen bleiben die länger spielenden Spiele stehen', () => {
    const [opt] = longerGroupOptions(groupOfThree, groups, { format: oneGroup, turnoverMinutes: 3 });
    const longer = apply(groupOfThree, longerGroupPlacements(groupOfThree, opt!, 18));
    const res = compactStagePlan(longer, { ...opts, keepIds: new Set(opt!.matchIds) });
    expect(res.moves).toEqual([]);
  });
});
