import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkGroupAssignment, drawRandom, drawWithPots } from './draw';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${String(i).padStart(2, '0')}`);

describe('Auslosung', () => {
  it('Zufall: gleicher Seed ergibt dieselbe Einteilung, unabhängig von der Eingabe-Reihenfolge', () => {
    const teams = ids(18);
    const a = drawRandom({ teamIds: teams, groupCount: 4, seed: 'turnier-1' });
    const b = drawRandom({ teamIds: [...teams].reverse(), groupCount: 4, seed: 'turnier-1' });
    const c = drawRandom({ teamIds: teams, groupCount: 4, seed: 'turnier-2' });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a.map((g) => g.length)).toEqual([5, 5, 4, 4]);
  });

  it('Zufall: hält eigene Gruppengrößen ein', () => {
    const groups = drawRandom({ teamIds: ids(18), groupCount: 4, groupSizes: [6, 4, 4, 4], seed: 's' });
    expect(groups.map((g) => g.length)).toEqual([6, 4, 4, 4]);
  });

  it('Lostöpfe: aus jedem Topf genau ein Team pro Gruppe', () => {
    const teams = ids(16);
    const pots = [teams.slice(0, 4), teams.slice(4, 8), teams.slice(8, 12), teams.slice(12, 16)];
    const groups = drawWithPots({ teamIds: teams, groupCount: 4, pots, seed: 'x' });
    for (const group of groups) {
      expect(group).toHaveLength(4);
      for (const pot of pots) expect(group.filter((id) => pot.includes(id))).toHaveLength(1);
    }
  });

  it('Lostöpfe: Teams ohne Topf kommen in einen letzten Topf, große Töpfe verteilen sich gleichmäßig', () => {
    const teams = ids(18);
    const pots = [teams.slice(0, 6)];
    const groups = drawWithPots({ teamIds: teams, groupCount: 4, pots, seed: 'y' });
    expect(groups.map((g) => g.length)).toEqual([5, 5, 4, 4]);
    const fromPot = groups.map((g) => g.filter((id) => pots[0]!.includes(id)).length).sort();
    expect(fromPot).toEqual([1, 1, 2, 2]);
    expect(checkGroupAssignment(groups, { teamIds: teams, groupCount: 4, pots }).warnings).toEqual([]);
  });

  it('Eigenschaft: jede Auslosung verteilt jedes Team genau einmal und besteht die Prüfung', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 40 }),
        fc.integer({ min: 1, max: 8 }),
        fc.string({ maxLength: 6 }),
        fc.integer({ min: 0, max: 4 }),
        (n, groupCount, seed, potCount) => {
          fc.pre(n >= 2 * groupCount);
          const teams = ids(n);
          const potSize = Math.ceil(n / Math.max(potCount, 1));
          const pots = Array.from({ length: potCount }, (_, p) => teams.slice(p * potSize, (p + 1) * potSize));
          const random = drawRandom({ teamIds: teams, groupCount, seed });
          const withPots = drawWithPots({ teamIds: teams, groupCount, seed, pots });
          for (const groups of [random, withPots]) {
            expect(groups.flat().sort()).toEqual(teams);
            expect(checkGroupAssignment(groups, { teamIds: teams, groupCount }).errors).toEqual([]);
          }
          expect(checkGroupAssignment(withPots, { teamIds: teams, groupCount, pots }).warnings).toEqual([]);
        },
      ),
    );
  });

  it('von Hand: meldet fehlende, doppelte und unbekannte Teams', () => {
    const names = new Map([['a', 'Adler']]);
    const check = checkGroupAssignment(
      [
        ['a', 'b'],
        ['a', 'x'],
      ],
      { teamIds: ['a', 'b', 'c'], groupCount: 2, teamNames: names },
    );
    expect(check.valid).toBe(false);
    expect(check.errors).toEqual(['Adler steht in mehreren Gruppen.', 'x ist nicht angemeldet.', 'c ist noch keiner Gruppe zugeteilt.']);
  });

  it('von Hand: ungleiche Gruppen sind nur eine Warnung', () => {
    const check = checkGroupAssignment([['a', 'b', 'c', 'd'], ['e', 'f']], { teamIds: ['a', 'b', 'c', 'd', 'e', 'f'], groupCount: 2 });
    expect(check.valid).toBe(true);
    expect(check.warnings).toEqual(['Die Gruppen sind ungleich groß (4-2).']);
  });
});
