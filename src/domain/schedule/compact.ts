// Ausfall während des Turniers (docs/turnier-baukasten.md, „Turnier umstellen“): frei gewordene
// Spielzeiten nutzen. Zwei Wege, beide nur als Vorschlag, die Turnierleitung übernimmt mit einem Klick:
//
// - „Plan straffen“ (`compactStagePlan`): spätere, noch nicht angepfiffene Spiele rücken in die Lücken.
//   Wer früher dran war, bleibt ungefähr früher; nach vorne ist erlaubt, nach hinten schiebt nichts.
//   Bevorzugt werden Spiele, deren Teams als „ist da“ abgehakt sind (oder die nicht vor ihrem ersten
//   geplanten Spiel drankommen), dann Spiele, bei denen jedes Team mindestens ein Spiel Pause hat.
//   Pausen werden nie extra eingebaut: geht es nur mit kürzerer Pause, gibt es eine Warnung.
//   Endet eine Phase früher, rücken die späteren Phasen um dieselbe Zeit nach vorne.
// - „Dreiergruppe spielt länger“ (`longerGroupOptions`): eine Gruppe, die nur noch 3 Teams hat, spielt
//   ihre offenen Spiele länger, wenn jedes Spiel in die frei gewordene Zeit auf seinem Feld passt.
//   Takt und Pausen aller anderen Teams bleiben gleich.
//
// Handänderungen (`manual`) und angepfiffene/beendete Spiele bleiben, wo sie sind.
import type { SlotRef, TournamentFormat } from '../format/types';
import type { MatchStatus } from '../types';
import { matchKeyIndex, predecessorIds, sideKeys, sideLabel } from './stages';

/** Ein Spiel des Baukastens mit allem, was das Straffen braucht. */
export interface CompactMatch {
  id: string;
  stageId: string;
  groupIndex?: number;
  matchKey?: string;
  teamAId?: string;
  teamBId?: string;
  slotA?: SlotRef;
  slotB?: SlotRef;
  fieldId?: string;
  startISO?: string;
  durationMinutes: number;
  waveIndex?: number;
  status: MatchStatus;
  manual?: boolean;
}

export interface CompactOptions {
  format: TournamentFormat;
  /** Lücken vor diesem Zeitpunkt sind vorbei und werden nicht mehr gefüllt. */
  nowISO: string;
  turnoverMinutes: number;
  /** Gewünschte Pause zwischen zwei Spielen eines Teams („ein Spiel Pause“), meist die Spielzeit. */
  desiredRestMinutes: number;
  /** Teams mit Haken „ist da“. */
  presentTeamIds?: ReadonlySet<string>;
  teamNames?: ReadonlyMap<string, string>;
  /** Diese Spiele bleiben, wo sie sind (z. B. die länger spielende Dreiergruppe). */
  keepIds?: ReadonlySet<string>;
}

/** Neue Zeit (und ggf. Feld oder Dauer) für ein Spiel. */
export interface MatchPlacement {
  matchId: string;
  fieldId: string;
  startISO: string;
  waveIndex?: number;
  durationMinutes?: number;
}

export interface CompactMove extends MatchPlacement {
  fromFieldId: string;
  fromStartISO: string;
}

/** „Team ist vielleicht noch nicht da“: spielt früher als sein erstes geplantes Spiel und ist nicht abgehakt. */
export interface EarlyStartHint {
  teamId: string;
  matchId: string;
  startISO: string;
  firstPlannedISO: string;
  message: string;
}

export interface CompactResult {
  moves: CompactMove[];
  hints: EarlyStartHint[];
  /** Teams, die durch das Straffen weniger als die gewünschte Pause haben. */
  restWarnings: string[];
  /** Abpfiff des letzten Spiels vorher und nachher (fehlt, wenn es keine Spiele gibt). */
  oldEndISO?: string;
  newEndISO?: string;
}

const MS = 60_000;
const ms = (iso: string) => Date.parse(iso);
const iso = (t: number) => new Date(t).toISOString();

/** Spiele, die stattfinden (oder stattgefunden haben) und damit Feld und Teams belegen. */
const occupies = (m: Pick<CompactMatch, 'status'>) => m.status !== 'not_played' && m.status !== 'cancelled';
/** Nur noch nicht angepfiffene Spiele lassen sich bewegen. */
const isOpen = (m: Pick<CompactMatch, 'status'>) => m.status === 'scheduled' || m.status === 'draft';

interface Item {
  m: CompactMatch;
  start: number;
  end: number;
  fieldId: string;
  waveIndex?: number;
  phase: number;
  movable: boolean;
}

/** Erste geplante Anstoßzeit je Team, auch Spiele, die inzwischen ausfallen, zählen mit. */
export function firstPlannedStarts(matches: readonly CompactMatch[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of matches) {
    if (!m.startISO || m.status === 'cancelled') continue;
    const t = ms(m.startISO);
    for (const id of [m.teamAId, m.teamBId]) {
      if (!id) continue;
      const known = out.get(id);
      if (known === undefined || t < known) out.set(id, t);
    }
  }
  return out;
}

/**
 * Hinweise „Team ist vielleicht noch nicht da“ für geänderte Anstoßzeiten: ein Team ohne Haken „ist da“
 * spielt früher als sein erstes Spiel im bisherigen Plan. Auch für das Umstellen bei Absagen nutzbar.
 */
export function earlyStartHints(
  original: readonly CompactMatch[],
  changed: ReadonlyArray<Pick<MatchPlacement, 'matchId' | 'startISO'>>,
  presentTeamIds: ReadonlySet<string> = new Set(),
  teamNames?: ReadonlyMap<string, string>,
): EarlyStartHint[] {
  const first = firstPlannedStarts(original);
  const byId = new Map(original.map((m) => [m.id, m]));
  const hints: EarlyStartHint[] = [];
  for (const c of changed) {
    const m = byId.get(c.matchId);
    if (!m) continue;
    for (const id of [m.teamAId, m.teamBId]) {
      if (!id || presentTeamIds.has(id)) continue;
      const f = first.get(id);
      if (f === undefined || ms(c.startISO) >= f) continue;
      const name = teamNames?.get(id) ?? id;
      hints.push({
        teamId: id,
        matchId: m.id,
        startISO: c.startISO,
        firstPlannedISO: iso(f),
        message: `${name} spielt dann früher als bisher geplant und ist vielleicht noch nicht da.`,
      });
    }
  }
  return hints;
}

function phaseMap(format: TournamentFormat): Map<string, number> {
  return new Map(format.stages.map((s) => [s.id, s.phase]));
}

/**
 * Gruppen mit festen Feldern: ein Spiel bleibt auf seinem Feld. Gilt nur, wenn der Plan es wirklich so
 * hat (jede Gruppe auf genau einem eigenen Feld); bei zu wenig Feldern wechseln die Gruppen ohnehin.
 */
function fixedFieldStages(format: TournamentFormat, matches: readonly CompactMatch[]): Set<string> {
  const out = new Set<string>();
  for (const s of format.stages) {
    if (s.kind !== 'groups' || !s.fixedFields) continue;
    const fieldsOf = new Map<number, Set<string>>();
    for (const m of matches) {
      if (m.stageId !== s.id || !m.fieldId) continue;
      const g = m.groupIndex ?? 0;
      fieldsOf.set(g, (fieldsOf.get(g) ?? new Set()).add(m.fieldId));
    }
    const used = [...fieldsOf.values()];
    const all = used.flatMap((f) => [...f]);
    if (used.length > 0 && used.every((f) => f.size === 1) && new Set(all).size === all.length) out.add(s.id);
  }
  return out;
}

function lastEnd(items: readonly Item[]): number | undefined {
  const ends = items.filter((i) => occupies(i.m)).map((i) => i.end);
  return ends.length > 0 ? Math.max(...ends) : undefined;
}

/**
 * Plan straffen: spätere Spiele in frei gewordene Lücken ziehen (siehe Kopf der Datei).
 * Lücken sind die Plätze ausgefallener Spiele (Rückzug, Nichtantritt), die noch in der Zukunft liegen,
 * und die Plätze, die beim Nachrücken frei werden.
 *
 * Zuerst wird nur gezogen, wo jedes Team weiter mindestens die gewünschte Pause hat. Kürzere Pausen
 * gibt es nur, wenn das Turnier dadurch früher fertig wird (dann mit Warnung).
 */
export function compactStagePlan(matches: readonly CompactMatch[], options: CompactOptions): CompactResult {
  const strict = simulate(matches, options, true);
  const relaxed = simulate(matches, options, false);
  const pick = relaxed.newEnd !== undefined && strict.newEnd !== undefined && relaxed.newEnd < strict.newEnd ? relaxed : strict;
  const present = options.presentTeamIds ?? new Set<string>();
  return {
    moves: pick.moves,
    hints: earlyStartHints(matches, pick.moves, present, options.teamNames),
    restWarnings: pick.restWarnings,
    ...(pick.oldEnd !== undefined ? { oldEndISO: iso(pick.oldEnd) } : {}),
    ...(pick.newEnd !== undefined ? { newEndISO: iso(pick.newEnd) } : {}),
  };
}

function simulate(
  matches: readonly CompactMatch[],
  options: CompactOptions,
  strict: boolean,
): { moves: CompactMove[]; restWarnings: string[]; oldEnd?: number; newEnd?: number } {
  const { format, turnoverMinutes, desiredRestMinutes } = options;
  const now = ms(options.nowISO);
  const turnover = turnoverMinutes * MS;
  const present = options.presentTeamIds ?? new Set<string>();
  const keep = options.keepIds ?? new Set<string>();
  const phases = phaseMap(format);
  const fixed = fixedFieldStages(format, matches);
  const first = firstPlannedStarts(matches);
  const byKey = matchKeyIndex(matches);
  const order = new Map(matches.map((m, i) => [m.id, i]));

  const items: Item[] = matches
    .filter((m) => m.startISO && m.fieldId && phases.has(m.stageId))
    .map((m) => ({
      m,
      start: ms(m.startISO!),
      end: ms(m.startISO!) + m.durationMinutes * MS,
      fieldId: m.fieldId!,
      waveIndex: m.waveIndex,
      phase: phases.get(m.stageId)!,
      movable: isOpen(m) && !m.manual && !keep.has(m.id),
    }));
  const itemById = new Map(items.map((i) => [i.m.id, i]));
  const oldEnd = lastEnd(items);

  const busy = (list: Item[], self: Item, start: number, end: number, pad: number) =>
    list.some((o) => o !== self && occupies(o.m) && start < o.end + pad && o.start < end + pad);
  const sideItems = new Map<string, Item[]>();
  for (const i of items) {
    if (!occupies(i.m)) continue;
    for (const k of sideKeys(i.m)) sideItems.set(k, [...(sideItems.get(k) ?? []), i]);
  }
  // K.-o.: Sieger/Verlierer eines Spiels spielen im Folgespiel; auch das ist eine Pause.
  const successors = new Map<string, Array<{ item: Item; side: 'A' | 'B' }>>();
  for (const i of items) {
    if (!occupies(i.m)) continue;
    for (const p of predecessorIds(i.m, byKey)) successors.set(p.matchId, [...(successors.get(p.matchId) ?? []), { item: i, side: p.side }]);
  }
  const fieldItems = (fieldId: string) => items.filter((i) => i.fieldId === fieldId);

  /** Pausen eines Spiels an einer Stelle: je Nachbarspiel der beteiligten Teams, mit Namen für Warnungen. */
  const restsAt = (self: Item, start: number, end: number): Array<{ who: string; rest: number }> => {
    const out: Array<{ who: string; rest: number }> = [];
    sideKeys(self.m).forEach((k, idx) => {
      const who = sideLabel(self.m, idx === 0 ? 'A' : 'B', options.teamNames);
      for (const o of sideItems.get(k) ?? []) {
        if (o === self) continue;
        if (o.end <= start) out.push({ who, rest: (start - o.end) / MS });
        else if (o.start >= end) out.push({ who, rest: (o.start - end) / MS });
      }
    });
    for (const p of predecessorIds(self.m, byKey)) {
      const pre = itemById.get(p.matchId);
      if (pre && occupies(pre.m)) out.push({ who: sideLabel(self.m, p.side, options.teamNames), rest: (start - pre.end) / MS });
    }
    for (const s of successors.get(self.m.id) ?? []) {
      out.push({ who: sideLabel(s.item.m, s.side, options.teamNames), rest: (s.item.start - end) / MS });
    }
    return out;
  };
  const shortCount = (self: Item, start: number, end: number) => restsAt(self, start, end).filter((r) => r.rest < desiredRestMinutes).length;

  const predecessorsReady = (self: Item, start: number) =>
    predecessorIds(self.m, byKey).every((p) => {
      const pre = itemById.get(p.matchId);
      return !pre || pre.end + turnover <= start;
    });

  const presenceIssue = (self: Item, start: number) =>
    [self.m.teamAId, self.m.teamBId].some((id) => {
      if (!id || present.has(id)) return false;
      const f = first.get(id);
      return f !== undefined && start < f;
    });

  const phaseList = [...new Set(items.map((i) => i.phase))].sort((a, b) => a - b);
  let prevOldEnd: number | undefined;
  let prevNewEnd: number | undefined;

  for (const phase of phaseList) {
    const inPhase = items.filter((i) => i.phase === phase);
    const phaseOldEnd = lastEnd(inPhase);

    // Endete die vorige Phase früher, rückt diese Phase um dieselbe Zeit nach vorne, solange hier
    // nichts angepfiffen oder von Hand gesetzt ist und nichts in die Vergangenheit rutscht.
    if (prevOldEnd !== undefined && prevNewEnd !== undefined && prevNewEnd < prevOldEnd) {
      const active = inPhase.filter((i) => occupies(i.m));
      const canShift = active.length > 0 && active.every((i) => i.movable);
      if (canShift) {
        const earliest = Math.min(...active.map((i) => i.start));
        const delta = Math.min(prevOldEnd - prevNewEnd, earliest - now);
        if (delta > 0) {
          for (const i of inPhase) {
            i.start -= delta;
            i.end -= delta;
          }
        }
      }
    }

    // Lücken: Plätze ausgefallener Spiele, chronologisch; jede genutzte Lücke hinterlässt eine neue.
    const gaps: Array<{ start: number; fieldId: string; waveIndex?: number }> = inPhase
      .filter((i) => !occupies(i.m) && i.start >= now)
      .map((i) => ({ start: i.start, fieldId: i.fieldId, waveIndex: i.waveIndex }));
    let guard = 0;
    while (gaps.length > 0 && ++guard < 10_000) {
      gaps.sort((a, b) => a.start - b.start || (a.fieldId < b.fieldId ? -1 : 1));
      const gap = gaps.shift()!;
      const fieldList = fieldItems(gap.fieldId);
      let best: { item: Item; key: number[] } | undefined;
      for (const c of inPhase) {
        if (!c.movable || c.start <= gap.start) continue;
        if (fixed.has(c.m.stageId) && c.fieldId !== gap.fieldId) continue;
        const start = gap.start;
        const end = start + c.m.durationMinutes * MS;
        if (busy(fieldList, c, start, end, turnover)) continue;
        if (sideKeys(c.m).some((k) => busy(sideItems.get(k) ?? [], c, start, end, 0))) continue;
        if (!predecessorsReady(c, start)) continue;
        // Nur neu entstehende zu kurze Pausen zählen; die schon vorher zu kurz waren, ändern nichts.
        const short = Math.max(0, shortCount(c, start, end) - shortCount(c, c.start, c.end));
        if (strict && short > 0) continue;
        const key = [presenceIssue(c, start) ? 1 : 0, short, c.start, order.get(c.m.id)!];
        if (!best || better(key, best.key)) best = { item: c, key };
      }
      if (!best) continue;
      const c = best.item;
      const freed = { start: c.start, fieldId: c.fieldId, waveIndex: c.waveIndex };
      const length = c.end - c.start;
      c.start = gap.start;
      c.end = gap.start + length;
      c.fieldId = gap.fieldId;
      c.waveIndex = gap.waveIndex;
      gaps.push(freed);
    }

    prevOldEnd = phaseOldEnd;
    prevNewEnd = lastEnd(inPhase);
  }

  const moves: CompactMove[] = [];
  for (const i of items) {
    if (!i.movable) continue;
    const startISO = iso(i.start);
    if (startISO === iso(ms(i.m.startISO!)) && i.fieldId === i.m.fieldId) continue;
    moves.push({
      matchId: i.m.id,
      fieldId: i.fieldId,
      startISO,
      ...(i.waveIndex !== undefined ? { waveIndex: i.waveIndex } : {}),
      fromFieldId: i.m.fieldId!,
      fromStartISO: i.m.startISO!,
    });
  }
  moves.sort((a, b) => ms(a.startISO) - ms(b.startISO) || (a.fieldId < b.fieldId ? -1 : 1));

  const restWarnings: string[] = [];
  for (const mv of moves) {
    const i = itemById.get(mv.matchId)!;
    const shortest = new Map<string, number>();
    for (const r of restsAt(i, i.start, i.end)) shortest.set(r.who, Math.min(shortest.get(r.who) ?? Infinity, r.rest));
    for (const [who, rest] of shortest) {
      if (rest >= desiredRestMinutes) continue;
      const text = `${who} hat dann nur ${rest} Minuten Pause.`;
      if (!restWarnings.includes(text)) restWarnings.push(text);
    }
  }

  return { moves, restWarnings, oldEnd, newEnd: lastEnd(items) };
}

function better(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return false;
}

/** Eine Gruppe mit nur noch 3 Teams, die ihre offenen Spiele länger spielen könnte. */
export interface LongerGroupOption {
  stageId: string;
  groupIndex: number;
  teamIds: string[];
  /** Offene Spiele der Gruppe, die länger würden. */
  matchIds: string[];
  currentMinutes: number;
  /** Längste Spielzeit, bei der jedes Spiel noch in die freie Zeit auf seinem Feld passt. */
  maxMinutes: number;
  /** Vorschlag: anderthalbmal so lang, höchstens `maxMinutes`. */
  suggestedMinutes: number;
}

/**
 * Dreiergruppen, die länger spielen können: jedes offene Spiel der Gruppe passt mit der längeren
 * Spielzeit (plus Wechselpause) in die freie Zeit auf seinem Feld, und keines seiner Teams hat dann
 * ein Spiel gleichzeitig. Alle anderen Spiele bleiben, wie sie sind.
 *
 * `groups`: aktive Teams je Gruppe, Schlüssel `stageId|groupIndex`.
 */
export function longerGroupOptions(
  matches: readonly CompactMatch[],
  groups: ReadonlyMap<string, readonly string[]>,
  options: Pick<CompactOptions, 'format' | 'turnoverMinutes'>,
): LongerGroupOption[] {
  const turnover = options.turnoverMinutes * MS;
  const stages = new Map(options.format.stages.map((s) => [s.id, s]));
  const timed = matches.filter((m) => m.startISO && m.fieldId && occupies(m));
  const out: LongerGroupOption[] = [];
  for (const [key, teamIds] of groups) {
    if (teamIds.length !== 3) continue;
    const [stageId, g] = key.split('|');
    const stage = stages.get(stageId!);
    if (!stage || stage.kind !== 'groups') continue;
    const groupIndex = Number(g);
    const own = timed.filter((m) => m.stageId === stageId && (m.groupIndex ?? 0) === groupIndex && isOpen(m));
    if (own.length === 0) continue;
    const currentMinutes = Math.max(...own.map((m) => m.durationMinutes));
    let maxMs = Infinity;
    for (const m of own) {
      const start = ms(m.startISO!);
      // Nächstes Spiel auf demselben Feld bzw. nächstes Spiel eines der beiden Teams.
      let limit = Infinity;
      for (const o of timed) {
        if (o.id === m.id) continue;
        const oStart = ms(o.startISO!);
        if (oStart < start) {
          // Ein früheres Spiel, das noch läuft, würde schon kollidieren: dann geht es nicht.
          const oEnd = oStart + o.durationMinutes * MS;
          if (o.fieldId === m.fieldId && oEnd + turnover > start) limit = 0;
          continue;
        }
        if (o.fieldId === m.fieldId) limit = Math.min(limit, oStart - turnover - start);
        const shared = sideKeys(o).some((k) => sideKeys(m).includes(k));
        if (shared) limit = Math.min(limit, oStart - start);
      }
      maxMs = Math.min(maxMs, limit);
    }
    if (!Number.isFinite(maxMs)) continue; // nach dem letzten Spiel ist unbegrenzt Platz: dann nicht anbieten
    const maxMinutes = Math.floor(maxMs / MS);
    if (maxMinutes <= currentMinutes) continue;
    out.push({
      stageId: stageId!,
      groupIndex,
      teamIds: [...teamIds],
      matchIds: own.map((m) => m.id),
      currentMinutes,
      maxMinutes,
      suggestedMinutes: Math.min(maxMinutes, Math.round(currentMinutes * 1.5)),
    });
  }
  return out;
}

/** Neue Dauer für die offenen Spiele einer Dreiergruppe (Zeit und Feld bleiben). */
export function longerGroupPlacements(matches: readonly CompactMatch[], option: LongerGroupOption, minutes: number): MatchPlacement[] {
  const ids = new Set(option.matchIds);
  return matches
    .filter((m) => ids.has(m.id) && m.startISO && m.fieldId)
    .map((m) => ({ matchId: m.id, fieldId: m.fieldId!, startISO: m.startISO!, durationMinutes: minutes }));
}
