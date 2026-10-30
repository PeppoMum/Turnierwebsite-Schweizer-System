// Baukasten im Assistenten „Turnier anlegen“: eine einfache Bedien-Sicht (BuilderState) auf das
// Turnierformat aus src/domain/format. Vorlagen werden in diese Sicht übersetzt, die Oberfläche
// ändert nur sie, und daraus entsteht beim Speichern das `TournamentFormat`.
// Fachliche Entscheidungen: docs/turnier-baukasten.md.
import {
  FORMAT_TEMPLATES,
  type DrawDecider,
  type DrawMode,
  type EntryRule,
  type FinalGroupStage,
  type GroupStage,
  type KnockoutStage,
  type PlacementStage,
  type StageColor,
  type StageConfig,
  type TieBreakVariant,
  type TournamentFormat,
} from '../../../domain/format';
import { evenGroupSizes, groupSizesFor } from '../../../domain/groups';

export type Prelim = 'groups' | 'league' | 'swiss';
export type FinalsMode = 'none' | 'knockout' | 'tiers';
export type FinalForm = 'knockout' | 'knockout_all' | 'final_group';

export interface FinalRound {
  id: string;
  name: string;
  color: StageColor;
  form: FinalForm;
  /** Feste Gruppenplätze (bzw. Tabellenplätze bei Liga), 1-basiert. */
  places: number[];
  /** Dazu die besten `count` Teams des Gruppenplatzes `place`. */
  best: { place: number; count: number } | null;
}

export interface Intermediate {
  groupCount: number;
  places: number[];
  carryOverPoints: boolean;
}

export interface BuilderState {
  /** Vorlage, von der die Einstellungen stammen; null, sobald etwas geändert wurde. */
  templateId: string | null;
  prelim: Prelim;
  groupCount: number;
  /** Eigene Gruppengrößen; null = so gleichmäßig wie möglich. */
  groupSizes: number[] | null;
  doubleRoundRobin: boolean;
  fixedFields: boolean;
  tieBreakVariant: TieBreakVariant;
  intermediate: Intermediate | null;
  finalsMode: FinalsMode;
  finals: FinalRound[];
  thirdPlace: boolean;
  /** Spiel um Platz 3 nur als Neunmeterschießen. */
  thirdPlacePenaltyOnly: boolean;
  /** Übrige Plätze in einzelnen Platzierungsspielen (nur bei 2 Gruppen). */
  placement: boolean;
  placementPenaltyOnly: boolean;
  drawDecider: DrawDecider;
  /** Spieldauer je Abschnitt; null = Turnier-Standard. */
  prelimMinutes: number | null;
  finalsMinutes: number | null;
  finalMinutes: number | null;
  breakBeforeFinalsMinutes: number;
}

export const PRELIM_ID = 'vorrunde';
export const INTERMEDIATE_ID = 'zwischenrunde';
export const PLACEMENT_ID = 'platzierung';

const TIER_PRESETS: Array<Pick<FinalRound, 'id' | 'name' | 'color'>> = [
  { id: 'gold', name: 'Goldrunde', color: 'gold' },
  { id: 'silber', name: 'Silberrunde', color: 'silver' },
  { id: 'bronze', name: 'Bronzerunde', color: 'bronze' },
  { id: 'endrunde4', name: 'Endrunde 4', color: 'neutral' },
];

export const MAX_FINAL_ROUNDS = TIER_PRESETS.length;

export const KO_SIZES = [2, 4, 8, 16, 32] as const;

/** „Viertelfinale“ usw.: womit ein K.-o.-Baum dieser Größe beginnt. */
export function koStartLabel(size: number): string {
  return (
    (
      {
        2: 'Finale',
        4: 'Halbfinale',
        8: 'Viertelfinale',
        16: 'Achtelfinale',
        32: 'Sechzehntelfinale',
      } as Record<number, string>
    )[size] ?? ''
  );
}

export function defaultBuilder(): BuilderState {
  return fromFormat(FORMAT_TEMPLATES.find((t) => t.id === 't8')!.build(), 't8');
}

export function swissBuilder(base: BuilderState): BuilderState {
  return {
    ...base,
    templateId: null,
    prelim: 'swiss',
    intermediate: null,
    finalsMode: 'none',
    finals: [],
    placement: false,
  };
}

/** Vorlage (oder gespeichertes Format) in die Bedien-Sicht übersetzen. */
export function fromFormat(format: TournamentFormat, templateId: string | null = null): BuilderState {
  const first = format.stages[0];
  const group = first?.kind === 'groups' ? first : null;
  const mid = format.stages.find((s): s is GroupStage => s.kind === 'groups' && s.entry !== null);
  const finals = format.stages.filter((s): s is KnockoutStage | FinalGroupStage => s.kind === 'knockout' || s.kind === 'final_group');
  const placement = format.stages.find((s): s is PlacementStage => s.kind === 'placement');
  const ko = finals.find((s): s is KnockoutStage => s.kind === 'knockout');
  const tierIndex = (i: number) => TIER_PRESETS[Math.min(i, TIER_PRESETS.length - 1)]!;
  return {
    templateId,
    prelim: first?.kind === 'swiss' ? 'swiss' : group && group.groupCount === 1 ? 'league' : 'groups',
    groupCount: group ? Math.max(1, group.groupCount) : 4,
    groupSizes: group?.groupSizes ? [...group.groupSizes] : null,
    doubleRoundRobin: group?.doubleRoundRobin ?? false,
    fixedFields: group?.fixedFields ?? false,
    tieBreakVariant: format.tieBreakVariant,
    intermediate: mid
      ? {
          groupCount: mid.groupCount,
          places: [...(mid.entry?.places ?? [])],
          carryOverPoints: mid.carryOverPoints ?? false,
        }
      : null,
    finalsMode: finals.length === 0 ? 'none' : finals.length === 1 ? 'knockout' : 'tiers',
    finals: finals.map((s, i) => ({
      id: s.id,
      name: s.name,
      color: finals.length === 1 ? s.color : s.color === 'neutral' ? tierIndex(i).color : s.color,
      form: s.kind === 'final_group' ? 'final_group' : s.allPlaces ? 'knockout_all' : 'knockout',
      places: [...(s.entry?.places ?? [])],
      best: s.entry?.best?.[0] ? { ...s.entry.best[0] } : null,
    })),
    thirdPlace: ko ? ko.thirdPlace : true,
    thirdPlacePenaltyOnly: ko?.penaltyOnlyMatchKeys?.includes('P3') ?? false,
    placement: !!placement,
    placementPenaltyOnly: placement?.matches.every((m) => m.penaltyOnly) ?? false,
    drawDecider: ko?.drawDecider ?? placement?.drawDecider ?? 'penalties',
    prelimMinutes: first?.matchMinutes ?? null,
    finalsMinutes: finals[0]?.matchMinutes ?? null,
    finalMinutes: ko?.finalMatchMinutes ?? null,
    breakBeforeFinalsMinutes: format.breakBeforeFinalsMinutes,
  };
}

/** Gruppengrößen der Vorrunde (bei Liga eine Tabelle mit allen). */
export function prelimSizes(s: BuilderState, teamCount: number): number[] {
  if (s.prelim !== 'groups') return [teamCount];
  if (teamCount < s.groupCount) return evenGroupSizes(teamCount, Math.max(1, s.groupCount));
  return groupSizesFor(teamCount, {
    groupCount: s.groupCount,
    groupSizes: s.groupSizes ?? undefined,
  });
}

/** Wie viele Teams eine Einstiegsregel aus Tabellen dieser Größen erfasst. */
export function entryCount(places: readonly number[], best: FinalRound['best'], sizes: readonly number[]): number {
  return sizes.reduce((sum, size) => sum + places.filter((p) => p <= size).length, 0) + (best?.count ?? 0);
}

/** Tabellengrößen des Abschnitts, aus dem die Endrunden ihre Teams bekommen. */
export function finalsSourceSizes(s: BuilderState, teamCount: number): number[] {
  const sizes = prelimSizes(s, teamCount);
  if (!s.intermediate) return sizes;
  return evenGroupSizes(entryCount(s.intermediate.places, null, sizes), Math.max(1, s.intermediate.groupCount));
}

export function finalRoundSize(s: BuilderState, r: FinalRound, teamCount: number): number {
  return entryCount(r.places, r.best, finalsSourceSizes(s, teamCount));
}

/** Plätze, die keine Endrunde abdeckt, für Platzierungsspiele „n. A gegen n. B“. */
function placementPlaces(s: BuilderState, teamCount: number): number[] {
  const sizes = finalsSourceSizes(s, teamCount);
  if (sizes.length !== 2) return [];
  const used = new Set(s.finals.flatMap((r) => [...r.places, ...(r.best ? [r.best.place] : [])]));
  const out: number[] = [];
  for (let p = 1; p <= Math.min(...sizes); p++) if (!used.has(p)) out.push(p);
  return out;
}

/** Platzierungsspiele sind möglich: zwei Gruppen und Plätze, die keine Endrunde abdeckt. */
export function placementAvailable(s: BuilderState, teamCount: number): boolean {
  return s.prelim === 'groups' && s.finalsMode !== 'none' && placementPlaces(s, teamCount).length > 0;
}

export interface BuilderCheck {
  errors: string[];
  hints: string[];
  /** Teams, die nach der Vorrunde (bzw. Zwischenrunde) ohne Endrunde ausscheiden. */
  eliminated: number;
}

/** Fehler (verhindern das Speichern) und Hinweise zur Einstellung. */
export function checkBuilder(s: BuilderState, teamCount: number): BuilderCheck {
  const errors: string[] = [];
  const hints: string[] = [];
  if (s.prelim === 'swiss') return { errors, hints, eliminated: 0 };
  if (teamCount < 2) errors.push('Ein Turnier braucht mindestens zwei Mannschaften.');
  const sizes = prelimSizes(s, teamCount);
  if (s.prelim === 'groups') {
    if (s.groupCount < 1 || s.groupCount > 16) errors.push('Es gehen 1 bis 16 Gruppen.');
    if (teamCount < 2 * s.groupCount) errors.push(`Für ${s.groupCount} Gruppen braucht es mindestens ${2 * s.groupCount} Mannschaften.`);
    if (s.groupSizes) {
      const sum = s.groupSizes.reduce((a, b) => a + b, 0);
      if (s.groupSizes.some((n) => n < 2)) errors.push('Jede Gruppe braucht mindestens 2 Mannschaften.');
      if (sum !== teamCount) errors.push(`Die Gruppen fassen ${sum} Mannschaften, angemeldet sind ${teamCount}.`);
    }
  }
  if (s.intermediate) {
    const n = entryCount(s.intermediate.places, null, sizes);
    if (s.intermediate.places.length === 0) errors.push('Wähle, welche Plätze in die Zwischenrunde kommen.');
    else if (n < 2 * s.intermediate.groupCount)
      errors.push(`Die Zwischenrunde bekommt nur ${n} Mannschaften, zu wenig für ${s.intermediate.groupCount} Gruppen.`);
  }
  const source = finalsSourceSizes(s, teamCount);
  const fixedOwner = new Map<number, string>();
  for (const r of s.finals) {
    const n = entryCount(r.places, r.best, source);
    if (r.places.length === 0 && !r.best) errors.push(`Wähle, wer in die ${r.name} kommt.`);
    else if (n < 2) errors.push(`Die ${r.name} bekommt nur ${n} Mannschaft. Es braucht mindestens 2.`);
    else if (r.form !== 'final_group' && !(KO_SIZES as readonly number[]).includes(n)) {
      errors.push(`Die ${r.name} bekommt ${n} Mannschaften. Für K.-o. braucht es 2, 4, 8, 16 oder 32.`);
    }
    for (const p of r.places) {
      const other = fixedOwner.get(p);
      if (other) errors.push(`Platz ${p} ist schon für die ${other} vorgesehen.`);
      fixedOwner.set(p, r.name);
      if (source.every((size) => p > size)) errors.push(`Einen ${p}. Platz gibt es in keiner Gruppe.`);
    }
    if (r.best) {
      const groupsWithPlace = source.filter((size) => size >= r.best!.place).length;
      if (r.places.includes(r.best.place)) errors.push(`In der ${r.name} ist Platz ${r.best.place} schon fest dabei.`);
      if (r.best.count >= groupsWithPlace) errors.push(`Es gibt nur ${groupsWithPlace} Gruppen mit einem ${r.best.place}. Platz.`);
    }
  }
  for (const r of s.finals) {
    if (r.best && fixedOwner.has(r.best.place) && !r.places.includes(r.best.place)) {
      errors.push(`Platz ${r.best.place} ist schon fest für die ${fixedOwner.get(r.best.place)} vorgesehen.`);
    }
  }
  const total = source.reduce((a, b) => a + b, 0);
  let covered = s.finals.reduce((sum, r) => sum + entryCount(r.places, r.best, source), 0);
  if (s.placement && placementAvailable(s, teamCount)) covered += placementPlaces(s, teamCount).length * 2;
  const eliminated = s.finalsMode === 'none' ? 0 : Math.max(0, total - covered) + (s.intermediate ? teamCount - total : 0);
  if (s.prelim === 'groups' && sizes.some((n) => n !== sizes[0]) && s.finalsMode !== 'none') {
    hints.push('Die Gruppen sind ungleich groß. Beim Vergleich über Gruppen zählen Punkte pro Spiel.');
  }
  return { errors, hints, eliminated };
}

/** Platzbereich jeder Endrunde: die Runde mit den besseren Gruppenplätzen bekommt die vorderen Plätze. */
function placeRanges(s: BuilderState, teamCount: number): Map<string, { from: number; to: number }> {
  const source = finalsSourceSizes(s, teamCount);
  const minPlace = (r: FinalRound) => Math.min(...r.places, r.best?.place ?? Infinity);
  const ordered = [...s.finals].sort((a, b) => minPlace(a) - minPlace(b));
  const out = new Map<string, { from: number; to: number }>();
  let next = 1;
  for (const r of ordered) {
    const n = entryCount(r.places, r.best, source);
    out.set(r.id, { from: next, to: next + n - 1 });
    next += n;
  }
  return out;
}

/**
 * Bedien-Sicht in das gespeicherte Format übersetzen. Nur aufrufen, wenn `checkBuilder` keine Fehler
 * meldet (sonst stimmen die Baumgrößen nicht). Schweizer System ergibt `null`: dann bleibt alles wie bisher.
 */
export function toFormat(s: BuilderState, teamCount: number, drawMode: DrawMode): TournamentFormat | null {
  if (s.prelim === 'swiss') return null;
  const stages: StageConfig[] = [];
  const minutes = (n: number | null) => (n && n > 0 ? { matchMinutes: n } : {});
  const prelim: GroupStage = {
    id: PRELIM_ID,
    kind: 'groups',
    name: s.prelim === 'league' ? 'Jeder gegen jeden' : 'Vorrunde',
    phase: 0,
    color: 'neutral',
    entry: null,
    groupCount: s.prelim === 'league' ? 1 : s.groupCount,
    ...(s.prelim === 'groups' && s.groupSizes ? { groupSizes: [...s.groupSizes] } : {}),
    doubleRoundRobin: s.doubleRoundRobin,
    draw: s.prelim === 'league' ? 'manual' : drawMode,
    fixedFields: s.prelim === 'groups' && s.fixedFields,
    ...minutes(s.prelimMinutes),
  };
  stages.push(prelim);
  let source = PRELIM_ID;
  let phase = 1;
  if (s.intermediate && s.prelim === 'groups') {
    stages.push({
      id: INTERMEDIATE_ID,
      kind: 'groups',
      name: 'Zwischenrunde',
      phase: 1,
      color: 'neutral',
      entry: {
        fromStageId: PRELIM_ID,
        places: [...s.intermediate.places].sort((a, b) => a - b),
      },
      groupCount: s.intermediate.groupCount,
      doubleRoundRobin: s.doubleRoundRobin,
      draw: 'manual',
      fixedFields: s.fixedFields,
      carryOverPoints: s.intermediate.carryOverPoints,
      ...minutes(s.prelimMinutes),
    });
    source = INTERMEDIATE_ID;
    phase = 2;
  }
  const ranges = placeRanges(s, teamCount);
  const sourceSizes = finalsSourceSizes(s, teamCount);
  for (const r of s.finals) {
    const entry: EntryRule = {
      fromStageId: source,
      places: [...r.places].sort((a, b) => a - b),
      ...(r.best ? { best: [{ ...r.best }] } : {}),
    };
    const base = {
      id: r.id,
      name: r.name,
      phase,
      color: r.color,
      entry,
      placeRange: ranges.get(r.id),
      ...minutes(s.finalsMinutes),
    };
    const n = entryCount(r.places, r.best, sourceSizes);
    if (r.form === 'final_group') {
      stages.push({ ...base, kind: 'final_group', doubleRoundRobin: false });
    } else {
      const thirdPlace = r.form === 'knockout_all' || s.thirdPlace;
      stages.push({
        ...base,
        kind: 'knockout',
        size: n as KnockoutStage['size'],
        pairing: r.best || s.prelim === 'league' ? 'seeded' : 'crossover',
        thirdPlace,
        allPlaces: r.form === 'knockout_all',
        drawDecider: s.drawDecider,
        ...(thirdPlace && s.thirdPlacePenaltyOnly && n >= 4 ? { penaltyOnlyMatchKeys: ['P3'] } : {}),
        ...(s.finalMinutes && s.finalMinutes > 0 ? { finalMatchMinutes: s.finalMinutes } : {}),
      });
    }
  }
  if (s.placement && placementAvailable(s, teamCount)) {
    const places = placementPlaces(s, teamCount);
    const firstFree = ranges.size > 0 ? Math.max(...[...ranges.values()].map((x) => x.to)) + 1 : 1;
    const matches: PlacementStage['matches'] = places.map((p, i) => ({
      key: `P${firstFree + 2 * i}`,
      place: firstFree + 2 * i,
      slotA: { kind: 'group_place', stageId: source, group: 0, place: p },
      slotB: { kind: 'group_place', stageId: source, group: 1, place: p },
      ...(s.placementPenaltyOnly ? { penaltyOnly: true } : {}),
    }));
    stages.push({
      id: PLACEMENT_ID,
      kind: 'placement',
      name: 'Platzierungsspiele',
      phase,
      color: 'neutral',
      entry: { fromStageId: source, places },
      placeRange: { from: firstFree, to: firstFree + 2 * places.length - 1 },
      matches,
      drawDecider: s.drawDecider,
      ...minutes(s.finalsMinutes),
    });
  }
  return {
    version: 1,
    stages,
    tieBreakVariant: s.tieBreakVariant,
    breakBeforeFinalsMinutes: s.breakBeforeFinalsMinutes,
  };
}

/** Endrunden-Art wechseln: K.-o. = eine Endrunde, Gold/Silber/Bronze = mehrere nach Gruppenplätzen. */
export function setFinalsMode(s: BuilderState, mode: FinalsMode, teamCount: number): BuilderState {
  const next = { ...s, templateId: null, finalsMode: mode };
  if (mode === 'none') return { ...next, finals: [], placement: false };
  const source = finalsSourceSizes(s, teamCount);
  const groups = source.length;
  if (mode === 'knockout') {
    const keep = s.finals[0];
    // Größter K.-o.-Baum, den die ersten Plätze aller Gruppen füllen.
    const perGroup = groups === 1 ? Math.min(4, source[0] ?? 0) : 2;
    const places = keep?.places.length ? keep.places : Array.from({ length: perGroup }, (_, i) => i + 1);
    return {
      ...next,
      finals: [
        {
          id: 'endrunde',
          name: 'Endrunde',
          color: 'gold',
          form: keep?.form ?? 'knockout',
          places,
          best: keep?.best ?? null,
        },
      ],
    };
  }
  // Gold/Silber/Bronze: je zwei Gruppenplätze pro Endrunde, solange die kleinste Gruppe reicht.
  const minSize = Math.min(...source);
  const perTier = groups >= 4 ? 2 : groups === 1 ? 4 : 1;
  const tiers = Math.max(2, Math.min(3, Math.floor(minSize / perTier)));
  return {
    ...next,
    finals: Array.from({ length: tiers }, (_, i) => ({
      ...TIER_PRESETS[i]!,
      form: 'knockout' as const,
      places: Array.from({ length: perTier }, (_, k) => i * perTier + k + 1),
      best: null,
    })),
  };
}

export function addFinalRound(s: BuilderState, teamCount: number): BuilderState {
  const used = new Set(s.finals.map((r) => r.id));
  const preset = TIER_PRESETS.find((p) => !used.has(p.id));
  if (!preset) return s;
  const taken = new Set(s.finals.flatMap((r) => r.places));
  const maxPlace = Math.max(...finalsSourceSizes(s, teamCount));
  const free = Array.from({ length: maxPlace }, (_, i) => i + 1).find((p) => !taken.has(p));
  return {
    ...s,
    templateId: null,
    finalsMode: 'tiers',
    finals: [...s.finals, { ...preset, form: 'knockout', places: free ? [free] : [], best: null }],
  };
}

/** Kurztext für eine Endrunde: „Platz 1 und 2 · dazu die 2 besten Dritten“. */
export function entryText(r: Pick<FinalRound, 'places' | 'best'>, league = false): string {
  const parts: string[] = [];
  if (r.places.length > 0) {
    const sorted = [...r.places].sort((a, b) => a - b);
    const list = sorted.length === 1 ? `${sorted[0]}` : `${sorted.slice(0, -1).join(', ')} und ${sorted[sorted.length - 1]}`;
    parts.push(`Platz ${list}`);
  }
  if (r.best) {
    const noun = PLACE_NOUN[r.best.place - 1] ?? `${r.best.place}.`;
    const who = r.best.count === 1 ? `der beste ${noun}` : `die ${r.best.count} besten ${noun}n`;
    parts.push(`${r.places.length ? 'dazu ' : ''}${who}`);
  }
  return parts.join(' · ') || (league ? 'noch keine Plätze gewählt' : 'noch niemand');
}

const PLACE_NOUN = ['Erste', 'Zweite', 'Dritte', 'Vierte', 'Fünfte', 'Sechste', 'Siebte', 'Achte'];

/** „4 Gruppen zu je 4“ bzw. „2 Gruppen zu 5, 2 Gruppen zu 4“. */
export function groupSizeText(sizes: readonly number[]): string {
  if (sizes.length === 0) return '';
  const counts = new Map<number, number>();
  for (const n of sizes) counts.set(n, (counts.get(n) ?? 0) + 1);
  const parts = [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([size, n]) => `${n === 1 ? 'eine Gruppe' : `${n} Gruppen`} zu ${counts.size === 1 && n > 1 ? 'je ' : ''}${size}`);
  return parts.join(', ');
}
