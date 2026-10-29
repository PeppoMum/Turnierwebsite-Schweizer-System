// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FORMAT_TEMPLATES } from '../format/templates';
import type { GroupStage, KnockoutStage, TournamentFormat } from '../format/types';
import { compareAcrossGroups, entryCount, entrySlots, evenGroupSizes, rankBestOfPlace, stageTableSizes, validateFormat } from './entry';
import { row, standings } from './testUtils';

const vorrunde = (groupCount: number): GroupStage => ({
  id: 'v',
  kind: 'groups',
  name: 'Vorrunde',
  phase: 0,
  color: 'neutral',
  entry: null,
  groupCount,
  doubleRoundRobin: false,
  draw: 'random',
  fixedFields: false,
});

const ko = (id: string, size: KnockoutStage['size'], places: number[], best?: { place: number; count: number }[], placeRange: { from: number; to: number } = { from: 1, to: size }): KnockoutStage => ({
  id,
  kind: 'knockout',
  name: id,
  phase: 1,
  color: 'gold',
  entry: { fromStageId: 'v', places, ...(best ? { best } : {}) },
  placeRange,
  size,
  pairing: 'crossover',
  thirdPlace: true,
  allPlaces: false,
  drawDecider: 'penalties',
});

const fmt = (...stages: TournamentFormat['stages']): TournamentFormat => ({ version: 1, stages, tieBreakVariant: 'h2h_first', breakBeforeFinalsMinutes: 15 });

describe('evenGroupSizes', () => {
  it('verteilt gleichmäßig, größere Gruppen zuerst', () => {
    expect(evenGroupSizes(18, 4)).toEqual([5, 5, 4, 4]);
    expect(evenGroupSizes(16, 4)).toEqual([4, 4, 4, 4]);
    expect(evenGroupSizes(15, 3)).toEqual([5, 5, 5]);
  });
});

describe('entrySlots', () => {
  it('ordnet nach Platz, dann Gruppe, dann die Besten', () => {
    const slots = entrySlots({ fromStageId: 'v', places: [1, 2], best: [{ place: 3, count: 2 }] }, vorrunde(3), [4, 4, 4]);
    expect(slots.map((s) => (s.kind === 'group_place' ? `${s.place}${'ABC'[s.group]}` : s.kind === 'best_of_place' ? `${s.place}#${s.rank}` : '?'))).toEqual([
      '1A',
      '1B',
      '1C',
      '2A',
      '2B',
      '2C',
      '3#1',
      '3#2',
    ]);
  });

  it('lässt Plätze weg, die eine kleinere Gruppe nicht hat', () => {
    const slots = entrySlots({ fromStageId: 'v', places: [5] }, vorrunde(4), [5, 5, 4, 4]);
    expect(slots).toHaveLength(2);
    expect(entryCount({ fromStageId: 'v', places: [5] }, [5, 5, 4, 4])).toBe(2);
  });
});

describe('Vergleich über Gruppen', () => {
  it('vergleicht Punkte pro Spiel, dann Tordifferenz pro Spiel, dann Tore pro Spiel', () => {
    // 7 Punkte aus 4 Spielen (1,75) schlägt 5 aus 3 (1,67)
    expect(compareAcrossGroups(row('a', 3, { points: 7, played: 4 }), row('b', 3, { points: 5, played: 3 }))).toBeLessThan(0);
    // gleicher Quotient, Tordifferenz pro Spiel: +4 in 4 Spielen (1,0) schlägt +2 in 3 (0,67)
    expect(
      compareAcrossGroups(row('a', 3, { points: 4, played: 4, goalsFor: 8, goalsAgainst: 4 }), row('b', 3, { points: 3, played: 3, goalsFor: 5, goalsAgainst: 3 })),
    ).toBeLessThan(0);
    // dann Tore pro Spiel
    expect(
      compareAcrossGroups(row('a', 3, { points: 3, played: 3, goalsFor: 3, goalsAgainst: 3 }), row('b', 3, { points: 3, played: 3, goalsFor: 6, goalsAgainst: 6 })),
    ).toBeGreaterThan(0);
  });

  it('meldet Gleichstand ohne Los und nimmt das Los, wenn vorhanden', () => {
    const st = standings('v', [['A1', 'A2', 'A3'], ['B1', 'B2', 'B3'], ['C1', 'C2', 'C3']], true, {
      A3: { points: 1, played: 2 },
      B3: { points: 1, played: 2 },
      C3: { points: 0, played: 2 },
    });
    const open = rankBestOfPlace(st, 3);
    expect(open.rows.map((r) => r.row.teamId)).toEqual(['A3', 'B3', 'C3']);
    expect(open.needsLot).toEqual([['A3', 'B3']]);
    const drawn = rankBestOfPlace(st, 3, ['B3', 'A3']);
    expect(drawn.rows.map((r) => r.row.teamId)).toEqual(['B3', 'A3', 'C3']);
    expect(drawn.needsLot).toEqual([]);
  });
});

describe('validateFormat', () => {
  it('akzeptiert alle Vorlagen', () => {
    for (const t of FORMAT_TEMPLATES) expect(validateFormat(t.build(), t.teamCount), t.id).toEqual([]);
  });

  it('meldet, wenn die Regel nicht genau die Baumgröße ergibt', () => {
    const issues = validateFormat(fmt(vorrunde(3), ko('end', 8, [1, 2])), 12);
    expect(issues.map((i) => i.code)).toContain('count_mismatch');
    expect(issues.find((i) => i.code === 'count_mismatch')?.message).toBe('end braucht genau 8 Teams, die Regel ergibt aber 6.');
  });

  it('meldet einen Platz, der in zwei Endrunden vorkommt', () => {
    const issues = validateFormat(fmt(vorrunde(4), ko('gold', 8, [1, 2]), ko('silber', 8, [2, 3], undefined, { from: 9, to: 16 })), 16);
    expect(issues.filter((i) => i.code === 'slot_taken_twice')).toHaveLength(4);
  });

  it('meldet beste Dritte, wenn die Dritten schon fest woanders hin gehen', () => {
    const issues = validateFormat(fmt(vorrunde(4), ko('gold', 8, [1], [{ place: 3, count: 4 }]), ko('silber', 8, [2, 3], undefined, { from: 9, to: 16 })), 16);
    expect(issues.map((i) => i.code)).toContain('slot_taken_twice');
  });

  it('meldet überlappende Platzbereiche und falsche Bereichsgröße', () => {
    const issues = validateFormat(fmt(vorrunde(4), ko('gold', 8, [1, 2]), ko('silber', 8, [3, 4], undefined, { from: 8, to: 15 })), 16);
    expect(issues.map((i) => i.code)).toEqual(['range_overlap']);
    const wrongSize = validateFormat(fmt(vorrunde(4), ko('gold', 8, [1, 2], undefined, { from: 1, to: 6 })), 16);
    expect(wrongSize.map((i) => i.code)).toEqual(['range_size']);
  });

  it('meldet zu viele Beste und fehlende Plätze', () => {
    expect(validateFormat(fmt(vorrunde(3), ko('end', 8, [1, 2], [{ place: 3, count: 4 }])), 12).map((i) => i.code)).toEqual(
      expect.arrayContaining(['best_too_many']),
    );
    expect(validateFormat(fmt(vorrunde(4), ko('end', 4, [5])), 16).map((i) => i.code)).toEqual(expect.arrayContaining(['place_missing']));
  });

  it('erlaubt 18 Teams mit Gold 1+2, Silber 3+4 und ausgeschiedenen Fünften', () => {
    const f = fmt(vorrunde(4), ko('gold', 8, [1, 2]), ko('silber', 8, [3, 4], undefined, { from: 9, to: 16 }));
    expect(validateFormat(f, 18)).toEqual([]);
    expect(stageTableSizes(f, 18).get('v')).toEqual([5, 5, 4, 4]);
  });
});
