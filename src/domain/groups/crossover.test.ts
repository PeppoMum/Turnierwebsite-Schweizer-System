import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { SlotRef } from '../format/types';
import { crossoverGroups } from './crossover';

const label = (s: SlotRef) => {
  if (s.kind === 'group_place') return `${s.place}${String.fromCharCode(65 + s.group)}`;
  if (s.kind === 'best_of_place') return `best${s.place}#${s.rank}`;
  return '?';
};

describe('Zwischenrunde über Kreuz', () => {
  it('bildet das Beispiel aus der Absprache: E = 1A 2B 1C 2D, F = 1B 2A 1D 2C', () => {
    const groups = crossoverGroups({ fromStageId: 'vorrunde', places: [1, 2] }, 4, 2);
    expect(groups.map((g) => g.map(label))).toEqual([
      ['1A', '2B', '1C', '2D'],
      ['2A', '1B', '2C', '1D'],
    ]);
    expect(groups.flat().every((s) => s.kind === 'group_place' && s.stageId === 'vorrunde')).toBe(true);
  });

  it('verteilt beste Dritte auf die Gruppen', () => {
    const groups = crossoverGroups({ fromStageId: 'v', places: [1, 2], best: [{ place: 3, count: 2 }] }, 3, 2);
    expect(groups.map((g) => g.length)).toEqual([4, 4]);
    expect(groups.map((g) => g.filter((s) => s.kind === 'best_of_place').length)).toEqual([1, 1]);
  });

  it('Eigenschaft: gleich große Gruppen, jeder Platz genau einmal, keine Vorrunden-Gruppe doppelt wenn vermeidbar', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8 }), fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 6 }), (prev, placeCount, next) => {
        const places = Array.from({ length: placeCount }, (_, i) => i + 1);
        fc.pre(prev * placeCount >= 2 * next);
        const groups = crossoverGroups({ fromStageId: 'v', places }, prev, next);
        const sizes = groups.map((g) => g.length);
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
        const all = groups.flat().map(label);
        expect(new Set(all).size).toBe(prev * placeCount);
        const maxSame = Math.max(
          ...groups.flatMap((g) => {
            const count = new Map<number, number>();
            for (const s of g) if (s.kind === 'group_place') count.set(s.group, (count.get(s.group) ?? 0) + 1);
            return [...count.values()];
          }),
        );
        expect(maxSame).toBeLessThanOrEqual(Math.ceil(placeCount / next));
      }),
    );
  });
});
