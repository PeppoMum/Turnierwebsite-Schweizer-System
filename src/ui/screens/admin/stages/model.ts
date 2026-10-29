// Turnierleitung im Turnier-Baukasten: alles, was die Ansichten aus den gespeicherten Daten ausrechnen.
// Die Fachlogik liegt in src/domain (Gruppen, Endrunde, Spielplan); hier wird sie nur zusammengesteckt
// und mit Namen und Texten für die Oberfläche versehen.
import { useMemo } from 'react';
import type { Match } from '../../../../domain';
import type { FinalPlacement, GroupStage, SlotRef, StageColor, StageConfig, StageStandings, TournamentFormat } from '../../../../domain/format';
import { finalPlacements, resolveFormat, type FillChange, type PlacementResult, type Resolution, type ResolveInput } from '../../../../domain/format/resolve';
import { calculateGroupStageStandings, carryOverFrom, groupLetter, type GroupStageStandings } from '../../../../domain/groups';
import { decideKnockoutMatch, formatKnockoutResult, matchLabel } from '../../../../domain/knockout';
import { checkStageSchedule, slotLabel, type EditableMatch, type ScheduleIssue } from '../../../../domain/schedule';
import type { LotDecision, TournamentData } from '../../../data/types';

export const STAGE_COLOR: Record<StageColor, string> = {
  gold: '#D9A400',
  silver: '#8A94A6',
  bronze: '#B87333',
  neutral: 'var(--mu)',
};

/** Ein Gleichstand, den nur noch das Los entscheidet. `groupIndex` fehlt beim Vergleich über alle Gruppen. */
export interface OpenLot {
  stageId: string;
  groupIndex?: number;
  place?: number;
  teamIds: string[];
}

export interface StageModel {
  format: TournamentFormat;
  /** Tabellen je Gruppen- und Finalgruppen-Abschnitt. */
  standings: Record<string, GroupStageStandings>;
  resolution: Resolution;
  placements: PlacementResult;
  /** Warnungen im Spielplan (doppelt belegt, keine Pause, falsche Reihenfolge). */
  issues: ScheduleIssue[];
  /** Lose, die die Turnierleitung noch ziehen muss (nur in fertigen Gruppen). */
  openLots: OpenLot[];
}

export function isFinalsStage(stage: StageConfig | undefined): boolean {
  return stage?.kind === 'knockout' || stage?.kind === 'placement';
}

export function stageById(format: TournamentFormat, id: string | undefined): StageConfig | undefined {
  return format.stages.find((s) => s.id === id);
}

/** Gruppen eines Abschnitts: gespeicherte Einteilung, sonst aus den Spielen (Zwischenrunde, Finalgruppe). */
function groupsOf(d: TournamentData, stage: StageConfig): string[][] {
  const draw = d.groupDraws?.find((g) => g.stageId === stage.id);
  if (draw) return draw.groups;
  const count = stage.kind === 'groups' ? stage.groupCount : 1;
  const groups: Set<string>[] = Array.from({ length: count }, () => new Set());
  for (const m of d.matches) {
    if (m.stageId !== stage.id) continue;
    const g = groups[m.groupIndex ?? 0];
    if (!g) continue;
    if (m.teamAId) g.add(m.teamAId);
    if (m.teamBId) g.add(m.teamBId);
  }
  return groups.map((g) => [...g]);
}

function groupLotsFor(d: TournamentData, stageId: string) {
  return (d.lots ?? []).filter((l) => l.stageId === stageId && l.groupIndex !== undefined).map((l) => ({ teamIds: l.order }));
}

/** Lose beim Vergleich über Gruppen in der Form, die resolveFormat erwartet. */
export function lotOrders(lots: readonly LotDecision[] | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const l of lots ?? []) if (l.groupIndex === undefined && l.place !== undefined) out[`${l.stageId}|${l.place}`] = l.order;
  return out;
}

function computeStandings(d: TournamentData, format: TournamentFormat): Record<string, GroupStageStandings> {
  const out: Record<string, GroupStageStandings> = {};
  for (const stage of format.stages) {
    if (stage.kind !== 'groups' && stage.kind !== 'final_group') continue;
    const prev = stage.entry ? out[stage.entry.fromStageId] : undefined;
    const carry = stage.kind === 'groups' && stage.carryOverPoints && prev ? carryOverFrom(prev.groups) : undefined;
    out[stage.id] = calculateGroupStageStandings({
      stage: { id: stage.id, doubleRoundRobin: stage.doubleRoundRobin, carryOverPoints: (stage as GroupStage).carryOverPoints },
      groups: groupsOf(d, stage),
      teams: d.teams,
      matches: d.matches.filter((m) => m.teamAId && m.teamBId),
      variant: format.tieBreakVariant,
      lots: groupLotsFor(d, stage.id),
      carryOver: carry,
    });
  }
  return out;
}

export function resolveInput(d: TournamentData, format: TournamentFormat, standings: Record<string, StageStandings>): ResolveInput {
  return { format, teams: d.teams, standings, matches: d.matches.filter((m) => m.stageId) as ResolveInput['matches'], lotOrders: lotOrders(d.lots) };
}

function editable(d: TournamentData): EditableMatch[] {
  return d.matches
    .filter((m) => m.stageId && m.startISO && m.fieldId)
    .map((m) => ({
      id: m.id,
      stageId: m.stageId!,
      matchKey: m.matchKey,
      teamAId: m.teamAId || undefined,
      teamBId: m.teamBId || undefined,
      slotA: m.slotA,
      slotB: m.slotB,
      fieldId: m.fieldId!,
      startISO: m.startISO!,
      durationMinutes: m.durationMinutes,
      status: m.status,
      manual: m.manual,
    }));
}

export function scheduleCheckOptions(d: TournamentData) {
  return {
    turnoverMinutes: d.tournament.schedule.turnoverMinutes,
    teamNames: new Map(d.teams.map((t) => [t.id, t.name])),
    fieldNames: new Map(d.fields.map((f) => [f.id, f.name])),
  };
}

export function editableMatches(d: TournamentData): EditableMatch[] {
  return editable(d);
}

export function buildStageModel(d: TournamentData): StageModel | null {
  const format = d.tournament.format;
  if (!format) return null;
  const standings = computeStandings(d, format);
  const input = resolveInput(d, format, standings);
  const resolution = resolveFormat(input);
  const placements = finalPlacements(input);
  // Nur Spiele, die sich noch bewegen lassen, oder die mit ihnen kollidieren: beendete Spiele untereinander sind Geschichte.
  const issues = checkStageSchedule(editable(d), scheduleCheckOptions(d)).filter((i) =>
    i.matchIds.some((id) => {
      const m = d.matches.find((x) => x.id === id);
      return m && (m.status === 'scheduled' || m.status === 'draft');
    }),
  );
  const openLots: OpenLot[] = [];
  for (const [stageId, st] of Object.entries(standings)) {
    st.tables.forEach((table, groupIndex) => {
      if (!st.groupComplete[groupIndex]) return;
      for (const teamIds of table.openLots) openLots.push({ stageId, groupIndex, teamIds });
    });
  }
  for (const l of resolution.needsLot) openLots.push({ stageId: l.stageId, place: l.place, teamIds: l.teamIds });
  return { format, standings, resolution, placements, issues, openLots };
}

// ---- Texte ----

/** Platzhalter in Alltagssprache: „2. Gruppe B“, „Sieger Halbfinale 1“, „bester Dritter“. */
export function slotText(slot: SlotRef, format: TournamentFormat, teamName: (id: string) => string): string {
  switch (slot.kind) {
    case 'group_place': {
      const stage = stageById(format, slot.stageId);
      const single = stage?.kind === 'groups' && stage.groupCount === 1;
      return single ? `${slot.place}. ${stage.name}` : `${slot.place}. Gruppe ${groupLetter(slot.group + groupOffset(format, slot.stageId))}`;
    }
    case 'best_of_place':
      return slotLabel(slot);
    case 'table_place':
      return `${slot.place}. ${stageById(format, slot.stageId)?.name ?? 'Tabelle'}`;
    case 'winner':
    case 'loser': {
      const stage = stageById(format, slot.stageId);
      return `${slot.kind === 'winner' ? 'Sieger' : 'Verlierer'} ${keyText(stage, slot.matchKey)}`;
    }
    case 'team':
      return teamName(slot.teamId);
  }
}

/**
 * Gruppen werden über das ganze Turnier durchbuchstabiert (Vorrunde A–D, Zwischenrunde E–F),
 * damit „1. Gruppe E“ eindeutig ist.
 */
export function groupOffset(format: TournamentFormat, stageId: string): number {
  let offset = 0;
  for (const s of format.stages) {
    if (s.id === stageId) return offset;
    if (s.kind === 'groups') offset += s.groupCount;
  }
  return 0;
}

export function groupName(format: TournamentFormat, stageId: string, groupIndex: number): string {
  return `Gruppe ${groupLetter(groupIndex + groupOffset(format, stageId))}`;
}

function keyText(stage: StageConfig | undefined, key: string): string {
  if (stage?.kind === 'knockout') return matchLabel(key, (stage.placeRange?.from ?? 1) - 1);
  return matchLabel(key, 0);
}

/** „Vorrunde · Gruppe A“, „Endrunde · Halbfinale 1“, „Goldrunde · Spiel um Platz 3“. */
export function matchTitle(m: Pick<Match, 'stageId' | 'groupIndex' | 'matchKey'>, format: TournamentFormat): string {
  const stage = stageById(format, m.stageId);
  if (!stage) return '';
  if (m.matchKey) return `${stage.name} · ${keyText(stage, m.matchKey)}`;
  const single = stage.kind !== 'groups' || stage.groupCount === 1;
  if (m.groupIndex !== undefined && !single) return `${stage.name} · ${groupName(format, stage.id, m.groupIndex)}`;
  return stage.name;
}

/** Name einer Spielseite: Team, sonst Platzhalter. */
export function sideText(m: Match, side: 'A' | 'B', format: TournamentFormat, teamName: (id: string) => string): string {
  const id = side === 'A' ? m.teamAId : m.teamBId;
  if (id) return teamName(id);
  const slot = side === 'A' ? m.slotA : m.slotB;
  return slot ? slotText(slot, format, teamName) : 'offen';
}

/** Ergebnis als Text; Endrunde mit „n. V.“ und „n. N.“. Leer, solange nichts eingetragen ist. */
export function resultText(m: Match, format: TournamentFormat | undefined): string {
  if (m.decidedBy === 'walkover') return 'kampflos';
  if (m.status === 'not_played') return 'n. a.';
  if (m.status !== 'completed' && m.status !== 'live') return '';
  if (m.status === 'completed' && isFinalsStage(format && stageById(format, m.stageId))) {
    const text = formatKnockoutResult(m);
    if (text) return text;
  }
  return `${m.goalsA ?? 0}:${m.goalsB ?? 0}`;
}

/** Welche Seite ein Endrunden-Spiel gewonnen hat (für fette Schrift), sonst nach Toren. */
export function winnerSide(m: Match, format: TournamentFormat | undefined): 'A' | 'B' | null {
  if (isFinalsStage(format && stageById(format, m.stageId))) {
    const o = decideKnockoutMatch(m);
    return o.state === 'decided' ? o.winner : null;
  }
  if (m.status !== 'completed' || m.goalsA === m.goalsB) return null;
  return (m.goalsA ?? 0) > (m.goalsB ?? 0) ? 'A' : 'B';
}

export function placementText(p: FinalPlacement): string {
  if (!('placeFrom' in p)) return '–';
  return p.placeFrom === p.placeTo ? `${p.placeFrom}.` : `${p.placeFrom}.–${p.placeTo}.`;
}

/** Kurztext einer vorgeschlagenen Änderung beim Füllen der Endrunde. */
export function changeText(c: FillChange, d: TournamentData, format: TournamentFormat, teamName: (id: string) => string): string {
  const m = d.matches.find((x) => x.id === c.matchId);
  if (!m) return '';
  const slot = c.side === 'A' ? m.slotA : m.slotB;
  const where = `${matchTitle(m, format)}${slot && slot.kind !== 'team' ? ` (${slotText(slot, format, teamName)})` : ''}`;
  return c.fromTeamId ? `${where}: ${teamName(c.toTeamId)} statt ${teamName(c.fromTeamId)}` : `${where}: ${teamName(c.toTeamId)}`;
}

/** Welche Gruppenplätze wohin weiterkommen, für die Farbpunkte in der Tabelle. */
export function advanceColors(format: TournamentFormat, stageId: string): Map<number, StageColor> {
  const out = new Map<number, StageColor>();
  for (const s of format.stages) {
    if (s.entry?.fromStageId !== stageId) continue;
    const color = s.color === 'neutral' && s.kind === 'knockout' ? 'gold' : s.color;
    for (const p of s.entry.places) if (!out.has(p)) out.set(p, color);
  }
  return out;
}

/** Endrunden-Spiele mit schon eingetragenen Teams aus diesem Abschnitt (für die Warnung beim Korrigieren). */
export function filledFinalsFrom(d: TournamentData, stageId: string): Match[] {
  const format = d.tournament.format;
  if (!format) return [];
  const fromStage = (s: SlotRef | undefined) =>
    s && (s.kind === 'group_place' || s.kind === 'best_of_place' || s.kind === 'table_place') && s.stageId === stageId;
  return d.matches.filter((m) => (m.teamAId && fromStage(m.slotA)) || (m.teamBId && fromStage(m.slotB)));
}

export { durationNote, standardMinutes } from '../../../format';

// ---- Zeitblöcke ----

const DONE = new Set<Match['status']>(['completed', 'not_played', 'cancelled']);

export function isDecided(m: Match): boolean {
  return DONE.has(m.status) || m.decidedBy === 'walkover';
}

/** Spiele nach Anstoßzeit, Felder in fester Reihenfolge. */
export function groupByTime(matches: readonly Match[], fieldOrder: (id?: string) => number): Array<{ startISO?: string; matches: Match[] }> {
  const map = new Map<string, Match[]>();
  for (const m of matches) map.set(m.startISO ?? '', [...(map.get(m.startISO ?? '') ?? []), m]);
  return [...map.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([startISO, ms]) => ({ startISO: startISO || undefined, matches: ms.sort((a, b) => fieldOrder(a.fieldId) - fieldOrder(b.fieldId)) }));
}

export function useFieldOrder(fields: TournamentData['fields']): (id?: string) => number {
  return useMemo(() => {
    const order = new Map(fields.map((f) => [f.id, f.order]));
    return (id?: string) => (id ? (order.get(id) ?? 99) : 100);
  }, [fields]);
}

