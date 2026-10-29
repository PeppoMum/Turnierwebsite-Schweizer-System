import { describe, expect, it } from 'vitest';
import { checkGroupSizes, evenGroupSizes, groupLetter, groupSizesFor } from './sizes';

describe('Gruppengrößen', () => {
  it('verteilt so gleichmäßig wie möglich, größere Gruppen zuerst', () => {
    expect(evenGroupSizes(18, 4)).toEqual([5, 5, 4, 4]);
    expect(evenGroupSizes(16, 4)).toEqual([4, 4, 4, 4]);
    expect(evenGroupSizes(10, 2)).toEqual([5, 5]);
    expect(evenGroupSizes(15, 3)).toEqual([5, 5, 5]);
    expect(evenGroupSizes(7, 1)).toEqual([7]);
  });

  it('nimmt eigene Größen, wenn sie aufgehen', () => {
    expect(groupSizesFor(18, { groupCount: 4, groupSizes: [6, 4, 4, 4] })).toEqual([6, 4, 4, 4]);
    expect(groupSizesFor(18, { groupCount: 4, groupSizes: [6, 6, 4, 4] })).toEqual([5, 5, 4, 4]);
  });

  it('meldet unpassende eigene Größen', () => {
    expect(checkGroupSizes(18, 4, [6, 4, 4, 4])).toEqual([]);
    expect(checkGroupSizes(18, 4, [6, 6, 4, 4])).toEqual(['Die Gruppen fassen 20 Teams, angemeldet sind 18.']);
    expect(checkGroupSizes(10, 3, [9, 1])).toHaveLength(2);
  });

  it('benennt Gruppen mit Buchstaben', () => {
    expect([0, 1, 4, 25, 26, 27].map(groupLetter)).toEqual(['A', 'B', 'E', 'Z', 'AA', 'AB']);
  });
});
