import { describe, expect, it } from 'vitest';
import { open, result, team, teams } from '../scoring/testUtils';
import { calculateGroupStageStandings, type StageMatch } from './stage';
import { carryOverFrom } from './table';

const stage = { id: 'vorrunde', doubleRoundRobin: false };
const inStage = (m: StageMatch, stageId = 'vorrunde'): StageMatch => ({ ...m, stageId });

describe('Tabellen eines Gruppenabschnitts', () => {
  it('rechnet jede Gruppe für sich und meldet, welche Gruppe fertig ist', () => {
    const s = calculateGroupStageStandings({
      stage,
      groups: [
        ['A', 'B', 'C'],
        ['D', 'E', 'F'],
      ],
      teams: teams('A', 'B', 'C', 'D', 'E', 'F'),
      matches: [
        inStage(result('A', 1, 0, 'B')),
        inStage(result('A', 1, 0, 'C')),
        inStage(result('B', 1, 0, 'C')),
        inStage(result('D', 2, 0, 'E')),
        inStage(open('D', 'F', 'live')),
        inStage(result('E', 1, 0, 'F')),
      ],
      variant: 'h2h_first',
    });
    expect(s.stageId).toBe('vorrunde');
    expect(s.groups.map((g) => g.map((r) => r.teamId))).toEqual([
      ['A', 'B', 'C'],
      ['D', 'E', 'F'],
    ]);
    expect(s.groupComplete).toEqual([true, false]);
    expect(s.tables).toHaveLength(2);
  });

  it('Spiele gegen zurückgezogene Teams halten die Gruppe nicht auf', () => {
    const s = calculateGroupStageStandings({
      stage,
      groups: [['A', 'B', 'W']],
      teams: [team('A'), team('B'), team('W', 'withdrawn')],
      matches: [inStage(result('A', 1, 0, 'B')), inStage(open('A', 'W', 'scheduled'))],
      variant: 'h2h_first',
    });
    expect(s.groupComplete).toEqual([true]);
    expect(s.tables[0]!.unranked).toEqual(['W']);
  });

  it('ignoriert Spiele anderer Abschnitte und verlangt bei Rückspiel zwei Spiele pro Paar', () => {
    const base = {
      groups: [['A', 'B']],
      teams: teams('A', 'B'),
      matches: [inStage(result('A', 1, 0, 'B')), inStage(result('B', 3, 0, 'A'), 'gold')],
      variant: 'h2h_first' as const,
    };
    const single = calculateGroupStageStandings({ ...base, stage });
    expect(single.groups[0]!.map((r) => r.teamId)).toEqual(['A', 'B']);
    expect(single.groupComplete).toEqual([true]);
    const double = calculateGroupStageStandings({ ...base, stage: { ...stage, doubleRoundRobin: true } });
    expect(double.groupComplete).toEqual([false]);
  });

  it('nimmt Punkte nur mit, wenn die Zwischenrunde es vorsieht', () => {
    const carryOver = carryOverFrom([[{ teamId: 'B', place: 1, played: 1, won: 1, drawn: 0, lost: 0, goalsFor: 2, goalsAgainst: 0, points: 3 }]]);
    const base = { groups: [['A', 'B']], teams: teams('A', 'B'), matches: [inStage(result('A', 1, 0, 'B'), 'zwischenrunde')], variant: 'h2h_first' as const, carryOver };
    const off = calculateGroupStageStandings({ ...base, stage: { id: 'zwischenrunde', doubleRoundRobin: false } });
    const on = calculateGroupStageStandings({ ...base, stage: { id: 'zwischenrunde', doubleRoundRobin: false, carryOverPoints: true } });
    expect(off.groups[0]!.map((r) => [r.teamId, r.points])).toEqual([
      ['A', 3],
      ['B', 0],
    ]);
    expect(on.groups[0]!.map((r) => [r.teamId, r.points])).toEqual([
      ['A', 3],
      ['B', 3],
    ]);
  });
});
