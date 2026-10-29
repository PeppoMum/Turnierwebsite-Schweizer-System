// K.-o.-Baum mit Platzhaltern (docs/turnier-baukasten.md, „Endrunde“).
//
// Schlüssel der Spiele (je Abschnitt eindeutig, Plätze relativ zum Abschnitt):
// - Hauptbaum: `R32_1` …, `R16_1` …, `QF1` …, `SF1`, `SF2`, `F`.
// - Spiele um weitere Plätze: Endspiel um Platz n heißt `P<n>` (z. B. `P3`, `P5`, `P7`), die Runden
//   davor bekommen den Startplatz als Vorsilbe (`P5_SF1` = Halbfinale um die Plätze 5–8).
// Spiel `SF1` bekommt die Sieger von `QF1` und `QF2`, `SF2` die von `QF3` und `QF4` usw.

import type { KnockoutStage, PlacementStage, SlotRef, TournamentFormat } from '../format/types';
import { entrySlots, stageTableSizes } from './entry';

export interface BracketMatch {
  stageId: string;
  key: string;
  /** 1 = erste Runde des Abschnitts. Höhere Runden setzen die niedrigeren voraus. */
  round: number;
  slotA: SlotRef;
  slotB: SlotRef;
  /** Plätze im Abschnitt (1-basiert), um die die beiden Teams dieses Spiels noch spielen. */
  range: { from: number; to: number };
  penaltyOnly: boolean;
}

const ROUND_PREFIX: Record<number, string> = { 32: 'R32_', 16: 'R16_', 8: 'QF', 4: 'SF' };

function groupOf(slot: SlotRef): number | null {
  return slot.kind === 'group_place' ? slot.group : null;
}

function placeOf(slot: SlotRef): number | null {
  return slot.kind === 'group_place' || slot.kind === 'table_place' || slot.kind === 'best_of_place' ? slot.place : null;
}

function sameGroup(a: SlotRef, b: SlotRef): boolean {
  const ga = groupOf(a);
  return ga !== null && ga === groupOf(b);
}

/** Runde, in der sich die Teams der Erstrundenspiele an Position `i` und `j` (0-basiert) frühestens treffen. */
export function meetingRound(i: number, j: number): number {
  if (i === j) return 1;
  return 2 + Math.floor(Math.log2(i ^ j));
}

/** Übliche Setzreihenfolge im Baum für `n` Positionen: 1, 8, 4, 5, 2, 7, 3, 6 bei n = 8. */
export function standardSeedOrder(n: number): number[] {
  let order = [1];
  while (order.length < n) {
    const size = order.length * 2;
    order = order.flatMap((s) => [s, size + 1 - s]);
  }
  return order;
}

type Pair = [SlotRef, SlotRef];

/**
 * Über Kreuz, wenn alle Teams feste Gruppenplätze sind, jede Gruppe gleich viele Plätze stellt und die
 * Gruppenzahl gerade ist: Gruppen A/B, C/D … bilden Paare, Platz j der einen spielt gegen Platz k+1−j der
 * anderen (1. A – 2. B, 2. A – 1. B; bei vier Plätzen 1. A – 4. B, 2. A – 3. B …). Sonst `null`.
 */
function crossoverPairs(entrants: readonly SlotRef[]): Pair[] | null {
  if (!entrants.every((s) => s.kind === 'group_place')) return null;
  const byGroup = new Map<number, SlotRef[]>();
  for (const s of entrants) byGroup.set(groupOf(s)!, [...(byGroup.get(groupOf(s)!) ?? []), s]);
  const groups = [...byGroup.keys()].sort((a, b) => a - b);
  const k = byGroup.get(groups[0]!)!.length;
  if (groups.length % 2 !== 0 || groups.some((g) => byGroup.get(g)!.length !== k)) return null;
  const pairs: Pair[] = [];
  for (let i = 0; i < groups.length; i += 2) {
    const first = byGroup.get(groups[i]!)!.sort((a, b) => placeOf(a)! - placeOf(b)!);
    const second = byGroup.get(groups[i + 1]!)!.sort((a, b) => placeOf(a)! - placeOf(b)!);
    for (let j = 0; j < k; j++) {
      if (j < k - 1 - j) pairs.push([first[j]!, second[k - 1 - j]!], [second[j]!, first[k - 1 - j]!]);
      else if (j === k - 1 - j) pairs.push([first[j]!, second[j]!]);
    }
  }
  return pairs;
}

/**
 * Setzliste: Bester gegen Schwächsten. Treffen dabei zwei Teams derselben Gruppe aufeinander, wird der
 * schwächere Gegner mit einem gleich gesetzten Gegner (gleicher Platz) eines anderen Spiels getauscht.
 */
function seededPairs(entrants: readonly SlotRef[]): Pair[] {
  const n = entrants.length;
  const pairs: Pair[] = [];
  for (let i = 0; i < n / 2; i++) pairs.push([entrants[i]!, entrants[n - 1 - i]!]);
  for (const pair of pairs) {
    if (!sameGroup(pair[0], pair[1])) continue;
    const swap = pairs.find(
      (other) =>
        other !== pair &&
        placeOf(other[1]) === placeOf(pair[1]) &&
        !sameGroup(pair[0], other[1]) &&
        !sameGroup(other[0], pair[1]),
    );
    if (swap) [pair[1], swap[1]] = [swap[1], pair[1]];
  }
  return pairs;
}

/** Alle Teilmengen der Größe `k` aus `items`, die das erste Element enthalten (Spiegelungen weggelassen). */
function* halves<T>(items: readonly T[], k: number): Generator<T[]> {
  const [first, ...rest] = items;
  if (first === undefined) return;
  const pick = (start: number, chosen: T[]): T[][] => {
    if (chosen.length === k - 1) return [[first, ...chosen]];
    const out: T[][] = [];
    for (let i = start; i <= rest.length - (k - 1 - chosen.length); i++) out.push(...pick(i + 1, [...chosen, rest[i]!]));
    return out;
  };
  yield* pick(0, []);
}

function sameGroupPairs(pairs: readonly Pair[]): number {
  const slots = pairs.flat();
  let n = 0;
  for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) if (sameGroup(slots[i]!, slots[j]!)) n++;
  return n;
}

/**
 * Ordnet die Erstrundenspiele im Baum an: von oben nach unten wird jede Hälfte so geteilt, dass möglichst
 * wenige Teams derselben Gruppe in dieselbe Hälfte kommen (sie treffen sich so spät wie möglich, am besten
 * erst im Finale). Bei gleich guten Teilungen bleibt die übliche Setzreihenfolge erhalten.
 */
function arrange(pairs: Pair[]): Pair[] {
  if (pairs.length <= 1) return pairs;
  const half = pairs.length / 2;
  const standardTop = new Set(pairs.slice(0, half));
  let best: { top: Pair[]; cost: [number, number] } | null = null;
  for (const top of halves(pairs, half)) {
    const topSet = new Set(top);
    const bottom = pairs.filter((p) => !topSet.has(p));
    const moved = top.filter((p) => !standardTop.has(p)).length;
    const cost: [number, number] = [sameGroupPairs(top) + sameGroupPairs(bottom), Math.min(moved, half - moved)];
    if (!best || cost[0] < best.cost[0] || (cost[0] === best.cost[0] && cost[1] < best.cost[1])) best = { top, cost };
  }
  const topSet = new Set(best!.top);
  return [...arrange(best!.top), ...arrange(pairs.filter((p) => !topSet.has(p)))];
}

/** Erstrundenpaarungen in Baumreihenfolge (Position 0 und 1 treffen sich in Runde 2 usw.). */
export function firstRoundPairs(stage: Pick<KnockoutStage, 'pairing'>, entrants: readonly SlotRef[]): Pair[] {
  const seedIndex = new Map(entrants.map((s, i) => [s, i]));
  const pairs = (stage.pairing === 'crossover' && crossoverPairs(entrants)) || seededPairs(entrants);
  // Stärke eines Spiels = bester Setzplatz darin; danach in übliche Setzreihenfolge bringen.
  const byStrength = [...pairs].sort(
    (a, b) => Math.min(seedIndex.get(a[0])!, seedIndex.get(a[1])!) - Math.min(seedIndex.get(b[0])!, seedIndex.get(b[1])!),
  );
  const ordered = standardSeedOrder(byStrength.length).map((seed) => byStrength[seed - 1]!);
  return arrange(ordered);
}

/**
 * Baut den ganzen Baum eines K.-o.-Abschnitts. `entrants` sind die Platzhalter aus der Einstiegsregel in
 * Setzreihenfolge (siehe `entrySlots`), genau `stage.size` Stück.
 */
export function buildBracket(stage: KnockoutStage, entrants: readonly SlotRef[]): BracketMatch[] {
  if (entrants.length !== stage.size) {
    throw new RangeError(`${stage.name} braucht ${stage.size} Teams, bekommen hat sie ${entrants.length}`);
  }
  const matches: BracketMatch[] = [];
  const penaltyOnly = new Set(stage.penaltyOnlyMatchKeys ?? []);
  const push = (key: string, round: number, slotA: SlotRef, slotB: SlotRef, from: number, to: number) =>
    matches.push({ stageId: stage.id, key, round, slotA, slotB, range: { from, to }, penaltyOnly: penaltyOnly.has(key) });

  const build = (from: number, slots: readonly SlotRef[], round: number) => {
    const n = slots.length;
    if (n === 2) {
      push(from === 1 ? 'F' : `P${from}`, round, slots[0]!, slots[1]!, from, from + 1);
      return;
    }
    const prefix = `${from === 1 ? '' : `P${from}_`}${ROUND_PREFIX[n]}`;
    const winners: SlotRef[] = [];
    const losers: SlotRef[] = [];
    for (let i = 0; i < n / 2; i++) {
      const key = `${prefix}${i + 1}`;
      push(key, round, slots[2 * i]!, slots[2 * i + 1]!, from, from + n - 1);
      winners.push({ kind: 'winner', stageId: stage.id, matchKey: key });
      losers.push({ kind: 'loser', stageId: stage.id, matchKey: key });
    }
    build(from, winners, round + 1);
    if (stage.allPlaces || (stage.thirdPlace && from === 1 && n === 4)) build(from + n / 2, losers, round + 1);
  };

  if (stage.size === 2) {
    push('F', 1, entrants[0]!, entrants[1]!, 1, 2);
  } else {
    build(1, firstRoundPairs(stage, entrants).flat(), 1);
  }
  return matches.sort((a, b) => a.round - b.round);
}

/** Spiele eines Abschnitts mit einzelnen Platzierungsspielen; Plätze relativ zum Abschnitt. */
export function placementMatches(stage: PlacementStage): BracketMatch[] {
  const offset = (stage.placeRange?.from ?? 1) - 1;
  return stage.matches.map((m) => ({
    stageId: stage.id,
    key: m.key,
    round: 1,
    slotA: m.slotA,
    slotB: m.slotB,
    range: { from: m.place - offset, to: m.place - offset + 1 },
    penaltyOnly: m.penaltyOnly ?? false,
  }));
}

/** Alle Spiele mit Platzhaltern aus K.-o.- und Platzierungsabschnitten, für die Anlage des Spielplans. */
export function buildFormatBrackets(format: TournamentFormat, teamCount: number): BracketMatch[] {
  const sizes = stageTableSizes(format, teamCount);
  const out: BracketMatch[] = [];
  for (const stage of format.stages) {
    if (stage.kind === 'placement') out.push(...placementMatches(stage));
    if (stage.kind !== 'knockout' || !stage.entry) continue;
    const source = format.stages.find((s) => s.id === stage.entry!.fromStageId);
    if (!source) continue;
    out.push(...buildBracket(stage, entrySlots(stage.entry, source, sizes.get(source.id) ?? [])));
  }
  return out;
}

/**
 * Anzeigename eines Spiels, z. B. „Viertelfinale 2“, „Spiel um Platz 3“, „Halbfinale 1, Platz 5–8“.
 * `placeOffset` verschiebt die Platzzahlen, z. B. 8 für eine Silberrunde um die Plätze 9–16.
 */
export function matchLabel(key: string, placeOffset = 0): string {
  if (key === 'F') return 'Finale';
  const names: Record<string, string> = { R32_: 'Sechzehntelfinale', R16_: 'Achtelfinale', QF: 'Viertelfinale', SF: 'Halbfinale' };
  const placeFinal = /^P(\d+)$/.exec(key);
  if (placeFinal) return `Spiel um Platz ${Number(placeFinal[1]) + placeOffset}`;
  const sub = /^(?:P(\d+)_)?(R32_|R16_|QF|SF)(\d+)$/.exec(key);
  if (!sub) return key;
  const [, from, round, n] = sub;
  if (!from) return `${names[round!]} ${n}`;
  const size = round === 'SF' ? 4 : round === 'QF' ? 8 : round === 'R16_' ? 16 : 32;
  const start = Number(from) + placeOffset;
  return `${names[round!]} ${n}, Platz ${start}–${start + size - 1}`;
}
