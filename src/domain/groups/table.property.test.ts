// @vitest-environment node
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { TieBreakVariant } from '../format/types';
import type { TeamStatus } from '../types';
import { groupFixtures } from './fixtures';
import { calculateGroupTable, type GroupMatch, type GroupTableInput } from './table';

/** Zufällige Gruppe mit 2–8 Teams, jeder gegen jeden (ggf. doppelt), manche Spiele offen, manche Teams zurückgezogen. */
const groupArb: fc.Arbitrary<GroupTableInput> = fc
  .record({
    size: fc.integer({ min: 2, max: 8 }),
    double: fc.boolean(),
    variant: fc.constantFrom<TieBreakVariant>('h2h_first', 'goals_first'),
  })
  .chain(({ size, double, variant }) => {
    const ids = Array.from({ length: size }, (_, i) => `t${i}`);
    const fixtures = groupFixtures(0, ids, double);
    return fc
      .record({
        statuses: fc.array(fc.constantFrom<TeamStatus>('active', 'active', 'active', 'active', 'withdrawn', 'no_show'), { minLength: size, maxLength: size }),
        results: fc.array(
          fc.record({ played: fc.boolean(), goalsA: fc.integer({ min: 0, max: 3 }), goalsB: fc.integer({ min: 0, max: 3 }) }),
          { minLength: fixtures.length, maxLength: fixtures.length },
        ),
        lotOrder: fc.shuffledSubarray(ids, { minLength: size, maxLength: size }),
        useLot: fc.boolean(),
      })
      .map(({ statuses, results, lotOrder, useLot }) => ({
        teams: ids.map((id, i) => ({ id, name: `Team ${i}`, status: statuses[i]! })),
        matches: fixtures.map((f, i): GroupMatch => {
          const r = results[i]!;
          return r.played
            ? { teamAId: f.teamAId, teamBId: f.teamBId, status: 'completed', goalsA: r.goalsA, goalsB: r.goalsB }
            : { teamAId: f.teamAId, teamBId: f.teamBId, status: 'scheduled' };
        }),
        variant,
        lots: useLot ? [{ teamIds: lotOrder }] : [],
      }));
  });

describe('Gruppentabelle (Eigenschaften)', () => {
  it('Plätze 1…n, nach Punkten absteigend, Punkte = 3·Siege + Unentschieden, nur aktive Teams gewertet', () => {
    fc.assert(
      fc.property(groupArb, (input) => {
        const t = calculateGroupTable(input);
        const active = input.teams.filter((x) => x.status === 'active').map((x) => x.id);
        expect(t.rows.map((r) => r.place)).toEqual(active.map((_, i) => i + 1));
        expect(new Set(t.rows.map((r) => r.teamId))).toEqual(new Set(active));
        expect(t.unranked.length + t.rows.length).toBe(input.teams.length);
        for (let i = 1; i < t.rows.length; i++) expect(t.rows[i - 1]!.points).toBeGreaterThanOrEqual(t.rows[i]!.points);
        for (const r of t.rows) {
          expect(r.points).toBe(3 * r.won + r.drawn);
          expect(r.played).toBe(r.won + r.drawn + r.lost);
        }
        const sum = (f: (r: (typeof t.rows)[number]) => number) => t.rows.reduce((s, r) => s + f(r), 0);
        expect(sum((r) => r.won)).toBe(sum((r) => r.lost));
        expect(sum((r) => r.goalsFor)).toBe(sum((r) => r.goalsAgainst));
      }),
    );
  });

  it('Reihenfolge der Spiele und Teams in der Eingabe ändert nichts', () => {
    fc.assert(
      fc.property(groupArb, fc.integer(), (input, salt) => {
        const rotate = <T,>(xs: readonly T[]) => {
          const k = xs.length === 0 ? 0 : Math.abs(salt) % xs.length;
          return [...xs.slice(k), ...xs.slice(0, k)];
        };
        const a = calculateGroupTable(input);
        const b = calculateGroupTable({ ...input, teams: rotate(input.teams), matches: [...rotate(input.matches)].reverse() });
        expect(b.rows).toEqual(a.rows);
        expect(b.openLots).toEqual(a.openLots);
      }),
    );
  });

  it('mit einem Los über alle Teams bleibt kein Gleichstand offen', () => {
    fc.assert(
      fc.property(groupArb, (input) => {
        fc.pre((input.lots ?? []).length > 0);
        expect(calculateGroupTable(input).openLots).toEqual([]);
      }),
    );
  });

  it('jeder Platz ab dem zweiten ist entschieden oder steht in einem offenen Los', () => {
    fc.assert(
      fc.property(groupArb, (input) => {
        const t = calculateGroupTable(input);
        const inOpenLot = new Set(t.openLots.flatMap((g) => g.slice(1)));
        for (const r of t.rows.slice(1)) expect(r.decidedBy !== undefined || inOpenLot.has(r.teamId)).toBe(true);
        expect(t.rows[0]?.decidedBy).toBeUndefined();
      }),
    );
  });
});
