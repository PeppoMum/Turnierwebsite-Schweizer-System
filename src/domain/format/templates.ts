// Fertige Vorlagen für Phils typische Turniere (Entscheidung vom 29.10.2026).
// Beim Anlegen ist danach noch alles änderbar.
import type { GroupStage, KnockoutStage, PlacementStage, SlotRef, StageConfig, TournamentFormat } from './types';

export interface FormatTemplate {
  id: string;
  label: string;
  teamCount: number;
  build(): TournamentFormat;
}

const VORRUNDE = 'vorrunde';

function groups(groupCount: number): GroupStage {
  return {
    id: VORRUNDE,
    kind: 'groups',
    name: 'Vorrunde',
    phase: 0,
    color: 'neutral',
    entry: null,
    groupCount,
    doubleRoundRobin: false,
    draw: 'random',
    fixedFields: false,
  };
}

function knockout(
  id: string,
  name: string,
  color: KnockoutStage['color'],
  size: KnockoutStage['size'],
  places: number[],
  placeRange: { from: number; to: number },
  best?: { place: number; count: number }[],
): KnockoutStage {
  return {
    id,
    kind: 'knockout',
    name,
    phase: 1,
    color,
    entry: { fromStageId: VORRUNDE, places, ...(best ? { best } : {}) },
    placeRange,
    size,
    pairing: best ? 'seeded' : 'crossover',
    thirdPlace: true,
    allPlaces: false,
    drawDecider: 'penalties',
  };
}

const groupPlace = (group: number, place: number): SlotRef => ({ kind: 'group_place', stageId: VORRUNDE, group, place });

/** Platzierungsspiele „n. A gegen n. B“ für zwei Gruppen ab Gruppenplatz `fromPlace`. */
function placementTwoGroups(fromPlace: number, toPlace: number): PlacementStage {
  const matches: PlacementStage['matches'] = [];
  for (let p = fromPlace; p <= toPlace; p++) {
    const place = 2 * p - 1;
    matches.push({ key: `P${place}`, place, slotA: groupPlace(0, p), slotB: groupPlace(1, p) });
  }
  const places = matches.map((_, i) => fromPlace + i);
  return {
    id: 'platzierung',
    kind: 'placement',
    name: 'Platzierungsspiele',
    phase: 1,
    color: 'neutral',
    entry: { fromStageId: VORRUNDE, places },
    placeRange: { from: 2 * fromPlace - 1, to: 2 * toPlace },
    matches,
    drawDecider: 'penalties',
  };
}

function format(stages: StageConfig[]): TournamentFormat {
  return { version: 1, stages, tieBreakVariant: 'h2h_first', breakBeforeFinalsMinutes: 15 };
}

export const FORMAT_TEMPLATES: readonly FormatTemplate[] = [
  {
    id: 't8',
    label: '8 Teams, 2 Gruppen zu 4, Halbfinale und alle Plätze',
    teamCount: 8,
    build: () => format([groups(2), knockout('endrunde', 'Endrunde', 'gold', 4, [1, 2], { from: 1, to: 4 }), placementTwoGroups(3, 4)]),
  },
  {
    id: 't10',
    label: '10 Teams, 2 Gruppen zu 5, Halbfinale und alle Plätze',
    teamCount: 10,
    build: () => format([groups(2), knockout('endrunde', 'Endrunde', 'gold', 4, [1, 2], { from: 1, to: 4 }), placementTwoGroups(3, 5)]),
  },
  {
    id: 't12',
    label: '12 Teams, 3 Gruppen zu 4, Viertelfinale mit den 2 besten Dritten',
    teamCount: 12,
    build: () => format([groups(3), knockout('endrunde', 'Endrunde', 'gold', 8, [1, 2], { from: 1, to: 8 }, [{ place: 3, count: 2 }])]),
  },
  {
    id: 't16',
    label: '16 Teams, 4 Gruppen zu 4, Gold- und Silberrunde',
    teamCount: 16,
    build: () =>
      format([
        groups(4),
        knockout('gold', 'Goldrunde', 'gold', 8, [1, 2], { from: 1, to: 8 }),
        knockout('silber', 'Silberrunde', 'silver', 8, [3, 4], { from: 9, to: 16 }),
      ]),
  },
  {
    id: 't20',
    label: '20 Teams, 4 Gruppen zu 5, Gold- und Silberrunde, Fünfte ausgeschieden',
    teamCount: 20,
    build: () =>
      format([
        groups(4),
        knockout('gold', 'Goldrunde', 'gold', 8, [1, 2], { from: 1, to: 8 }),
        knockout('silber', 'Silberrunde', 'silver', 8, [3, 4], { from: 9, to: 16 }),
      ]),
  },
];
