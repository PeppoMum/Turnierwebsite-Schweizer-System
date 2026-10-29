import { describe, expect, it } from 'vitest';
import { entrySlots, validateFormat } from '../knockout/entry';
import { adaptFinals, expectedStageSizes, finalsMismatches, reshapeSuggestions } from './reshape';
import { FORMAT_TEMPLATES } from './templates';
import type { GroupStage, KnockoutStage, StageConfig, TournamentFormat } from './types';

const template = (id: string) => FORMAT_TEMPLATES.find((t) => t.id === id)!.build();

/** Phils Beispiel: 16 Teams, 4 Gruppen, Gold 8 (1. und 2.), Silber 4 (Dritte), Bronze 4 (Vierte). */
function goldSilverBronze(): TournamentFormat {
  const t = template('t16');
  const gold = t.stages[1] as KnockoutStage;
  const ko = (id: string, name: string, color: KnockoutStage['color'], place: number, from: number): KnockoutStage => ({
    ...gold,
    id,
    name,
    color,
    size: 4,
    entry: { fromStageId: 'vorrunde', places: [place] },
    placeRange: { from, to: from + 3 },
  });
  return { ...t, stages: [t.stages[0]!, gold, ko('silber', 'Silberrunde', 'silver', 3, 9), ko('bronze', 'Bronzerunde', 'bronze', 4, 13)] };
}

function groupsOf(sizes: number[]): string[][] {
  let n = 0;
  return sizes.map((s) => Array.from({ length: s }, () => `t${++n}`));
}

const stage = (f: TournamentFormat, id: string) => f.stages.find((s) => s.id === id) as StageConfig;
const teamCount = (f: TournamentFormat) => ((f.stages[0] as GroupStage).groupSizes ?? []).reduce((a, b) => a + b, 0);

describe('expectedStageSizes / finalsMismatches', () => {
  it('meldet Bronze mit 3 statt 4, wenn eine Gruppe nur 3 Teams hat', () => {
    const f = goldSilverBronze();
    expect(Object.fromEntries(expectedStageSizes(f, [4, 4, 4, 3]))).toEqual({ gold: 8, silber: 4, bronze: 3 });
    expect(finalsMismatches(f, [4, 4, 4, 3])).toEqual([{ stageId: 'bronze', name: 'Bronzerunde', capacity: 4, count: 3 }]);
    expect(finalsMismatches(f, [4, 4, 4, 4])).toEqual([]);
  });
});

describe('adaptFinals', () => {
  it('macht Bronze mit 3 Teams zur Dreiergruppe (Standard) oder streicht sie mit geteilten Plätzen', () => {
    const f = goldSilverBronze();
    const group = adaptFinals(f, [4, 4, 4, 3], {}, [4, 4, 4, 4]);
    expect(group.changedStageIds).toEqual(['bronze']);
    expect(group.threeTeamStages).toEqual([{ stageId: 'bronze', name: 'Bronzerunde', placeFrom: 13, placeTo: 15 }]);
    expect(stage(group.format, 'bronze')).toMatchObject({ kind: 'final_group', placeRange: { from: 13, to: 15 }, entry: { places: [4] } });
    expect(stage(group.format, 'gold')).toBe(f.stages[1]);
    expect(validateFormat(group.format, 15)).toEqual([]);

    const drop = adaptFinals(f, [4, 4, 4, 3], { bronze: 'drop' }, [4, 4, 4, 4]);
    const bronze = stage(drop.format, 'bronze');
    expect(bronze.kind).toBe('placement');
    if (bronze.kind !== 'placement') return;
    expect(bronze.matches).toEqual([]);
    expect(bronze.byes?.map((b) => [b.place, b.placeTo])).toEqual([
      [13, 15],
      [13, 15],
      [13, 15],
    ]);
    expect(drop.notes[0]).toContain('teilen sich Plätze 13–15');
    expect(validateFormat(drop.format, 15)).toEqual([]);
  });

  it('16 → 15 mit 3 Gruppen zu 5: Gold mit den 2 besten Dritten, Silber der übrige Dritte und die Vierten, Bronze die Fünften', () => {
    const r = adaptFinals(goldSilverBronze(), [5, 5, 5], {}, [4, 4, 4, 4]);
    expect(stage(r.format, 'gold').entry).toEqual({ fromStageId: 'vorrunde', places: [1, 2], best: [{ place: 3, count: 2 }] });
    expect((stage(r.format, 'gold') as KnockoutStage).pairing).toBe('seeded');
    expect(stage(r.format, 'silber').entry).toEqual({ fromStageId: 'vorrunde', places: [4], best: [{ place: 3, count: 1, fromRank: 3 }] });
    expect(stage(r.format, 'bronze')).toMatchObject({ kind: 'final_group', entry: { places: [5] }, placeRange: { from: 13, to: 15 } });
    expect(validateFormat(r.format, 15)).toEqual([]);
    const silber = stage(r.format, 'silber');
    const slots = entrySlots(silber.entry!, r.format.stages[0]!, [5, 5, 5]);
    expect(slots[0]).toEqual({ kind: 'best_of_place', stageId: 'vorrunde', place: 3, rank: 3 });
  });

  it('teilt eine Silberrunde mit 7 statt 8 Teams in K.-o. mit 4 und eine Dreiergruppe (Notlösung)', () => {
    const r = adaptFinals(template('t16'), [4, 4, 4, 3], {}, [4, 4, 4, 4]);
    expect(r.format.stages.map((s) => [s.id, s.kind, s.placeRange?.from, s.placeRange?.to])).toEqual([
      ['vorrunde', 'groups', undefined, undefined],
      ['gold', 'knockout', 1, 8],
      ['silber', 'knockout', 9, 12],
      ['silber_2', 'final_group', 13, 15],
    ]);
    expect(stage(r.format, 'silber').entry).toEqual({ fromStageId: 'vorrunde', places: [3] });
    expect(stage(r.format, 'silber_2').entry).toEqual({ fromStageId: 'vorrunde', places: [4] });
    expect(validateFormat(r.format, 15)).toEqual([]);
  });

  it('Bronze mit 2 Teams wird ein einzelnes Spiel', () => {
    const r = adaptFinals(goldSilverBronze(), [4, 4, 3, 3], {}, [4, 4, 4, 4]);
    expect(stage(r.format, 'bronze')).toMatchObject({ kind: 'knockout', size: 2, placeRange: { from: 13, to: 14 } });
    expect(validateFormat(r.format, 14)).toEqual([]);
  });

  it('8 Teams, eins fehlt: Platz 7 ohne Spiel', () => {
    const r = adaptFinals(template('t8'), [4, 3], {}, [4, 4]);
    const p = stage(r.format, 'platzierung');
    expect(p).toMatchObject({ kind: 'placement', placeRange: { from: 5, to: 7 } });
    if (p.kind !== 'placement') return;
    expect(p.matches.map((m) => m.key)).toEqual(['P5']);
    expect(p.byes).toEqual([{ slot: { kind: 'group_place', stageId: 'vorrunde', group: 0, place: 4 }, place: 7 }]);
    expect(validateFormat(r.format, 7)).toEqual([]);
  });

  it('10 Teams, zwei aus einer Gruppe fehlen: Plätze 7 und 8 ohne Spiel, Bereich passt', () => {
    const r = adaptFinals(template('t10'), [5, 3], {}, [5, 5]);
    const p = stage(r.format, 'platzierung');
    if (p.kind !== 'placement') throw new Error('kein Platzierungsabschnitt');
    expect(p.byes?.map((b) => b.place)).toEqual([7, 8]);
    expect(p.placeRange).toEqual({ from: 5, to: 8 });
    expect(validateFormat(r.format, 8)).toEqual([]);
  });

  it('lässt 20 → 19 und 12 → 11 unverändert, bis auf die Gruppengrößen', () => {
    for (const [id, sizes, full] of [
      ['t20', [5, 5, 5, 4], [5, 5, 5, 5]],
      ['t12', [4, 4, 3], [4, 4, 4]],
      ['t12', [4, 3, 3], [4, 4, 4]],
    ] as const) {
      const f = template(id);
      const r = adaptFinals(f, sizes, {}, full);
      expect(r.changedStageIds, id).toEqual([]);
      expect(r.format.stages.slice(1)).toEqual(f.stages.slice(1));
      expect(validateFormat(r.format, teamCount(r.format)), id).toEqual([]);
    }
  });
});

describe('reshapeSuggestions', () => {
  it('16 → 15: erst 3 Gruppen mit je 5, dann „Lücke lassen“', () => {
    const groups = groupsOf([4, 4, 4, 4]);
    const s = reshapeSuggestions({ format: goldSilverBronze(), groups, missingTeamIds: ['t14'], groupsStarted: false });
    expect(s.map((x) => [x.kind, x.title])).toEqual([
      ['regroup', '3 Gruppen mit je 5'],
      ['gap', 'Lücke lassen'],
    ]);
    expect(s[0]!.groups.map((g) => g.length)).toEqual([5, 5, 5]);
    expect(s[0]!.summary).toContain('Gruppe D wird aufgelöst');
    expect(s[0]!.groups.flat()).not.toContain('t14');
    expect(s[1]!.groups).toEqual([groups[0], groups[1], groups[2], ['t13', 't15', 't16']]);
    expect(s[1]!.threeTeamStages.map((x) => x.stageId)).toEqual(['bronze']);
    for (const x of s) expect(validateFormat(x.format, 15), x.kind).toEqual([]);
  });

  it('nie eine Gruppe mit 2 Teams: ein Team wechselt herüber, die Turnierleitung-Funktion wählt welches', () => {
    const groups = groupsOf([4, 4]);
    const s = reshapeSuggestions({
      format: template('t8'),
      groups,
      missingTeamIds: ['t7', 't8'],
      groupsStarted: false,
      pickGroups: (c) => c.findIndex((g) => g[1]!.includes('t2')),
    });
    const gap = s.find((x) => x.kind === 'gap')!;
    expect(gap.groups).toEqual([['t1', 't3', 't4'], ['t5', 't6', 't2']]);
    expect(gap.summary).toContain('wechselt ein Team in Gruppe B');
    expect(validateFormat(gap.format, 6)).toEqual([]);
  });

  it('ab 3 Fehlenden steht die nächstkleinere Vorlage vorn', () => {
    const s = reshapeSuggestions({ format: goldSilverBronze(), groups: groupsOf([4, 4, 4, 4]), missingTeamIds: ['t1', 't5', 't9'], groupsStarted: false });
    expect(s[0]!.kind).toBe('template');
    expect(s[0]!.title).toBe('Vorlage 12 Teams');
    expect(s[0]!.groups.map((g) => g.length).sort()).toEqual([4, 4, 5]);
    expect(validateFormat(s[0]!.format, 13)).toEqual([]);
    expect(s.length).toBeLessThanOrEqual(3);
  });

  it('nach dem Anpfiff: nur die Endrunde, Gruppen bleiben', () => {
    const s = reshapeSuggestions({ format: goldSilverBronze(), groups: groupsOf([4, 4, 4, 4]), missingTeamIds: ['t2'], groupsStarted: true });
    expect(s.map((x) => x.kind)).toEqual(['finals']);
    expect(s[0]!.changedStageIds).toEqual(['bronze']);
    expect(s[0]!.groups[0]).toEqual(['t1', 't3', 't4']);
  });

  it('nichts zu tun ohne fehlende Teams', () => {
    expect(reshapeSuggestions({ format: goldSilverBronze(), groups: groupsOf([4, 4, 4, 4]), missingTeamIds: [], groupsStarted: false })).toEqual([]);
  });
});
