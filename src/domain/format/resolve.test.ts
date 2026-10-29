// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildFormatBrackets } from '../knockout/bracket';
import { groupTeams, standings } from '../knockout/testUtils';
import type { TeamStatus } from '../types';
import { type FormatMatch, type ResolveInput, finalPlacements, resolveFormat, withdrawalOptions } from './resolve';
import { FORMAT_TEMPLATES } from './templates';
import type { StageStandings } from './types';

function setup(templateId: string, groupStandings: StageStandings, statuses: Record<string, TeamStatus> = {}) {
  const t = FORMAT_TEMPLATES.find((x) => x.id === templateId)!;
  const format = t.build();
  const matches: FormatMatch[] = buildFormatBrackets(format, t.teamCount).map((b) => ({
    id: `${b.stageId}-${b.key}`,
    stageId: b.stageId,
    matchKey: b.key,
    slotA: b.slotA,
    slotB: b.slotB,
    penaltyOnly: b.penaltyOnly,
    status: 'scheduled',
  }));
  const teams = groupStandings.groups.flat().map((r) => ({ id: r.teamId, status: statuses[r.teamId] ?? ('active' as TeamStatus) }));
  const input: ResolveInput = { format, teams, standings: { vorrunde: groupStandings }, matches };
  const match = (key: string, stageId = format.stages[1]!.id) => input.matches.find((m) => m.stageId === stageId && m.matchKey === key)!;
  return { input, match };
}

/** Vorschlag übernehmen, wie es die Turnierleitung per Bestätigen täte. */
function apply(input: ResolveInput) {
  const { changes } = resolveFormat(input);
  for (const c of changes) {
    const m = input.matches.find((x) => x.id === c.matchId)! as FormatMatch;
    if (c.side === 'A') m.teamAId = c.toTeamId;
    else m.teamBId = c.toTeamId;
  }
  return changes;
}

function play(m: FormatMatch, goalsA: number, goalsB: number, extra: Partial<FormatMatch> = {}) {
  Object.assign(m, { status: 'completed', goalsA, goalsB, ...extra });
}

describe('resolveFormat', () => {
  it('trägt feste Plätze ein, sobald die Gruppe fertig ist, und zeigt vorher eine Vorschau', () => {
    const { input, match } = setup('t8', standings('vorrunde', groupTeams(2, 4), [true, false]));
    const res = resolveFormat(input);
    const sf1 = res.matches.find((m) => m.matchKey === 'SF1')!;
    expect(sf1.a).toEqual({ teamId: 'A1', provisional: false });
    expect(sf1.b).toEqual({ teamId: 'B2', provisional: true });
    // nur feste Plätze werden vorgeschlagen
    expect(res.changes.filter((c) => c.matchId === match('SF1').id)).toEqual([{ matchId: match('SF1').id, side: 'A', fromTeamId: null, toTeamId: 'A1' }]);
  });

  it('lässt einen Platz vorläufig, solange in der fertigen Gruppe noch ein Los fehlt', () => {
    const st = standings('vorrunde', groupTeams(2, 4), [true, true]);
    const { input, match } = setup('t8', { ...st, tables: [{ openLots: [['A1', 'A2']] }, { openLots: [] }] } as StageStandings);
    const res = resolveFormat(input);
    const sf1 = res.matches.find((m) => m.matchKey === 'SF1')!;
    expect(sf1.a).toEqual({ teamId: 'A1', provisional: true });
    expect(sf1.b).toEqual({ teamId: 'B2', provisional: false });
    expect(res.changes.filter((c) => c.matchId === match('SF1').id).map((c) => c.toTeamId)).toEqual(['B2']);
  });

  it('füllt beste Dritte erst, wenn alle Gruppen fertig sind, und meldet fehlende Lose', () => {
    const g = groupTeams(3, 4);
    const stats = { A3: { points: 3, played: 3 }, B3: { points: 3, played: 3 }, C3: { points: 1, played: 3 } };
    const partial = setup('t12', standings('vorrunde', g, [true, true, false], stats));
    const r1 = resolveFormat(partial.input);
    const bestSlots = r1.matches.flatMap((m) => [m.a, m.b]).filter((_, i, all) => all[i]!.teamId?.endsWith('3'));
    expect(bestSlots.every((s) => s.provisional)).toBe(true);

    const full = setup('t12', standings('vorrunde', g, true, stats));
    const r2 = resolveFormat(full.input);
    expect(r2.needsLot).toEqual([{ stageId: 'vorrunde', place: 3, teamIds: ['A3', 'B3'] }]);
    expect(r2.changes.some((c) => c.toTeamId === 'A3' || c.toTeamId === 'B3')).toBe(false);

    full.input.lotOrders = { 'vorrunde|3': ['B3', 'A3'] };
    const r3 = resolveFormat(full.input);
    expect(r3.needsLot).toEqual([]);
    const thirds = r3.changes.filter((c) => c.toTeamId.endsWith('3')).map((c) => c.toTeamId);
    expect(thirds.sort()).toEqual(['A3', 'B3']);
  });

  it('verteilt die besten Dritten so, dass kein Team in Runde 1 auf die eigene Gruppe trifft', () => {
    const g = groupTeams(3, 4);
    for (const [first, second] of [
      ['A3', 'B3'],
      ['B3', 'C3'],
      ['A3', 'C3'],
      ['C3', 'A3'],
    ] as const) {
      const stats = { [first]: { points: 6, played: 3 }, [second]: { points: 4, played: 3 } };
      const { input } = setup('t12', standings('vorrunde', g, true, stats));
      apply(input);
      for (const m of input.matches.filter((x) => /^QF/.test(x.matchKey ?? ''))) {
        expect(m.teamAId![0], `${first}/${second} ${m.matchKey}`).not.toBe(m.teamBId![0]);
      }
    }
  });

  it('trägt Sieger und Verlierer ein, sobald das Spiel entschieden ist', () => {
    const { input, match } = setup('t8', standings('vorrunde', groupTeams(2, 4)));
    apply(input);
    play(match('SF1'), 1, 1, { penaltiesA: 3, penaltiesB: 4 });
    play(match('SF2'), 2, 0);
    apply(input);
    expect([match('F').teamAId, match('F').teamBId]).toEqual(['B2', 'B1']);
    expect([match('P3').teamAId, match('P3').teamBId]).toEqual(['A1', 'A2']);
  });

  it('Korrektur ändert nur noch nicht angepfiffene Spiele', () => {
    const { input, match } = setup('t8', standings('vorrunde', groupTeams(2, 4)));
    apply(input);
    // Spätere Korrektur in Gruppe B: B1 und B2 tauschen die Plätze.
    input.standings = { vorrunde: standings('vorrunde', [['A1', 'A2', 'A3', 'A4'], ['B2', 'B1', 'B3', 'B4']]) };
    match('SF1').status = 'live';
    const res = resolveFormat(input);
    expect(res.locked).toEqual([{ matchId: match('SF1').id, side: 'B', fromTeamId: 'B2', toTeamId: 'B1' }]);
    expect(res.changes).toEqual([{ matchId: match('SF2').id, side: 'A', fromTeamId: 'B1', toTeamId: 'B2' }]);
  });

  it('von Hand getauschte Teams bleiben', () => {
    const { input, match } = setup('t8', standings('vorrunde', groupTeams(2, 4)));
    apply(input);
    Object.assign(match('SF1'), { teamBId: 'B1', slotB: { kind: 'team', teamId: 'B1' } });
    Object.assign(match('SF2'), { teamAId: 'B2', slotA: { kind: 'team', teamId: 'B2' } });
    expect(resolveFormat(input).changes).toEqual([]);
  });

  it('übergeht zurückgezogene Teams in der Gruppentabelle', () => {
    const { input } = setup('t8', standings('vorrunde', groupTeams(2, 4)), { A1: 'withdrawn' });
    const changes = apply(input);
    expect(changes.map((c) => c.toTeamId)).not.toContain('A1');
    expect(input.matches.find((m) => m.matchKey === 'SF1')!.teamAId).toBe('A2');
  });
});

describe('withdrawalOptions', () => {
  it('bietet kampflos oder den Nächstbesten aus derselben Gruppe', () => {
    const { input, match } = setup('t8', standings('vorrunde', groupTeams(2, 4)));
    apply(input);
    const [opt] = withdrawalOptions(input, 'B2');
    expect(opt).toMatchObject({ matchId: match('SF1').id, side: 'B', walkover: { decidedBy: 'walkover', walkoverWinner: 'A' } });
    // B3 spielt schon im Spiel um Platz 5 mit, dort entsteht dann eine Lücke.
    expect(opt!.replacement).toEqual({ teamId: 'B3', leavesStageId: 'platzierung' });
  });

  it('nimmt bei Gold und Silber den Nächstbesten der Gruppe, auch ohne Endrunde dahinter', () => {
    const { input } = setup('t20', standings('vorrunde', groupTeams(4, 5)));
    apply(input);
    const [silver] = withdrawalOptions(input, 'C4');
    expect(silver!.replacement).toEqual({ teamId: 'C5', leavesStageId: null });
  });

  it('kein Nachrücken mehr ab der zweiten Runde', () => {
    const { input, match } = setup('t8', standings('vorrunde', groupTeams(2, 4)));
    apply(input);
    play(match('SF1'), 1, 0);
    play(match('SF2'), 1, 0);
    apply(input);
    const opts = withdrawalOptions(input, 'A1');
    expect(opts.find((o) => o.matchId === match('F').id)?.replacement).toBeNull();
  });
});

describe('finalPlacements', () => {
  it('8 Teams: alle Plätze ausgespielt', () => {
    const { input, match } = setup('t8', standings('vorrunde', groupTeams(2, 4)));
    apply(input);
    play(match('SF1'), 2, 0);
    play(match('SF2'), 0, 1);
    play(match('P5', 'platzierung'), 1, 0);
    play(match('P7', 'platzierung'), 0, 0, { penaltiesA: 1, penaltiesB: 2 });
    apply(input);
    play(match('F'), 3, 2, { decidedBy: 'extra_time' });
    play(match('P3'), 0, 0, { penaltiesA: 5, penaltiesB: 4 });
    const { placements, open } = finalPlacements(input);
    expect(open).toEqual([]);
    expect(placements.map((p) => ('placeFrom' in p ? `${p.placeFrom}-${p.placeTo} ${p.teamId}` : p.teamId))).toEqual([
      '1-1 A1',
      '2-2 A2',
      '3-3 B2',
      '4-4 B1',
      '5-5 A3',
      '6-6 B3',
      '7-7 B4',
      '8-8 A4',
    ]);
  });

  it('16 Teams Gold/Silber: Viertelfinal-Verlierer teilen sich die Plätze 5–8 bzw. 13–16', () => {
    const { input } = setup('t16', standings('vorrunde', groupTeams(4, 4)));
    apply(input);
    for (const stageId of ['gold', 'silber']) {
      for (const m of input.matches.filter((x) => x.stageId === stageId && /^QF/.test(x.matchKey!))) play(m, 1, 0);
    }
    const { placements, open } = finalPlacements(input);
    const shared = placements.filter((p) => 'placeFrom' in p && p.placeFrom !== p.placeTo);
    expect(shared).toHaveLength(8);
    expect(new Set(shared.map((p) => ('placeFrom' in p ? `${p.placeFrom}–${p.placeTo}` : '')))).toEqual(new Set(['5–8', '13–16']));
    expect(open).toHaveLength(8);
  });

  it('20 Teams: die Fünften sind ausgeschieden, ohne Platz', () => {
    const { input } = setup('t20', standings('vorrunde', groupTeams(4, 5)));
    apply(input);
    const { placements } = finalPlacements(input);
    expect(placements.filter((p) => 'eliminatedInStageId' in p).map((p) => p.teamId)).toEqual(['A5', 'B5', 'C5', 'D5']);
  });

  it('noch keine Ausgeschiedenen, solange die Vorrunde läuft', () => {
    const { input } = setup('t20', standings('vorrunde', groupTeams(4, 5), [true, true, true, false]));
    expect(finalPlacements(input).placements).toEqual([]);
  });
});
