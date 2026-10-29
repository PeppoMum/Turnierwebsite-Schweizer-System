import { describe, expect, it } from 'vitest';
import { FORMAT_TEMPLATES, type SlotRef } from '../../../domain/format';
import type { PublicMatch, PublicTournamentView } from '../../data/types';
import { buildStageModel, matchLabel, matchTitle, resultNote, slotText } from './stageView';

const T = (n: number) => `t${n}`;
const gp = (group: number, place: number): SlotRef => ({ kind: 'group_place', stageId: 'vorrunde', group, place });

/** Vorlage 8 Teams: Gruppe A = t1..t4, Gruppe B = t5..t8. */
function view(matches: PublicMatch[], withdrawn: string[] = []): PublicTournamentView {
  const format = FORMAT_TEMPLATES.find((x) => x.id === 't8')!.build();
  return {
    tournament: { id: 'x', title: 'X', organizerName: '', venue: '', localDate: '2026-10-29', timeZone: 'Europe/Berlin', status: 'running', visibility: 'full', roundsTotal: 0, currentRound: 0 },
    teams: Array.from({ length: 8 }, (_, i) => ({ id: T(i + 1), name: `Team ${i + 1}`, status: withdrawn.includes(T(i + 1)) ? 'withdrawn' : 'active' })),
    fields: [],
    sponsors: [],
    rounds: [],
    matches,
    byes: [],
    format,
    groupDraws: [{ stageId: 'vorrunde', groups: [[T(1), T(2), T(3), T(4)], [T(5), T(6), T(7), T(8)]] }],
    lots: [],
    updatedAt: '',
  };
}

let seq = 0;
function g(group: number, a: number, b: number, ga?: number, gb?: number): PublicMatch {
  const done = ga !== undefined;
  return {
    id: `m${++seq}`,
    roundNumber: 1,
    stageId: 'vorrunde',
    groupIndex: group,
    teamAId: T(a),
    teamBId: T(b),
    status: done ? 'completed' : 'scheduled',
    ...(done ? { goalsA: ga, goalsB: gb } : {}),
  };
}

function ko(key: string, slotA: SlotRef, slotB: SlotRef, extra: Partial<PublicMatch> = {}, stageId = 'endrunde'): PublicMatch {
  return { id: `ko-${key}`, roundNumber: 2, stageId, matchKey: key, slotA, slotB, teamAId: '', teamBId: '', status: 'scheduled', ...extra };
}

/** Gruppe A fertig: t1 9 Pkt, t2 6, t3 3, t4 0. Gruppe B: nur ein Spiel. */
function groupA(): PublicMatch[] {
  return [g(0, 1, 2, 2, 0), g(0, 3, 4, 1, 0), g(0, 1, 3, 1, 0), g(0, 2, 4, 3, 0), g(0, 4, 1, 0, 2), g(0, 2, 3, 1, 0)];
}

describe('Gruppentabellen', () => {
  it('rechnet 3/1/0 und sortiert nach Punkten', () => {
    const m = buildStageModel(view([...groupA(), g(1, 5, 6, 1, 1), g(1, 7, 8)]))!;
    const [a, b] = m.tables.get('vorrunde')!.groups;
    expect(a!.rows.map((r) => [r.teamId, r.points])).toEqual([[T(1), 9], [T(2), 6], [T(3), 3], [T(4), 0]]);
    expect(a!.complete).toBe(true);
    expect(b!.complete).toBe(false);
    expect(b!.rows.find((r) => r.teamId === T(5))!.drawn).toBe(1);
  });

  it('direkter Vergleich vor Tordifferenz (Variante 1)', () => {
    // t5 und t6 je 4 Punkte; t6 hat die bessere Tordifferenz, t5 hat das direkte Duell gewonnen.
    const m = buildStageModel(view([g(1, 5, 6, 1, 0), g(1, 6, 7, 5, 0), g(1, 5, 8, 0, 0), g(1, 6, 8, 0, 0)]))!;
    const rows = m.tables.get('vorrunde')!.groups[1]!.rows;
    expect(rows.slice(0, 2).map((r) => r.teamId)).toEqual([T(5), T(6)]);
    expect(rows[1]!.decidedBy).toBe('head_to_head');
  });

  it('Spiele zurückgezogener Teams zählen für niemanden', () => {
    const m = buildStageModel(view([g(0, 1, 2, 5, 0), g(0, 3, 4, 1, 0)], [T(2)]))!;
    const a = m.tables.get('vorrunde')!.groups[0]!;
    expect(a.unranked).toEqual([T(2)]);
    expect(a.rows.find((r) => r.teamId === T(1))!.played).toBe(0);
  });
});

describe('Platzhalter und Vorschau', () => {
  it('fertige Gruppe steht fest, laufende ist „Stand jetzt“, ohne Ergebnis bleibt der Platzhalter', () => {
    const sf1 = ko('SF1', gp(0, 1), gp(1, 2));
    const sf2 = ko('SF2', gp(1, 1), gp(0, 2));
    const before = buildStageModel(view([...groupA(), g(1, 5, 6)].concat(sf1, sf2)))!;
    expect(before.side(sf1, 'A')).toMatchObject({ teamId: T(1), provisional: false, slotShort: '1. A' });
    expect(before.side(sf1, 'B')).toMatchObject({ teamId: null, slotLabel: '2. Gruppe B' });

    const during = buildStageModel(view([...groupA(), g(1, 5, 6, 0, 2), g(1, 7, 8)].concat(sf1, sf2)))!;
    expect(during.side(sf2, 'A')).toMatchObject({ teamId: T(6), provisional: true });
  });

  it('eingetragenes Team geht vor, Sieger und Verlierer folgen aus dem Ergebnis', () => {
    const sf1 = ko('SF1', gp(0, 1), gp(1, 2), { teamAId: T(1), teamBId: T(6), status: 'completed', goalsA: 1, goalsB: 1, decidedBy: 'penalties', penaltiesA: 3, penaltiesB: 4 });
    const fin = ko('F', { kind: 'winner', stageId: 'endrunde', matchKey: 'SF1' }, { kind: 'winner', stageId: 'endrunde', matchKey: 'SF2' });
    const p3 = ko('P3', { kind: 'loser', stageId: 'endrunde', matchKey: 'SF1' }, { kind: 'loser', stageId: 'endrunde', matchKey: 'SF2' });
    const m = buildStageModel(view([sf1, fin, p3]))!;
    expect(m.side(fin, 'A')).toMatchObject({ teamId: T(6), provisional: false, slotLabel: 'Sieger Halbfinale 1' });
    expect(m.side(p3, 'A').teamId).toBe(T(1));
    expect(m.side(fin, 'B').teamId).toBeNull();
    expect(resultNote(sf1)).toBe('3:4 n. N.');
  });
});

describe('Endplatzierung', () => {
  it('Finale, Spiel um Platz 3 und Platzierungsspiele vergeben feste Plätze', () => {
    const done = (key: string, a: number, b: number, ga: number, gb: number, stageId = 'endrunde') =>
      ko(key, gp(0, 1), gp(1, 1), { teamAId: T(a), teamBId: T(b), status: 'completed', goalsA: ga, goalsB: gb }, stageId);
    const m = buildStageModel(view([done('F', 1, 5, 2, 1), done('P3', 2, 6, 0, 1), done('P5', 3, 7, 1, 0, 'platzierung')]))!;
    const p = m.placements().placements.map((x) => [x.teamId, x.placeFrom]);
    expect(p).toEqual([[T(1), 1], [T(5), 2], [T(6), 3], [T(2), 4], [T(3), 5], [T(7), 6]]);
  });

  it('nicht ausgespielte Plätze werden geteilt', () => {
    const format = FORMAT_TEMPLATES.find((x) => x.id === 't16')!.build();
    const v = { ...view([]), format };
    v.matches = [{ ...ko('QF1', gp(0, 1), gp(1, 2), { teamAId: T(1), teamBId: T(2), status: 'completed', goalsA: 2, goalsB: 0 }), stageId: 'gold' }];
    const p = buildStageModel(v)!.placements().placements;
    expect(p).toEqual([{ teamId: T(2), placeFrom: 5, placeTo: 8, stageId: 'gold' }]);
  });

  it('zurückgezogene Teams stehen unter „Ausgeschieden“', () => {
    expect(buildStageModel(view(groupA(), [T(8)]))!.placements().eliminated).toEqual([T(8)]);
  });
});

describe('Texte', () => {
  it('benennt Spiele und Platzhalter', () => {
    expect(matchLabel('QF2')).toBe('Viertelfinale 2');
    expect(matchLabel('P3', 8)).toBe('Spiel um Platz 11');
    expect(matchLabel('P5_SF1')).toBe('Halbfinale 1, Platz 5–8');
    const format = FORMAT_TEMPLATES.find((x) => x.id === 't16')!.build();
    expect(slotText(format, { kind: 'winner', stageId: 'silber', matchKey: 'P3' }).long).toBe('Sieger Spiel um Platz 11');
    const m = buildStageModel({ ...view([]), format })!;
    expect(matchTitle(m, { ...ko('SF1', gp(0, 1), gp(1, 1)), stageId: 'silber' })).toBe('Silber · Halbfinale 1');
    expect(matchTitle(m, g(2, 1, 2))).toBe('Gruppe C');
  });
});
