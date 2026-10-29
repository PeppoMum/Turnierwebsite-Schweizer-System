import { describe, expect, it } from 'vitest';
import { FORMAT_TEMPLATES } from '../../../domain/format';
import { addFinalRound, checkBuilder, defaultBuilder, entryText, fromFormat, groupSizeText, setFinalsMode, toFormat } from './builder';
import { buildStageMatches, planCreation, toPlannedMatches } from './plan';

const fields = [1, 2, 3, 4].map((i) => ({
  id: `f${i}`,
  name: `Platz ${i}`,
  order: i,
  active: true,
}));
const constraints = {
  tournamentStartISO: '2026-11-07T09:00:00.000Z',
  matchMinutes: 12,
  turnoverMinutes: 3,
  roundBreakMinutes: 5,
  evenRest: true,
};

describe('Baukasten im Assistenten', () => {
  it.each(FORMAT_TEMPLATES.map((t) => [t.id, t] as const))('übersetzt die Vorlage %s hin und zurück ohne Verlust', (_, t) => {
    const format = t.build();
    const state = fromFormat(format, t.id);
    expect(checkBuilder(state, t.teamCount).errors).toEqual([]);
    const back = toFormat(state, t.teamCount, 'random')!;
    expect(back.stages.map((s) => [s.id, s.kind, s.phase, s.entry, s.placeRange])).toEqual(
      format.stages.map((s) => [s.id, s.kind, s.phase, s.entry, s.placeRange]),
    );
    const ko = (f: typeof format) => f.stages.filter((s) => s.kind === 'knockout').map((s) => s.kind === 'knockout' && [s.size, s.pairing, s.thirdPlace]);
    expect(ko(back)).toEqual(ko(format));
    const placement = (f: typeof format) => f.stages.flatMap((s) => (s.kind === 'placement' ? s.matches : []));
    expect(placement(back)).toEqual(placement(format));
  });

  it('meldet einen K.-o.-Baum, der nicht aufgeht', () => {
    const s = fromFormat(FORMAT_TEMPLATES.find((t) => t.id === 't12')!.build());
    const broken = {
      ...s,
      finals: [{ ...s.finals[0]!, best: { place: 3, count: 1 } }],
    };
    expect(checkBuilder(broken, 12).errors.join(' ')).toMatch(/7 Mannschaften. Für K.-o. braucht es/);
  });

  it('zählt Ausgeschiedene: 20 Teams, Gold 1+2, Silber 3+4, die Fünften fahren heim', () => {
    const s = fromFormat(FORMAT_TEMPLATES.find((t) => t.id === 't20')!.build());
    expect(checkBuilder(s, 20)).toMatchObject({ errors: [], eliminated: 4 });
  });

  it('meldet doppelt vergebene Plätze', () => {
    const s = setFinalsMode(defaultBuilder(), 'tiers', 16);
    const twice = {
      ...s,
      finals: s.finals.map((r) => ({ ...r, places: [1] })),
    };
    expect(checkBuilder(twice, 16).errors.join(' ')).toMatch(/Platz 1 ist schon/);
  });

  it('Gold/Silber/Bronze bei 4 Gruppen zu 4: zwei Endrunden zu 8', () => {
    const s = setFinalsMode({ ...defaultBuilder(), groupCount: 4, placement: false }, 'tiers', 16);
    expect(s.finals.map((r) => r.places)).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(checkBuilder(s, 16).errors).toEqual([]);
    expect(addFinalRound(s, 16).finals).toHaveLength(3);
  });

  it('beschreibt Einstiegsregeln und Gruppengrößen in Alltagssprache', () => {
    expect(entryText({ places: [2, 1], best: { place: 3, count: 2 } })).toBe('Platz 1 und 2 · dazu die 2 besten Dritten');
    expect(entryText({ places: [], best: { place: 2, count: 1 } })).toBe('der beste Zweite');
    expect(groupSizeText([5, 5, 4, 4])).toBe('2 Gruppen zu 5, 2 Gruppen zu 4');
    expect(groupSizeText([4, 4, 4, 4])).toBe('4 Gruppen zu je 4');
  });

  it('nimmt Schweizer System nicht in den Baukasten', () => {
    expect(toFormat({ ...defaultBuilder(), prelim: 'swiss' }, 8, 'random')).toBeNull();
  });
});

describe('Spielgerüst beim Anlegen', () => {
  it('16 Teams, Gold und Silber: Gruppenspiele mit Teams, Viertelfinale über Kreuz', () => {
    const t = FORMAT_TEMPLATES.find((x) => x.id === 't16')!;
    const format = t.build();
    const groups = [0, 1, 2, 3].map((g) => [0, 1, 2, 3].map((i) => `T${g * 4 + i}`));
    const matches = buildStageMatches(format, 16, groups);
    expect(matches.filter((m) => m.stageId === 'vorrunde')).toHaveLength(24);
    expect(matches.filter((m) => m.stageId === 'vorrunde').every((m) => m.teamAId && m.teamBId)).toBe(true);
    const qf = matches.filter((m) => m.stageId === 'gold' && /^QF/.test(m.matchKey ?? ''));
    expect(qf).toHaveLength(4);
    for (const m of qf) {
      expect(m.slotA?.kind).toBe('group_place');
      expect(m.slotB?.kind).toBe('group_place');
      if (m.slotA?.kind === 'group_place' && m.slotB?.kind === 'group_place') expect(m.slotA.group).not.toBe(m.slotB.group);
    }
    // 1. A und 2. A in verschiedenen Baumhälften.
    const half = (g: number, place: number) =>
      qf.findIndex((m) => [m.slotA, m.slotB].some((s) => s?.kind === 'group_place' && s.group === g && s.place === place)) < 2 ? 0 : 1;
    for (let g = 0; g < 4; g++) expect(half(g, 1)).not.toBe(half(g, 2));
    expect(matches.some((m) => m.stageId === 'silber' && m.matchKey === 'F')).toBe(true);
  });

  it('plant alle Spiele mit Zeit und Feld und übernimmt eigene Finaldauer und Neunmeter-Spiele', () => {
    const format = FORMAT_TEMPLATES.find((x) => x.id === 't12')!.build();
    const ko = format.stages[1]!;
    if (ko.kind === 'knockout') {
      ko.finalMatchMinutes = 20;
      ko.penaltyOnlyMatchKeys = ['P3'];
    }
    const plan = planCreation(format, 12, fields, constraints);
    expect(plan.day.problems).toEqual([]);
    const saved = toPlannedMatches(format, plan, 12);
    expect(saved.every((m) => m.startISO && m.fieldId)).toBe(true);
    expect(saved.find((m) => m.matchKey === 'F')!.durationMinutes).toBe(20);
    expect(saved.find((m) => m.matchKey === 'P3')!.penaltyOnly).toBe(true);
    expect(saved.filter((m) => m.slotA?.kind === 'best_of_place' || m.slotB?.kind === 'best_of_place')).toHaveLength(2);
  });

  it('nimmt Baum und Schlüssel aus der K.-o.-Logik: alle Plätze ausspielen bei 8 Teams', () => {
    const format = FORMAT_TEMPLATES.find((x) => x.id === 't12')!.build();
    const ko = format.stages[1]!;
    if (ko.kind === 'knockout') ko.allPlaces = true;
    const keys = buildStageMatches(format, 12)
      .filter((m) => m.stageId === 'endrunde')
      .map((m) => m.matchKey);
    expect(keys).toEqual(expect.arrayContaining(['QF1', 'SF1', 'F', 'P3', 'P5_SF1', 'P5', 'P7']));
    expect(keys).toHaveLength(12);
  });

  it('Zwischenrunde über Kreuz bekommt Platzhalter aus der Vorrunde', () => {
    const s = {
      ...defaultBuilder(),
      groupCount: 4,
      placement: false,
      intermediate: { groupCount: 2, places: [1, 2], carryOverPoints: false },
    };
    const state = setFinalsMode(s, 'knockout', 16);
    const format = toFormat({ ...state, finals: [{ ...state.finals[0]!, places: [1, 2] }] }, 16, 'random')!;
    expect(checkBuilder({ ...state, finals: [{ ...state.finals[0]!, places: [1, 2] }] }, 16).errors).toEqual([]);
    const matches = buildStageMatches(format, 16);
    const mid = matches.filter((m) => m.stageId === 'zwischenrunde');
    expect(mid).toHaveLength(12);
    expect(mid.every((m) => m.slotA?.kind === 'group_place' && m.slotA.stageId === 'vorrunde')).toBe(true);
    expect(
      matches
        .filter((m) => m.stageId === 'endrunde' && m.matchKey?.startsWith('SF'))
        .every((m) => m.slotA?.kind === 'group_place' && m.slotA.stageId === 'zwischenrunde'),
    ).toBe(true);
  });
});
