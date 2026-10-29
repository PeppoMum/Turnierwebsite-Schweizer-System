// „Turnier umstellen“, wenn Teams fehlen (Entscheidungen vom 29.10.2026, Claude Doc „Ideen: Turnierform
// schnell umstellen“, Abschnitt „Entschieden“).
//
// - Vorschläge: „Lücke lassen“ (Gruppen bleiben, eine Gruppe spielt zu dritt), „eine Gruppe weniger“
//   (16 → 15: 3 Gruppen mit je 5, bei gleich großen Gruppen der erste Vorschlag) und ab 3 Fehlenden die
//   nächstkleinere Vorlage. Nach dem ersten Anpfiff in der Vorrunde ändert sich nur noch die Endrunde.
// - Nie eine Gruppe mit nur 2 Teams: dann wechselt ein Team aus einer vollen Gruppe herüber.
// - Endrunden behalten ihre Größe, solange genug Teams da sind; die Plätze werden der Reihe nach verteilt
//   (Gold zuerst). Passt eine Endrunde nicht mehr: 2 Teams = ein Spiel, 3 Teams = Dreiergruppe oder
//   streichen (Turnierleitung wählt, die drei teilen sich dann die Plätze), sonst K.-o. mit 4 bzw. 8 und
//   der Rest wie eben (Notlösung). Platzierungsspiele ohne Gegner werden zu Plätzen ohne Spiel.
// Zeiten und Spielplan berechnet die Oberfläche mit src/domain/schedule; hier geht es nur um die Form.
import { entryCount, evenGroupSizes, stageCapacity, stageTableSizes } from '../knockout/entry';
import { FORMAT_TEMPLATES } from './templates';
import type {
  EntryRule,
  FinalGroupStage,
  GroupStage,
  KnockoutStage,
  PlacementStage,
  SlotRef,
  StageConfig,
  TournamentFormat,
} from './types';

export type ThreeTeamChoice = 'group' | 'drop';

/** Eine Endrunde, die nur noch 3 Teams hat; die Turnierleitung wählt Dreiergruppe oder streichen. */
export interface ThreeTeamStage {
  /** ID des Abschnitts im neuen Format (Schlüssel für `choices`). */
  stageId: string;
  name: string;
  placeFrom: number;
  placeTo: number;
}

export interface AdaptedFinals {
  format: TournamentFormat;
  threeTeamStages: ThreeTeamStage[];
  /** Was sich an der Endrunde ändert, in Alltagssprache. */
  notes: string[];
  /** Abschnitte, die neu gebaut werden müssen (geändert oder neu). */
  changedStageIds: string[];
}

const letter = (g: number) => String.fromCharCode(65 + g);

function firstGroupStage(format: TournamentFormat): GroupStage | null {
  const first = format.stages[0];
  return first?.kind === 'groups' ? first : null;
}

/** Erster Abschnitt mit diesen Gruppengrößen. */
function withGroupSizes(format: TournamentFormat, sizes: readonly number[]): TournamentFormat {
  const first = firstGroupStage(format);
  if (!first) return format;
  return { ...format, stages: [{ ...first, groupCount: sizes.length, groupSizes: [...sizes] }, ...format.stages.slice(1)] };
}

/** Teams je späterem Abschnitt, wenn die Vorrunde diese Gruppengrößen hat (nur aktive Teams zählen). */
export function expectedStageSizes(format: TournamentFormat, groupSizes: readonly number[]): Map<string, number> {
  const f = withGroupSizes(format, groupSizes);
  const tables = stageTableSizes(f, groupSizes.reduce((a, b) => a + b, 0));
  const out = new Map<string, number>();
  for (const stage of f.stages.slice(1)) {
    const source = stage.entry ? tables.get(stage.entry.fromStageId) : undefined;
    out.set(stage.id, stage.entry && source ? entryCount(stage.entry, source) : 0);
  }
  return out;
}

/** Spätere Abschnitte, deren Teamzahl mit diesen Gruppengrößen nicht mehr passt (z. B. Bronze 4 → 3). */
export function finalsMismatches(
  format: TournamentFormat,
  groupSizes: readonly number[],
): { stageId: string; name: string; capacity: number; count: number }[] {
  const sizes = expectedStageSizes(format, groupSizes);
  const out: { stageId: string; name: string; capacity: number; count: number }[] = [];
  for (const stage of format.stages.slice(1)) {
    const capacity = stageCapacity(stage);
    const count = sizes.get(stage.id) ?? 0;
    if (capacity !== null && capacity !== count) out.push({ stageId: stage.id, name: stage.name, capacity, count });
  }
  return out;
}

/** Position im Gesamtfeld: alle Ersten, dann alle Zweiten …; innerhalb eines Platzes nach Rang. */
interface Pos {
  place: number;
  rank: number;
}

function positions(sizes: readonly number[]): Pos[] {
  const max = Math.max(0, ...sizes);
  const out: Pos[] = [];
  for (let place = 1; place <= max; place++) {
    const count = sizes.filter((s) => s >= place).length;
    for (let rank = 1; rank <= count; rank++) out.push({ place, rank });
  }
  return out;
}

/** Ein Block aufeinanderfolgender Positionen als Einstiegsregel. */
function ruleFor(fromStageId: string, block: readonly Pos[], sizes: readonly number[]): EntryRule {
  const places: number[] = [];
  const best: NonNullable<EntryRule['best']> = [];
  const byPlace = new Map<number, Pos[]>();
  for (const p of block) byPlace.set(p.place, [...(byPlace.get(p.place) ?? []), p]);
  for (const [place, list] of [...byPlace.entries()].sort((a, b) => a[0] - b[0])) {
    const total = sizes.filter((s) => s >= place).length;
    const first = list[0]!.rank;
    if (first === 1 && list.length === total) places.push(place);
    else best.push({ place, count: list.length, ...(first > 1 ? { fromRank: first } : {}) });
  }
  return { fromStageId, places, ...(best.length > 0 ? { best } : {}) };
}

/** Erste Position einer Regel im alten Gesamtfeld (für die Reihenfolge der Endrunden). */
function ruleStart(rule: EntryRule): Pos {
  const candidates: Pos[] = [
    ...rule.places.map((place) => ({ place, rank: 1 })),
    ...(rule.best ?? []).map((b) => ({ place: b.place, rank: b.fromRank ?? 1 })),
  ];
  return candidates.sort((a, b) => a.place - b.place || a.rank - b.rank)[0] ?? { place: Number.MAX_SAFE_INTEGER, rank: 1 };
}

/** Teilt eine Teamzahl in K.-o.-Bäume und einen Rest: 7 = 4 + 3, 6 = 4 + 2, 12 = 8 + 4. */
function splitCount(n: number): number[] {
  const parts: number[] = [];
  let rest = n;
  while (rest >= 4) {
    let size = 4;
    while (size * 2 <= rest && size < 32) size *= 2;
    parts.push(size);
    rest -= size;
  }
  if (rest > 0) parts.push(rest);
  return parts;
}

function placeText(from: number, to: number): string {
  return from === to ? `Platz ${from}` : `Plätze ${from}–${to}`;
}

/**
 * Endrunden an neue Gruppengrößen der Vorrunde anpassen. `oldGroupSizes` sind die Größen, für die das Format
 * gebaut war (fehlt = die volle Größe der jetzt größten Gruppe überall). `choices` entscheidet bei 3 Teams
 * zwischen Dreiergruppe (Standard) und streichen.
 */
export function adaptFinals(
  format: TournamentFormat,
  groupSizes: readonly number[],
  choices: Readonly<Record<string, ThreeTeamChoice>> = {},
  oldGroupSizes?: readonly number[],
): AdaptedFinals {
  const first = firstGroupStage(format);
  if (!first) return { format, threeTeamStages: [], notes: [], changedStageIds: [] };
  const oldSizes = oldGroupSizes ?? Array.from({ length: first.groupCount }, () => Math.max(0, ...groupSizes));
  const newFormat = withGroupSizes(format, groupSizes);
  const newFirst = newFormat.stages[0] as GroupStage;
  const pos = positions(groupSizes);
  const notes: string[] = [];
  const threeTeamStages: ThreeTeamStage[] = [];
  const changed: string[] = [];

  const fromFirst = (s: StageConfig) => s.entry?.fromStageId === first.id;
  const walkStages = format.stages.filter((s) => fromFirst(s) && (s.kind === 'knockout' || s.kind === 'final_group'));
  const ordered = [...walkStages].sort((a, b) => {
    const x = ruleStart(a.entry!);
    const y = ruleStart(b.entry!);
    return x.place - y.place || x.rank - y.rank || format.stages.indexOf(a) - format.stages.indexOf(b);
  });

  const replaced = new Map<string, StageConfig[]>();
  let cursor = 0;
  /** Plätze, die vorne weggefallen sind; spätere Platzbereiche rücken um so viele auf. */
  let shortfall = 0;
  const startIndex = (p: Pos) => pos.findIndex((x) => x.place > p.place || (x.place === p.place && x.rank >= p.rank));

  for (const stage of ordered) {
    const demand = stage.kind === 'knockout' ? stage.size : entryCount(stage.entry!, oldSizes);
    const startAt = startIndex(ruleStart(stage.entry!));
    cursor = Math.max(cursor, startAt < 0 ? pos.length : startAt);
    const count = Math.max(0, Math.min(demand, pos.length - cursor));
    const block = pos.slice(cursor, cursor + count);
    cursor += count;
    const from = (stage.placeRange?.from ?? 1) - shortfall;
    shortfall += demand - count;

    const sameRule = (rule: EntryRule) => JSON.stringify(rule) === JSON.stringify(stage.entry);
    if (count === demand) {
      const rule = ruleFor(first.id, block, groupSizes);
      if (sameRule(rule) && stage.placeRange?.from === from) {
        replaced.set(stage.id, [stage]);
        continue;
      }
      const next: StageConfig = {
        ...stage,
        entry: rule,
        ...(stage.placeRange ? { placeRange: { from, to: from + count - 1 } } : {}),
        ...(stage.kind === 'knockout' && rule.best ? { pairing: 'seeded' as const } : {}),
      };
      replaced.set(stage.id, [next]);
      changed.push(stage.id);
      continue;
    }

    changed.push(stage.id);
    if (count === 0) {
      replaced.set(stage.id, []);
      notes.push(`${stage.name} fällt weg, weil keine Teams mehr dafür übrig sind.`);
      continue;
    }
    const parts = stage.kind === 'final_group' && count >= 2 ? [count] : splitCount(count);
    const out: StageConfig[] = [];
    let offset = 0;
    parts.forEach((n, i) => {
      const id = i === 0 ? stage.id : `${stage.id}_${i + 1}`;
      const sub = block.slice(offset, offset + n);
      const rule = ruleFor(first.id, sub, groupSizes);
      const range = { from: from + offset, to: from + offset + n - 1 };
      const name = parts.length === 1 ? stage.name : `${stage.name} (${placeText(range.from, range.to)})`;
      offset += n;
      const base = { id, name, phase: stage.phase, color: stage.color, entry: rule, placeRange: range, ...(stage.matchMinutes ? { matchMinutes: stage.matchMinutes } : {}) };
      if (stage.kind === 'final_group' && n >= 2) {
        out.push({ ...base, kind: 'final_group', doubleRoundRobin: stage.doubleRoundRobin });
        return;
      }
      if (n === 3) {
        threeTeamStages.push({ stageId: id, name, placeFrom: range.from, placeTo: range.to });
        if ((choices[id] ?? 'group') === 'group') {
          out.push({ ...base, kind: 'final_group', doubleRoundRobin: false } satisfies FinalGroupStage);
        } else {
          out.push(byeStage(base, sub, first.id, groupSizes, true));
        }
        return;
      }
      if (n === 1) {
        out.push(byeStage(base, sub, first.id, groupSizes, false));
        return;
      }
      const ko = stage as KnockoutStage;
      out.push({
        ...base,
        kind: 'knockout',
        size: n as KnockoutStage['size'],
        pairing: rule.best ? 'seeded' : ko.pairing,
        thirdPlace: n >= 4 ? ko.thirdPlace : false,
        allPlaces: n >= 4 ? ko.allPlaces : false,
        drawDecider: ko.drawDecider,
        ...(ko.penaltyOnlyMatchKeys ? { penaltyOnlyMatchKeys: ko.penaltyOnlyMatchKeys } : {}),
        ...(i === 0 && ko.finalMatchMinutes ? { finalMatchMinutes: ko.finalMatchMinutes } : {}),
      } satisfies KnockoutStage);
    });
    replaced.set(stage.id, out);
    notes.push(finalsNote(stage, count, out));
  }

  // Platzierungsspiele „n. A gegen n. B“: fehlt eine Seite, gibt es den Platz ohne Spiel.
  for (const stage of format.stages) {
    if (stage.kind !== 'placement' || !fromFirst(stage)) continue;
    const exists = (slot: SlotRef) =>
      slot.kind !== 'group_place' || (slot.group < groupSizes.length && groupSizes[slot.group]! >= slot.place);
    const from = (stage.placeRange?.from ?? 1) - shortfall;
    let place = from;
    const matches: PlacementStage['matches'] = [];
    const byes: NonNullable<PlacementStage['byes']> = [];
    for (const m of stage.matches) {
      const a = exists(m.slotA);
      const b = exists(m.slotB);
      if (a && b) {
        matches.push({ ...m, key: `P${place}`, place });
        place += 2;
      } else if (a || b) {
        byes.push({ slot: a ? m.slotA : m.slotB, place });
        place += 1;
      }
    }
    for (const b of stage.byes ?? []) if (exists(b.slot)) byes.push({ ...b, place: place++ });
    const count = place - from;
    const old = stageCapacity(stage) ?? 0;
    shortfall += old - count;
    const places = stage.entry!.places.filter((p) => groupSizes.some((s) => s >= p));
    const next: PlacementStage = {
      ...stage,
      entry: { ...stage.entry!, places },
      ...(stage.placeRange ? { placeRange: { from, to: from + count - 1 } } : {}),
      matches,
      ...(byes.length > 0 ? { byes } : {}),
    };
    if (!next.byes) delete next.byes;
    if (JSON.stringify(next) === JSON.stringify(stage)) {
      replaced.set(stage.id, [stage]);
      continue;
    }
    changed.push(stage.id);
    replaced.set(stage.id, count > 0 ? [next] : []);
    const free = byes.map((b) => `${b.place}. Platz`);
    if (free.length > 0) notes.push(`${stage.name}: ${free.join(' und ')} ohne Spiel, weil der Gegner fehlt.`);
    else if (count === 0) notes.push(`${stage.name} fallen weg.`);
  }

  const stages: StageConfig[] = [newFirst];
  for (const stage of format.stages.slice(1)) {
    const r = replaced.get(stage.id);
    if (r) stages.push(...r);
    else stages.push(stage);
  }
  return { format: { ...newFormat, stages }, threeTeamStages, notes, changedStageIds: changed.flatMap((id) => (replaced.get(id) ?? []).map((s) => s.id)) };
}

function byeStage(
  base: { id: string; name: string; phase: number; color: StageConfig['color']; entry: EntryRule; placeRange: { from: number; to: number } },
  block: readonly Pos[],
  sourceId: string,
  sizes: readonly number[],
  shared: boolean,
): PlacementStage {
  const slots = slotsOf(block, sourceId, sizes);
  return {
    ...base,
    kind: 'placement',
    matches: [],
    byes: slots.map((slot, i) =>
      shared ? { slot, place: base.placeRange.from, placeTo: base.placeRange.to } : { slot, place: base.placeRange.from + i },
    ),
    drawDecider: 'penalties',
  };
}

/** Platzhalter eines Blocks: feste Gruppenplätze oder „n. bester Platz p“. */
function slotsOf(block: readonly Pos[], sourceId: string, sizes: readonly number[]): SlotRef[] {
  const rule = ruleFor(sourceId, block, sizes);
  const out: SlotRef[] = [];
  for (const place of rule.places) {
    sizes.forEach((s, group) => {
      if (s >= place) out.push({ kind: 'group_place', stageId: sourceId, group, place });
    });
  }
  for (const b of rule.best ?? []) {
    const first = b.fromRank ?? 1;
    for (let rank = first; rank < first + b.count; rank++) out.push({ kind: 'best_of_place', stageId: sourceId, place: b.place, rank });
  }
  return out;
}

function finalsNote(stage: StageConfig, count: number, parts: StageConfig[]): string {
  const describe = (s: StageConfig): string => {
    if (s.kind === 'knockout') return s.size === 2 ? 'ein Spiel' : `K.-o. mit ${s.size} Teams`;
    if (s.kind === 'final_group') return 'Gruppe jeder gegen jeden';
    if (s.kind === 'placement') return (s.byes?.length ?? 0) > 1 ? 'gestrichen, Plätze geteilt' : 'ohne Spiel';
    return s.name;
  };
  if (parts.length === 1) {
    const p = parts[0]!;
    if (p.kind === 'final_group') return `${stage.name} hat nur noch ${count} Teams und wird zur Gruppe (jeder gegen jeden).`;
    if (p.kind === 'placement' && (p.byes?.length ?? 0) > 1) {
      return `${stage.name} hat nur noch ${count} Teams und wird gestrichen; die ${count} teilen sich ${placeText(p.placeRange!.from, p.placeRange!.to)}.`;
    }
    if (p.kind === 'placement') return `${stage.name}: nur noch ein Team, es bekommt ${placeText(p.placeRange!.from, p.placeRange!.to)} ohne Spiel.`;
    if (p.kind === 'knockout' && p.size === 2) return `${stage.name} hat nur noch 2 Teams: ein Spiel um ${placeText(p.placeRange!.from, p.placeRange!.from)}.`;
    return `${stage.name} hat nur noch ${count} Teams: ${describe(p)}.`;
  }
  return `${stage.name} hat nur noch ${count} Teams (Notlösung): ${parts.map((p) => `${placeText(p.placeRange!.from, p.placeRange!.to)} ${describe(p)}`).join(', ')}.`;
}

// ---------- Vorschläge ----------

export interface ReshapeInput {
  format: TournamentFormat;
  /** Jetzige Einteilung der Vorrunde (Team-IDs), mit den fehlenden Teams. */
  groups: readonly (readonly string[])[];
  /** Teams, die fehlen (vor dem Anpfiff) bzw. schon zurückgezogen sind (danach). */
  missingTeamIds: readonly string[];
  /** In der Vorrunde wurde schon angepfiffen: Gruppen bleiben, nur die Endrunde passt sich an. */
  groupsStarted: boolean;
  /** Dreiergruppe oder streichen je Endrunde mit 3 Teams (Schlüssel: `ThreeTeamStage.stageId`). */
  choices?: Readonly<Record<string, ThreeTeamChoice>>;
  /**
   * Wählt unter mehreren möglichen Einteilungen (welches Team wechselt die Gruppe) die mit den wenigsten
   * Zeitänderungen; gibt den Index zurück. Fehlt = die erste.
   */
  pickGroups?: (candidates: string[][][]) => number;
}

export type ReshapeKind = 'gap' | 'regroup' | 'template' | 'finals';

export interface ReshapeSuggestion {
  kind: ReshapeKind;
  title: string;
  /** Ein, zwei Sätze, was passiert. */
  summary: string;
  format: TournamentFormat;
  /** Neue Einteilung der Vorrunde (ohne fehlende Teams). Bei `finals` die jetzige ohne Zurückgezogene. */
  groups: string[][];
  /** Gruppen werden neu zusammengesetzt (alle Gruppenspiele neu geplant). */
  redraw: boolean;
  threeTeamStages: ThreeTeamStage[];
  notes: string[];
  changedStageIds: string[];
}

function sizesText(sizes: readonly number[]): string {
  if (sizes.every((s) => s === sizes[0])) return sizes.length === 1 ? `eine Gruppe mit ${sizes[0]}` : `${sizes.length} Gruppen mit je ${sizes[0]}`;
  return `Gruppen mit ${sizes.slice(0, -1).join(', ')} und ${sizes.at(-1)} Teams`;
}

/** Gruppen ohne die fehlenden Teams; Gruppen mit 2 oder weniger bekommen Teams aus den größten Gruppen. */
function gapCandidates(groups: string[][]): string[][][] | null {
  if (groups.some((g) => g.length === 0) && groups.length > 1) return null;
  const small = groups.findIndex((g) => g.length < 3);
  if (small < 0) return [groups];
  const max = Math.max(...groups.map((g) => g.length));
  if (max < 4) return null;
  const out: string[][][] = [];
  groups.forEach((g, donor) => {
    if (g.length !== max) return;
    for (const team of g) {
      const next = groups.map((x) => [...x]);
      next[donor] = next[donor]!.filter((t) => t !== team);
      next[small]!.push(team);
      const deeper = gapCandidates(next);
      if (deeper) out.push(deeper[0]!);
    }
  });
  return out.length > 0 ? out : null;
}

/** Kleinste Gruppen auflösen, bis `count` Gruppen übrig sind; ihre Teams kommen in die kleinsten übrigen. */
function mergeGroups(groups: string[][], count: number): { groups: string[][]; dissolved: number[] } | null {
  if (count < 1 || count > groups.length) return null;
  let list = groups.map((g, i) => ({ teams: [...g], index: i }));
  const dissolved: number[] = [];
  while (list.length > count) {
    const smallest = [...list].sort((a, b) => a.teams.length - b.teams.length || b.index - a.index)[0]!;
    list = list.filter((x) => x !== smallest);
    dissolved.push(smallest.index);
    for (const team of smallest.teams) {
      const target = [...list].sort((a, b) => a.teams.length - b.teams.length || a.index - b.index)[0]!;
      target.teams.push(team);
    }
  }
  return { groups: list.map((x) => x.teams), dissolved: dissolved.sort((a, b) => a - b) };
}

function matchesPerTeamText(sizes: readonly number[], double: boolean): string {
  const games = sizes.map((s) => (s - 1) * (double ? 2 : 1));
  const min = Math.min(...games);
  const max = Math.max(...games);
  return min === max ? `Jedes Team hat ${min} Gruppenspiele.` : `Je nach Gruppe hat ein Team ${min} oder ${max} Gruppenspiele.`;
}

/**
 * Zwei oder drei fertige Vorschläge, der empfohlene zuerst. Leer, wenn es nichts umzustellen gibt
 * (kein Team fehlt, kein Gruppenformat).
 */
export function reshapeSuggestions(input: ReshapeInput): ReshapeSuggestion[] {
  const first = firstGroupStage(input.format);
  if (!first) return [];
  const missing = new Set(input.missingTeamIds);
  const current = input.groups.map((g) => g.filter((t) => !missing.has(t)));
  const oldSizes = input.groups.map((g) => g.length);
  const choices = input.choices ?? {};
  const out: ReshapeSuggestion[] = [];

  if (input.groupsStarted) {
    const sizes = current.map((g) => g.length);
    const adapted = adaptFinals(input.format, sizes, choices, first.groupSizes ?? oldSizes);
    if (adapted.changedStageIds.length === 0) return [];
    out.push({
      kind: 'finals',
      title: 'Endrunde anpassen',
      summary: 'Die Gruppen spielen weiter wie bisher. Nur die Endrunde passt sich an die Teams an, die noch dabei sind.',
      format: adapted.format,
      groups: current,
      redraw: false,
      threeTeamStages: adapted.threeTeamStages,
      notes: adapted.notes,
      changedStageIds: adapted.changedStageIds,
    });
    return out;
  }

  if (missing.size === 0) return [];
  const remaining = current.reduce((n, g) => n + g.length, 0);
  if (remaining < 2) return [];

  // „Lücke lassen“: Gruppen bleiben.
  const gap = (() => {
    const candidates = gapCandidates(current);
    if (!candidates) return null;
    const groups = candidates[Math.min(candidates.length - 1, Math.max(0, input.pickGroups?.(candidates) ?? 0))]!;
    const sizes = groups.map((g) => g.length);
    const adapted = adaptFinals(input.format, sizes, choices, oldSizes);
    const moved = groups.flatMap((g, i) => g.filter((t) => !input.groups[i]!.includes(t)).map((t) => ({ team: t, to: i })));
    const short = sizes.flatMap((s, i) => (s < oldSizes[i]! ? [letter(i)] : []));
    const parts = [
      short.length === 0
        ? 'Die Gruppen bleiben, wie sie sind.'
        : `Die Gruppen bleiben. ${short.length === 1 ? `Gruppe ${short[0]} spielt` : `Die Gruppen ${short.join(' und ')} spielen`} mit weniger Teams, die Spiele der Fehlenden fallen weg.`,
      ...moved.map((m) => `Damit keine Gruppe nur 2 Teams hat, wechselt ein Team in Gruppe ${letter(m.to)}.`),
    ];
    return {
      kind: 'gap' as const,
      title: 'Lücke lassen',
      summary: parts.join(' '),
      format: adapted.format,
      groups,
      redraw: false,
      threeTeamStages: adapted.threeTeamStages,
      notes: [matchesPerTeamText(sizes, first.doubleRoundRobin), ...adapted.notes],
      changedStageIds: adapted.changedStageIds,
    };
  })();

  // Eine Gruppe weniger (16 → 15: 3 Gruppen mit je 5).
  const regroup = (() => {
    if (current.length < 3) return null;
    const merged = mergeGroups(current, current.length - 1);
    if (!merged) return null;
    const sizes = merged.groups.map((g) => g.length);
    if (Math.min(...sizes) < 3 || Math.max(...sizes) > 5) return null;
    const adapted = adaptFinals(input.format, sizes, choices, oldSizes);
    const gone = merged.dissolved.map(letter);
    return {
      kind: 'regroup' as const,
      title: sizesText(sizes).replace(/^./, (c) => c.toUpperCase()),
      summary: `Gruppe ${gone.join(' und ')} wird aufgelöst, ihre Teams kommen in die anderen Gruppen. Alle Gruppenspiele werden neu angesetzt.`,
      format: adapted.format,
      groups: merged.groups,
      redraw: true,
      threeTeamStages: adapted.threeTeamStages,
      notes: [matchesPerTeamText(sizes, first.doubleRoundRobin), ...adapted.notes],
      changedStageIds: adapted.changedStageIds,
    };
  })();

  // Ab 3 Fehlenden: nächstkleinere Vorlage.
  const template = (() => {
    if (missing.size < 3) return null;
    const t = [...FORMAT_TEMPLATES].filter((x) => x.teamCount <= remaining).sort((a, b) => b.teamCount - a.teamCount)[0];
    if (!t) return null;
    const built = t.build();
    const tFirst = built.stages[0];
    if (tFirst?.kind !== 'groups') return null;
    const merged = mergeGroups(current, tFirst.groupCount);
    if (!merged) return null;
    const sizes = merged.groups.map((g) => g.length);
    if (Math.min(...sizes) < 3) return null;
    const base: TournamentFormat = {
      ...built,
      tieBreakVariant: input.format.tieBreakVariant,
      breakBeforeFinalsMinutes: input.format.breakBeforeFinalsMinutes,
      stages: [
        { ...tFirst, id: first.id, name: first.name, draw: first.draw, fixedFields: first.fixedFields, ...(first.matchMinutes ? { matchMinutes: first.matchMinutes } : {}) },
        ...built.stages.slice(1).map((s) => (s.entry ? { ...s, entry: { ...s.entry, fromStageId: first.id } } : s)),
      ],
    };
    const templateSizes = evenGroupSizes(t.teamCount, tFirst.groupCount);
    const adapted = adaptFinals(base, sizes, choices, templateSizes);
    const gone = merged.dissolved.map(letter);
    return {
      kind: 'template' as const,
      title: `Vorlage ${t.teamCount} Teams`,
      summary: `${t.label}. ${gone.length > 0 ? `Gruppe ${gone.join(' und ')} wird aufgelöst, ihre Teams kommen in die anderen Gruppen. ` : ''}Alle Spiele werden neu angesetzt.`,
      format: adapted.format,
      groups: merged.groups,
      redraw: true,
      threeTeamStages: adapted.threeTeamStages,
      notes: [`${sizesText(sizes).replace(/^./, (c) => c.toUpperCase())}.`, matchesPerTeamText(sizes, false), ...adapted.notes],
      changedStageIds: adapted.format.stages.slice(1).map((s) => s.id),
    };
  })();

  const evenRegroup = regroup && regroup.groups.every((g) => g.length === regroup.groups[0]!.length);
  const ordered = missing.size >= 3 ? [template, regroup, gap] : evenRegroup ? [regroup, gap] : [gap, regroup];
  for (const s of ordered) if (s) out.push(s);
  return out.slice(0, 3);
}
