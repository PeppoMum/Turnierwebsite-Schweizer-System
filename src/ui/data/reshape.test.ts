import { describe, expect, it } from 'vitest';
import { FORMAT_TEMPLATES } from '../../domain/format';
import { currentEndISO, reshapeOptions, type ReshapeOption } from '../screens/admin/stages/reshape';
import { planCreation, toPlannedMatches } from '../screens/wizard/plan';
import { createFixtures } from './fixtures';
import { describeHistory } from './history';
import { MockTournamentStore } from './mockStore';
import type { WizardDraft } from './types';
import { undoChecks } from './undo';

const TID = 'sommercup';

/** Sommercup vor dem ersten Anpfiff: alle Spiele noch geplant. */
function beforeKickoff() {
  const fixtures = createFixtures();
  const d = fixtures.find((x) => x.tournament.id === TID)!;
  d.tournament.status = 'published';
  for (const m of d.matches) {
    m.status = 'scheduled';
    delete m.goalsA;
    delete m.goalsB;
    delete m.completedAt;
  }
  return new MockTournamentStore(fixtures, false);
}

describe('Turnier umstellen', () => {
  it('vor dem Anpfiff: Lücke lassen, Spiele der anderen bleiben zu ihrer Zeit, rückgängig stellt alles wieder her', async () => {
    const s = beforeKickoff();
    const before = structuredClone(s.get(TID)!);
    const missing = before.groupDraws![0]!.groups[1]![3]!;
    const options = reshapeOptions(before, [missing]);
    expect(options.map((o) => o.suggestion.kind)).toEqual(['gap']);
    const gap = options[0]!;
    expect(gap.problems).toEqual([]);
    expect(gap.earlyTeamIds).toEqual([]);

    await s.reshapeTournament(TID, {
      title: gap.suggestion.title,
      format: gap.suggestion.format,
      groups: gap.suggestion.groups,
      missingTeamIds: [missing],
      plan: gap.plan,
    });
    const after = s.get(TID)!;
    expect(after.teams.find((t) => t.id === missing)?.status).toBe('no_show');
    expect(after.groupDraws![0]!.groups[1]).toHaveLength(3);
    expect(after.matches.some((m) => m.teamAId === missing || m.teamBId === missing)).toBe(false);
    // Alle übrigen Gruppenspiele mit derselben ID zur selben Zeit auf demselben Feld.
    for (const m of before.matches.filter((x) => x.stageId === 'vorrunde' && x.teamAId !== missing && x.teamBId !== missing)) {
      const now = after.matches.find((x) => x.id === m.id);
      expect(now && [now.startISO, now.fieldId]).toEqual([m.startISO, m.fieldId]);
    }
    // Platz 7 ohne Spiel: das Spiel um Platz 7 fällt weg.
    expect(after.matches.some((m) => m.matchKey === 'P7')).toBe(false);
    expect(after.tournament.format!.stages.find((x) => x.id === 'platzierung')).toMatchObject({ placeRange: { from: 5, to: 7 } });

    const history = await s.loadHistory(TID);
    expect(describeHistory(history, after, {})[0]!.text).toContain('Turnier umgestellt: Lücke lassen');
    const check = undoChecks(history, after).get(history[0]!.id);
    expect(check?.ok).toBe(true);
    await s.undoHistory(TID, history[0]!);
    const back = s.get(TID)!;
    expect(back.tournament.format).toEqual(before.tournament.format);
    expect(back.groupDraws![0]!.groups).toEqual(before.groupDraws![0]!.groups);
    expect(back.teams.find((t) => t.id === missing)?.status).toBe('active');
    const layout = (d: typeof before) =>
      d.matches.map((m) => [m.id, m.teamAId, m.teamBId, m.startISO, m.fieldId, m.matchKey ?? '']).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(layout(back)).toEqual(layout(before));
  });

  it('nach dem Anpfiff: nur die Endrunde passt sich an zurückgezogene Teams an', async () => {
    const s = new MockTournamentStore(createFixtures(), false);
    const d = s.get(TID)!;
    const team = d.groupDraws![0]!.groups[0]![3]!;
    await s.withdrawTeam(TID, team);
    const options = reshapeOptions(s.get(TID)!, []);
    expect(options.map((o) => o.suggestion.kind)).toEqual(['finals']);
    const o = options[0]!;
    await s.reshapeTournament(TID, { title: o.suggestion.title, format: o.suggestion.format, missingTeamIds: [], plan: o.plan });
    const after = s.get(TID)!;
    // Gespielte Gruppenspiele bleiben, das Spiel um Platz 7 fällt weg.
    expect(after.matches.filter((m) => m.stageId === 'vorrunde' && m.status === 'completed').length).toBe(
      d.matches.filter((m) => m.stageId === 'vorrunde' && m.status === 'completed').length,
    );
    expect(after.matches.some((m) => m.matchKey === 'P7')).toBe(false);
    expect(after.groupDraws![0]!.groups).toEqual(d.groupDraws![0]!.groups);
  });

  it('16 → 15: erst drei Fünfergruppen (neu geplant), dann Lücke lassen mit Silber als K.-o. 4 plus Dreiergruppe', async () => {
    const s = new MockTournamentStore(createFixtures(), false);
    const names = Array.from({ length: 16 }, (_, i) => `Team ${i + 1}`);
    const draft: WizardDraft = {
      id: 'neu16',
      title: 'Pfingstturnier',
      organizerName: 'FC Test',
      venue: '',
      localDate: '2027-05-15',
      timeZone: 'Europe/Berlin',
      sponsors: [],
      teams: names.map((n, i) => ({ id: `d-${i}`, name: n, active: true })),
      roundsTotal: 0,
      preDrawRounds: 0,
      pairingMode: 'balanced',
      tieBreakers: [],
      buchholzEnabled: false,
      fields: [1, 2, 3, 4].map((n) => ({ id: `f${n}`, name: `Platz ${n}` })),
      startTime: '10:00',
      matchMinutes: 12,
      turnoverMinutes: 3,
      roundBreakMinutes: 0,
      restOptimization: true,
      hardRestMinutes: null,
      allocation: 'max_capacity',
      visibility: 'full',
    };
    const format = FORMAT_TEMPLATES.find((t) => t.id === 't16')!.build();
    const ids = draft.teams.map((t) => t.id);
    const tid = await s.createTournament(
      { ...draft, format, groupDraws: [{ stageId: 'vorrunde', mode: 'manual', groups: [0, 1, 2, 3].map((g) => ids.slice(g * 4, g * 4 + 4)) }] },
      false,
    );
    const d = s.get(tid)!;
    const sched = d.tournament.schedule;
    const plan = planCreation(
      format,
      16,
      d.fields.map((f) => ({ id: f.id, name: f.name, order: f.order, active: f.active })),
      { tournamentStartISO: sched.tournamentStartISO, matchMinutes: sched.matchMinutes, turnoverMinutes: sched.turnoverMinutes, roundBreakMinutes: sched.roundBreakMinutes },
      d.groupDraws![0]!.groups,
    );
    await s.saveStagePlan(tid, toPlannedMatches(format, plan, sched.matchMinutes));
    const ready = s.get(tid)!;
    const missing = ready.groupDraws![0]!.groups[3]![1]!;

    const options = reshapeOptions(ready, [missing]);
    expect(options.map((o) => [o.suggestion.kind, o.suggestion.title])).toEqual([
      ['regroup', '3 Gruppen mit je 5'],
      ['gap', 'Lücke lassen'],
    ]);
    for (const o of options) expect(o.problems, o.suggestion.kind).toEqual([]);
    const [regroup, gap] = options as [ReshapeOption, ReshapeOption];
    // 3 Gruppen zu 5 = 30 Gruppenspiele, plus Gold 8 (8 Spiele), Silber 4 (4) und Bronze als Dreiergruppe (3).
    expect(regroup.matchCount).toBe(30 + 8 + 4 + 3);
    expect(currentEndISO(ready)! < regroup.endISO!).toBe(true);
    // Lücke: 21 Gruppenspiele; Silber 7 Teams = K.-o. mit 4 (4 Spiele) und Dreiergruppe (3).
    expect(gap.matchCount).toBe(21 + 8 + 4 + 3);
    expect(gap.endISO! <= currentEndISO(ready)!).toBe(true);
    expect(gap.suggestion.threeTeamStages.map((x) => x.stageId)).toEqual(['silber_2']);

    // Mit „streichen“ fällt die Dreiergruppe weg, die drei teilen sich die Plätze 13 bis 15.
    const dropped = reshapeOptions(ready, [missing], { silber_2: 'drop' }).find((o) => o.suggestion.kind === 'gap')!;
    expect(dropped.matchCount).toBe(21 + 8 + 4);

    await s.reshapeTournament(tid, {
      title: regroup.suggestion.title,
      format: regroup.suggestion.format,
      groups: regroup.suggestion.groups,
      missingTeamIds: [missing],
      plan: regroup.plan,
    });
    const after = s.get(tid)!;
    expect(after.groupDraws![0]!.groups.map((g) => g.length)).toEqual([5, 5, 5]);
    expect(after.matches.filter((m) => m.stageId === 'vorrunde')).toHaveLength(30);
    expect(after.matches.every((m) => m.startISO && m.fieldId)).toBe(true);
  });
});
