import { describe, expect, it } from 'vitest';
import { backToBackCount, groupFixtures, roundRobinRounds, stageFixtures } from './fixtures';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
const pairKey = (a: string, b: string) => [a, b].sort().join('-');

describe('Spielpaarungen jeder gegen jeden', () => {
  for (let n = 2; n <= 12; n++) {
    it(`${n} Teams: jedes Paar genau einmal, jedes Team höchstens einmal pro Runde`, () => {
      const fixtures = groupFixtures(0, ids(n));
      expect(fixtures).toHaveLength((n * (n - 1)) / 2);
      expect(new Set(fixtures.map((f) => pairKey(f.teamAId, f.teamBId))).size).toBe(fixtures.length);
      const rounds = new Map<number, string[]>();
      for (const f of fixtures) rounds.set(f.round, [...(rounds.get(f.round) ?? []), f.teamAId, f.teamBId]);
      for (const teams of rounds.values()) expect(new Set(teams).size).toBe(teams.length);
      expect(fixtures.map((f) => f.order)).toEqual(fixtures.map((_, i) => i));
    });
  }

  it('Hin- und Rückspiel: jedes Paar zweimal, mit getauschten Seiten', () => {
    const fixtures = groupFixtures(1, ids(5), true);
    expect(fixtures).toHaveLength(20);
    for (const f of fixtures.filter((x) => x.leg === 1)) {
      expect(fixtures.some((g) => g.leg === 2 && g.teamAId === f.teamBId && g.teamBId === f.teamAId)).toBe(true);
    }
    expect(fixtures.every((f) => f.groupIndex === 1)).toBe(true);
    expect(fixtures.findIndex((f) => f.leg === 2)).toBe(10);
  });

  it('kein Team zweimal direkt hintereinander, wenn vermeidbar', () => {
    // Bei 3 und 4 Teams geht es nicht ohne (jedes Spiel teilt ein Team mit dem nächsten bzw. dem übernächsten).
    expect(backToBackCount(groupFixtures(0, ids(3)))).toBe(2);
    expect(backToBackCount(groupFixtures(0, ids(4)))).toBe(2);
    for (let n = 5; n <= 12; n++) {
      expect(backToBackCount(groupFixtures(0, ids(n)))).toBe(0);
      expect(backToBackCount(groupFixtures(0, ids(n), true))).toBe(0);
    }
  });

  it('verteilt die A- und B-Seite einigermaßen gleich', () => {
    for (const n of [4, 5, 6, 8]) {
      const fixtures = groupFixtures(0, ids(n));
      for (const t of ids(n)) {
        const asA = fixtures.filter((f) => f.teamAId === t).length;
        const asB = fixtures.filter((f) => f.teamBId === t).length;
        expect(Math.abs(asA - asB)).toBeLessThanOrEqual(n - 2);
      }
    }
  });

  it('ungerade Teamzahl: pro Runde hat genau ein Team frei', () => {
    const rounds = roundRobinRounds(ids(5));
    expect(rounds).toHaveLength(5);
    for (const r of rounds) expect(r).toHaveLength(2);
  });

  it('Abschnitt: Spiele aller Gruppen mit Gruppennummer', () => {
    const fixtures = stageFixtures([ids(4), ['x', 'y', 'z']]);
    expect(fixtures.filter((f) => f.groupIndex === 0)).toHaveLength(6);
    expect(fixtures.filter((f) => f.groupIndex === 1)).toHaveLength(3);
  });
});
