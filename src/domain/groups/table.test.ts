import { describe, expect, it } from 'vitest';
import { result, team, teams } from '../scoring/testUtils';
import { calculateGroupTable, carryOverFrom, type GroupTableInput } from './table';

const table = (input: Partial<GroupTableInput> & Pick<GroupTableInput, 'teams' | 'matches'>) =>
  calculateGroupTable({ variant: 'h2h_first', ...input });
const order = (t: ReturnType<typeof calculateGroupTable>) => t.rows.map((r) => r.teamId);

describe('Gruppentabelle', () => {
  it('zählt 3 / 1 / 0 und sortiert nach Punkten', () => {
    const t = table({
      teams: teams('A', 'B', 'C', 'D'),
      matches: [result('A', 1, 0, 'B'), result('A', 1, 0, 'C'), result('A', 2, 0, 'D'), result('B', 1, 0, 'C'), result('B', 1, 0, 'D'), result('C', 1, 1, 'D')],
    });
    expect(order(t)).toEqual(['A', 'B', 'C', 'D']);
    expect(t.rows.map((r) => r.points)).toEqual([9, 6, 1, 1]);
    expect(t.rows[0]).toEqual({ teamId: 'A', place: 1, played: 3, won: 3, drawn: 0, lost: 0, goalsFor: 4, goalsAgainst: 0, points: 9 });
    expect(t.rows.map((r) => r.decidedBy)).toEqual([undefined, 'points', 'points', 'goal_diff']);
  });

  it('Variante 1 nimmt den direkten Vergleich zuerst, Variante 2 die Tordifferenz', () => {
    const matches = [result('A', 1, 0, 'B'), result('B', 5, 0, 'C'), result('A', 0, 1, 'C')];
    const v1 = table({ teams: teams('A', 'B', 'C'), matches, variant: 'h2h_first' });
    const v2 = table({ teams: teams('A', 'B', 'C'), matches, variant: 'goals_first' });
    // Alle drei haben 3 Punkte; direkter Vergleich = Mini-Tabelle aller drei: A +0, B +4, C -4.
    expect(order(v1)).toEqual(['B', 'A', 'C']);
    expect(v1.rows.map((r) => r.decidedBy)).toEqual([undefined, 'head_to_head', 'head_to_head']);
    expect(order(v2)).toEqual(['B', 'A', 'C']);
    expect(v2.rows.map((r) => r.decidedBy)).toEqual([undefined, 'goal_diff', 'goal_diff']);
  });

  it('Varianten können zu verschiedenen Reihenfolgen führen', () => {
    // A schlägt B, B hat die bessere Tordifferenz.
    const matches = [result('A', 1, 0, 'B'), result('B', 6, 0, 'C'), result('C', 1, 0, 'A'), result('A', 1, 0, 'D'), result('B', 1, 0, 'D'), result('C', 0, 2, 'D')];
    const v1 = table({ teams: teams('A', 'B', 'C', 'D'), matches, variant: 'h2h_first' });
    const v2 = table({ teams: teams('A', 'B', 'C', 'D'), matches, variant: 'goals_first' });
    expect(order(v1).slice(0, 2)).toEqual(['A', 'B']);
    expect(v1.rows[1]!.decidedBy).toBe('head_to_head');
    expect(order(v2).slice(0, 2)).toEqual(['B', 'A']);
    expect(v2.rows[1]!.decidedBy).toBe('goal_diff');
  });

  it('Mini-Tabelle bei drei Gleichen: Punkte, dann Tordifferenz, dann Tore untereinander', () => {
    // A, B, C je 6 Punkte; untereinander je ein Sieg. Mini-Tordifferenz: A +2, C 0, B -2.
    const matches = [
      result('A', 3, 0, 'B'),
      result('B', 1, 0, 'C'),
      result('C', 1, 0, 'A'),
      result('A', 1, 0, 'D'),
      result('B', 9, 0, 'D'),
      result('C', 1, 0, 'D'),
    ];
    const t = table({ teams: teams('A', 'B', 'C', 'D'), matches });
    expect(order(t)).toEqual(['A', 'C', 'B', 'D']);
    expect(t.rows.map((r) => r.decidedBy)).toEqual([undefined, 'head_to_head', 'head_to_head', 'points']);
  });

  it('direkter Vergleich zählt erst, wenn alle Gleichstehenden gegeneinander gespielt haben', () => {
    const t = table({ teams: teams('A', 'B', 'C'), matches: [result('A', 1, 0, 'C'), result('B', 2, 0, 'C')] });
    expect(order(t)).toEqual(['B', 'A', 'C']);
    expect(t.rows[1]!.decidedBy).toBe('goal_diff');
  });

  it('mehr Siege trennen, wenn Tore gleich sind', () => {
    const matches = [result('X', 2, 1, 'P'), result('X', 0, 1, 'Q'), result('Y', 1, 1, 'R'), result('Y', 1, 1, 'S'), result('Y', 0, 0, 'P')];
    const t = table({ teams: teams('X', 'Y', 'P', 'Q', 'R', 'S'), matches, variant: 'goals_first' });
    expect(order(t).indexOf('X')).toBeLessThan(order(t).indexOf('Y'));
    expect(t.rows.find((r) => r.teamId === 'Y')!.decidedBy).toBe('wins');
  });

  it('ohne gezogenes Los bleibt der Gleichstand offen, mit Los steht er fest', () => {
    const base = { teams: [team('a', 'active', 'Adler'), team('b', 'active', 'Bären')], matches: [result('a', 1, 1, 'b')] };
    const open = table(base);
    expect(open.openLots).toEqual([['a', 'b']]);
    expect(open.rows[1]!.decidedBy).toBeUndefined();
    const decided = table({ ...base, lots: [{ teamIds: ['x', 'b', 'a'] }] });
    expect(decided.openLots).toEqual([]);
    expect(order(decided)).toEqual(['b', 'a']);
    expect(decided.rows[1]!.decidedBy).toBe('lot');
  });

  it('zurückgezogene Teams: alle ihre Spiele zählen für niemanden', () => {
    const t = table({
      teams: [team('A'), team('B'), team('W', 'withdrawn'), team('N', 'no_show')],
      matches: [result('W', 5, 0, 'A'), result('B', 0, 3, 'W'), result('A', 1, 0, 'B'), result('N', 1, 0, 'B')],
    });
    expect(order(t)).toEqual(['A', 'B']);
    expect(t.rows[0]).toMatchObject({ played: 1, points: 3, goalsAgainst: 0 });
    expect(t.unranked).toEqual(['N', 'W']);
  });

  it('nimmt Punkte und Tore aus der Vorrunde mit, der direkte Vergleich nutzt nur neue Spiele', () => {
    const carryOver = carryOverFrom([
      [
        { teamId: 'A', place: 1, played: 3, won: 3, drawn: 0, lost: 0, goalsFor: 6, goalsAgainst: 0, points: 9 },
        { teamId: 'B', place: 2, played: 3, won: 2, drawn: 0, lost: 1, goalsFor: 3, goalsAgainst: 2, points: 6 },
      ],
    ]);
    const t = table({ teams: teams('A', 'B'), matches: [result('B', 1, 0, 'A')], carryOver });
    expect(t.rows).toEqual([
      { teamId: 'B', place: 1, played: 4, won: 3, drawn: 0, lost: 1, goalsFor: 4, goalsAgainst: 2, points: 9 },
      { teamId: 'A', place: 2, played: 4, won: 3, drawn: 0, lost: 1, goalsFor: 6, goalsAgainst: 1, points: 9, decidedBy: 'head_to_head' },
    ]);
  });
});
