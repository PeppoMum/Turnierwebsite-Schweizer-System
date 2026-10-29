// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { FORMAT_TEMPLATES } from '../format/templates';
import type { KnockoutStage, SlotRef } from '../format/types';
import { type BracketMatch, buildBracket, buildFormatBrackets, matchLabel, meetingRound, placementMatches, standardSeedOrder } from './bracket';
import { entrySlots } from './entry';

const stage = (size: KnockoutStage['size'], extra: Partial<KnockoutStage> = {}): KnockoutStage => ({
  id: 'ko',
  kind: 'knockout',
  name: 'Endrunde',
  phase: 1,
  color: 'gold',
  entry: { fromStageId: 'v', places: [1, 2] },
  size,
  pairing: 'crossover',
  thirdPlace: true,
  allPlaces: false,
  drawDecider: 'penalties',
  ...extra,
});

const groupsStage = (groupCount: number) => ({
  id: 'v',
  kind: 'groups' as const,
  name: 'Vorrunde',
  phase: 0,
  color: 'neutral' as const,
  entry: null,
  groupCount,
  doubleRoundRobin: false,
  draw: 'random' as const,
  fixedFields: false,
});

function label(s: SlotRef): string {
  switch (s.kind) {
    case 'group_place':
      return `${s.place}${String.fromCharCode(65 + s.group)}`;
    case 'best_of_place':
      return `${s.place}.#${s.rank}`;
    case 'table_place':
      return `T${s.place}`;
    case 'winner':
      return `S:${s.matchKey}`;
    case 'loser':
      return `V:${s.matchKey}`;
    case 'team':
      return s.teamId;
  }
}

const pairs = (ms: BracketMatch[], round = 1) => ms.filter((m) => m.round === round).map((m) => `${m.key} ${label(m.slotA)}-${label(m.slotB)}`);

function slotsFor(places: number[], groupCount: number, best?: { place: number; count: number }[], groupSize = 4) {
  return entrySlots({ fromStageId: 'v', places, ...(best ? { best } : {}) }, groupsStage(groupCount), Array(groupCount).fill(groupSize));
}

describe('standardSeedOrder', () => {
  it('liefert die übliche Setzreihenfolge', () => {
    expect(standardSeedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(standardSeedOrder(4)).toEqual([1, 4, 2, 3]);
  });
});

describe('meetingRound', () => {
  it('berechnet, wann sich Erstrundenspiele frühestens treffen', () => {
    expect(meetingRound(0, 0)).toBe(1);
    expect(meetingRound(0, 1)).toBe(2);
    expect(meetingRound(1, 2)).toBe(3);
    expect(meetingRound(0, 3)).toBe(3);
    expect(meetingRound(0, 4)).toBe(4);
  });
});

describe('buildBracket', () => {
  it('2 Gruppen, Halbfinale über Kreuz, Finale und Spiel um Platz 3', () => {
    const ms = buildBracket(stage(4), slotsFor([1, 2], 2));
    expect(pairs(ms)).toEqual(['SF1 1A-2B', 'SF2 1B-2A']);
    expect(pairs(ms, 2)).toEqual(['F S:SF1-S:SF2', 'P3 V:SF1-V:SF2']);
    expect(ms.find((m) => m.key === 'F')?.range).toEqual({ from: 1, to: 2 });
    expect(ms.find((m) => m.key === 'P3')?.range).toEqual({ from: 3, to: 4 });
  });

  it('ohne Spiel um Platz 3 gibt es nur das Finale', () => {
    const ms = buildBracket(stage(4, { thirdPlace: false }), slotsFor([1, 2], 2));
    expect(ms.map((m) => m.key)).toEqual(['SF1', 'SF2', 'F']);
  });

  it('2 Gruppen mit je 4 Weiterkommenden: 1. A gegen 4. B, 2. A gegen 3. B …', () => {
    const ms = buildBracket(stage(8), slotsFor([1, 2, 3, 4], 2));
    expect(pairs(ms)).toEqual(['QF1 1A-4B', 'QF2 2B-3A', 'QF3 1B-4A', 'QF4 2A-3B']);
    // Die beiden Gruppenersten treffen sich erst im Finale.
  });

  it('4 Gruppen, Platz 1 und 2: über Kreuz, Teams einer Gruppe erst im Finale', () => {
    const ms = buildBracket(stage(8), slotsFor([1, 2], 4));
    expect(pairs(ms)).toEqual(['QF1 1A-2B', 'QF2 1D-2C', 'QF3 1B-2A', 'QF4 1C-2D']);
  });

  it('12 Teams: Gruppenerste, -zweite und 2 beste Dritte nach Setzliste ohne Gruppenduell in Runde 1', () => {
    const ms = buildBracket(stage(8, { pairing: 'seeded' }), slotsFor([1, 2], 3, [{ place: 3, count: 2 }]));
    const first = ms.filter((m) => m.round === 1);
    for (const m of first) {
      if (m.slotA.kind === 'group_place' && m.slotB.kind === 'group_place') expect(m.slotA.group).not.toBe(m.slotB.group);
    }
    // Gruppensieger gegen die besten Dritten
    expect(pairs(ms)).toContain('QF1 1A-3.#2');
    expect(pairs(ms).some((p) => p.includes('1B-3.#1'))).toBe(true);
  });

  it('alle Plätze: Platzierungsrunden für 5–8', () => {
    const ms = buildBracket(stage(8, { allPlaces: true }), slotsFor([1, 2], 4));
    expect(ms.map((m) => `${m.round}:${m.key}`)).toEqual([
      '1:QF1',
      '1:QF2',
      '1:QF3',
      '1:QF4',
      '2:SF1',
      '2:SF2',
      '2:P5_SF1',
      '2:P5_SF2',
      '3:F',
      '3:P3',
      '3:P5',
      '3:P7',
    ]);
    expect(ms.find((m) => m.key === 'P5_SF1')).toMatchObject({ slotA: { kind: 'loser', matchKey: 'QF1' }, range: { from: 5, to: 8 } });
    expect(ms.find((m) => m.key === 'P7')).toMatchObject({ slotA: { kind: 'loser', matchKey: 'P5_SF1' }, range: { from: 7, to: 8 } });
  });

  it('markiert reine Neunmeterspiele', () => {
    const ms = buildBracket(stage(4, { penaltyOnlyMatchKeys: ['P3'] }), slotsFor([1, 2], 2));
    expect(ms.filter((m) => m.penaltyOnly).map((m) => m.key)).toEqual(['P3']);
  });

  it('Finale mit zwei Teams', () => {
    const ms = buildBracket(stage(2), slotsFor([1], 2));
    expect(pairs(ms)).toEqual(['F 1A-1B']);
  });

  it('verweigert die falsche Teamzahl', () => {
    expect(() => buildBracket(stage(8), slotsFor([1, 2], 3))).toThrow(RangeError);
  });

  it('baut für jede Vorlage alle Spiele', () => {
    for (const t of FORMAT_TEMPLATES) {
      const ms = buildFormatBrackets(t.build(), t.teamCount);
      expect(ms.length, t.id).toBeGreaterThan(0);
      expect(new Set(ms.map((m) => `${m.stageId}|${m.key}`)).size, t.id).toBe(ms.length);
    }
    const t10 = FORMAT_TEMPLATES.find((t) => t.id === 't10')!;
    expect(buildFormatBrackets(t10.build(), 10).filter((m) => m.stageId === 'platzierung').map((m) => m.key)).toEqual(['P5', 'P7', 'P9']);
  });
});

describe('placementMatches', () => {
  it('rechnet Plätze relativ zum Abschnitt', () => {
    const t8 = FORMAT_TEMPLATES.find((t) => t.id === 't8')!.build();
    const placement = t8.stages.find((s) => s.kind === 'placement');
    if (placement?.kind !== 'placement') throw new Error('fehlt');
    expect(placementMatches(placement).map((m) => m.range)).toEqual([
      { from: 1, to: 2 },
      { from: 3, to: 4 },
    ]);
  });
});

describe('matchLabel', () => {
  it('benennt Spiele verständlich', () => {
    expect(matchLabel('QF2')).toBe('Viertelfinale 2');
    expect(matchLabel('R16_3')).toBe('Achtelfinale 3');
    expect(matchLabel('F')).toBe('Finale');
    expect(matchLabel('P3')).toBe('Spiel um Platz 3');
    expect(matchLabel('P3', 8)).toBe('Spiel um Platz 11');
    expect(matchLabel('P5_SF1')).toBe('Halbfinale 1, Platz 5–8');
  });
});

describe('Eigenschaften des Baums', () => {
  const configs = [
    { groups: 2, places: 1 },
    { groups: 2, places: 2 },
    { groups: 4, places: 1 },
    { groups: 2, places: 4 },
    { groups: 4, places: 2 },
    { groups: 8, places: 1 },
    { groups: 2, places: 8 },
    { groups: 4, places: 4 },
    { groups: 8, places: 2 },
    { groups: 8, places: 4 },
    { groups: 4, places: 8 },
  ];

  it('jedes Team genau einmal, jeder Sieger/Verlierer genau einmal weiter, Teams einer Gruppe so spät wie möglich', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...configs),
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom<KnockoutStage['pairing']>('crossover', 'seeded'),
        ({ groups, places }, thirdPlace, allPlaces, pairing) => {
          const size = (groups * places) as KnockoutStage['size'];
          const entrants = slotsFor(
            Array.from({ length: places }, (_, i) => i + 1),
            groups,
            undefined,
            places,
          );
          const ms = buildBracket(stage(size, { thirdPlace, allPlaces, pairing }), entrants);
          const first = ms.filter((m) => m.round === 1);
          const leaves = first.flatMap((m) => [m.slotA, m.slotB]);
          expect(new Set(leaves.map(label)).size).toBe(size);
          expect(leaves.every((s) => s.kind === 'group_place')).toBe(true);

          const keys = new Map(ms.map((m) => [m.key, m]));
          const refs = ms.flatMap((m) => [m.slotA, m.slotB]).filter((s) => s.kind === 'winner' || s.kind === 'loser');
          expect(new Set(refs.map(label)).size).toBe(refs.length);
          for (const m of ms) {
            for (const s of [m.slotA, m.slotB]) {
              if (s.kind === 'winner' || s.kind === 'loser') expect(keys.get(s.matchKey)!.round).toBe(m.round - 1);
            }
          }
          const rounds = Math.log2(size);
          const expected = allPlaces ? (size / 2) * rounds : size - 1 + (thirdPlace && size >= 4 ? 1 : 0);
          expect(ms).toHaveLength(expected);

          // Gruppengleiche in Runde 1 nie, und in jeder Hälfte höchstens so viele wie nötig.
          if (groups >= 2) {
            for (const m of first) expect(label(m.slotA).slice(-1)).not.toBe(label(m.slotB).slice(-1));
          }
          const half = leaves.slice(0, size / 2);
          for (let g = 0; g < groups; g++) {
            const inTop = half.filter((s) => s.kind === 'group_place' && s.group === g).length;
            expect(Math.abs(2 * inTop - places)).toBeLessThanOrEqual(places % 2);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
