// Turnier-Baukasten auf der Zuschauerseite: bündelt, was aus der öffentlichen Projektion angezeigt wird
// (Gruppentabellen, Weiterkommen, Vorschau „Stand jetzt“, Endplatzierung). Die Regeln stecken in
// src/domain/groups (Tabellen) und src/domain/format/resolve.ts (Platzhalter, Endplatzierung), siehe
// docs/turnier-baukasten.md. Die Oberfläche benutzt nur die Funktionen und Typen aus dieser Datei.
import {
  finalPlacements,
  resolveFormat,
  type FormatMatch,
  type GroupStage,
  type GroupTableRow,
  type ResolveInput,
  type SlotRef,
  type StageColor,
  type StageConfig,
  type StageStandings,
  type TournamentFormat,
} from '../../../domain/format';
import { calculateGroupStageStandings, carryOverFrom, groupLetter } from '../../../domain/groups';
import { decideKnockoutMatch, matchLabel, rankBestOfPlace } from '../../../domain/knockout';
import type { PublicMatch, PublicTournamentView } from '../../data/types';

export { groupLetter, matchLabel };

/** Eine Gruppe mit Tabelle. `rows` enthält nur gewertete Teams; zurückgezogene stehen in `unranked`. */
export interface GroupView {
  index: number;
  name: string;
  teamIds: string[];
  rows: GroupTableRow[];
  unranked: string[];
  matches: PublicMatch[];
  /** Alle Spiele der Gruppe beendet oder ausgefallen. */
  complete: boolean;
  started: boolean;
  live: boolean;
}

export interface StageTable {
  stage: GroupStage | Extract<StageConfig, { kind: 'final_group' }>;
  groups: GroupView[];
  complete: boolean;
}

/** Wohin ein Gruppenplatz führt. `best` = nur, wenn das Team zu den Besten dieses Platzes gehört. */
export interface PlaceMark {
  stageId: string;
  name: string;
  color: StageColor;
  best: boolean;
}

export interface SideView {
  teamId: string | null;
  /** true = Stand jetzt, noch nicht fest. */
  provisional: boolean;
  /** Platzhalter lang („Sieger Halbfinale 1“) und kurz („1. A“). */
  slotLabel?: string;
  slotShort?: string;
}

export interface Placement {
  teamId: string;
  placeFrom: number;
  placeTo: number;
  stageId: string;
}

export interface StageModel {
  format: TournamentFormat;
  tables: Map<string, StageTable>;
  stageOf(id: string | undefined): StageConfig | undefined;
  /** Beide Seiten eines Spiels: eingetragenes Team, sonst der aufgelöste Platzhalter. */
  side(m: PublicMatch, side: 'A' | 'B'): SideView;
  winnerOf(m: PublicMatch): string | null;
  marks(stageId: string): Map<number, PlaceMark[]>;
  bestOf(stageId: string, place: number): { rows: Array<GroupTableRow & { group: number }>; count: number; complete: boolean } | null;
  placements(): { placements: Placement[]; eliminated: string[] };
}

const counted = (m: PublicMatch) => m.status === 'completed' && m.goalsA !== undefined && m.goalsB !== undefined;

const ROUND_NAMES: Record<string, string> = { R32_: 'Sechzehntelfinale', R16_: 'Achtelfinale', QF: 'Viertelfinale', SF: 'Halbfinale' };
const ROUND_SIZE: Record<string, number> = { R32_: 32, R16_: 16, QF: 8, SF: 4 };
const KEY_RE = /^(?:P(\d+)_)?(R32_|R16_|QF|SF)(\d+)$/;

/** Runde im Hauptbaum (0 = erste Runde) oder null für Platzierungsspiele. */
export function treeRound(key: string | undefined): { size: number; index: number } | null {
  if (!key) return null;
  if (key === 'F') return { size: 2, index: 1 };
  const sub = KEY_RE.exec(key);
  if (!sub || sub[1]) return null;
  return { size: ROUND_SIZE[sub[2]!]!, index: Number(sub[3]) };
}

export function roundTitle(size: number): string {
  return size === 2 ? 'Finale' : ROUND_NAMES[Object.keys(ROUND_SIZE).find((k) => ROUND_SIZE[k] === size)!]!;
}

/** Platzhalter als Text, lang und kurz. */
export function slotText(format: TournamentFormat, slot: SlotRef): { long: string; short: string } {
  const stage = slot.kind === 'team' ? undefined : format.stages.find((s) => s.id === slot.stageId);
  const offset = (stage?.placeRange?.from ?? 1) - 1;
  switch (slot.kind) {
    case 'group_place': {
      const single = stage?.kind === 'groups' && stage.groupCount === 1;
      const g = groupLetter(slot.group);
      return single ? { long: `${slot.place}. der Tabelle`, short: `${slot.place}.` } : { long: `${slot.place}. Gruppe ${g}`, short: `${slot.place}. ${g}` };
    }
    case 'best_of_place':
      return { long: `${slot.rank}. bester ${slot.place}.`, short: `${slot.rank}. b. ${slot.place}.` };
    case 'table_place':
      return { long: `${slot.place}. ${stage?.name ?? 'Tabelle'}`, short: `${slot.place}.` };
    case 'winner':
    case 'loser': {
      const word = slot.kind === 'winner' ? 'Sieger' : 'Verlierer';
      return { long: `${word} ${matchLabel(slot.matchKey, offset)}`, short: '' };
    }
    case 'team':
      return { long: '', short: '' };
  }
}

export function buildStageModel(view: PublicTournamentView): StageModel | null {
  const format = view.format;
  if (!format) return null;
  const teams = view.teams.map((t) => ({ id: t.id, name: t.name, status: t.status }));
  const names = new Map(view.teams.map((t) => [t.id, t.name]));
  const name = (id: string) => names.get(id) ?? '';
  const stageOf = (id: string | undefined) => format.stages.find((s) => s.id === id);
  const byStage = new Map<string, PublicMatch[]>();
  for (const m of view.matches) if (m.stageId) byStage.set(m.stageId, [...(byStage.get(m.stageId) ?? []), m]);
  const lots = view.lots ?? [];
  const lotOrders: Record<string, string[]> = {};
  for (const l of lots) if (l.groupIndex === undefined && l.place !== undefined) lotOrders[`${l.stageId}|${l.place}`] = l.order;

  const tables = new Map<string, StageTable>();
  const standings: Record<string, StageStandings> = {};
  for (const stage of format.stages) {
    if (stage.kind !== 'groups' && stage.kind !== 'final_group') continue;
    const matches = byStage.get(stage.id) ?? [];
    const draw = view.groupDraws?.find((g) => g.stageId === stage.id);
    // Ohne gespeicherte Einteilung (Finalgruppe, Zwischenrunde): Teams aus den Spielen.
    const groupIds =
      draw?.groups ??
      Array.from({ length: stage.kind === 'groups' ? stage.groupCount : 1 }, (_, gi) => [
        ...new Set(matches.filter((m) => (m.groupIndex ?? 0) === gi).flatMap((m) => [m.teamAId, m.teamBId]).filter(Boolean)),
      ]);
    const prev = stage.kind === 'groups' && stage.entry ? standings[stage.entry.fromStageId] : undefined;
    const st = calculateGroupStageStandings({
      stage: { id: stage.id, doubleRoundRobin: stage.doubleRoundRobin, carryOverPoints: stage.kind === 'groups' ? stage.carryOverPoints : false },
      groups: groupIds,
      teams,
      matches: matches.filter((m) => m.teamAId && m.teamBId),
      variant: format.tieBreakVariant,
      lots: lots.filter((l) => l.stageId === stage.id && l.groupIndex !== undefined).map((l) => ({ teamIds: l.order })),
      ...(prev ? { carryOver: carryOverFrom(prev.groups) } : {}),
    });
    standings[stage.id] = st;
    const groups = groupIds.map((teamIds, index): GroupView => {
      const gm = matches.filter((m) => (m.groupIndex ?? 0) === index);
      return {
        index,
        name: groupLetter(index),
        teamIds: [...teamIds],
        rows: st.tables[index]?.rows ?? [],
        unranked: st.tables[index]?.unranked ?? [],
        matches: gm,
        complete: st.groupComplete[index] === true && gm.length > 0,
        started: gm.some((m) => m.status !== 'scheduled' && m.status !== 'draft'),
        live: gm.some((m) => m.status === 'live'),
      };
    });
    tables.set(stage.id, { stage, groups, complete: groups.length > 0 && groups.every((g) => g.complete) });
  }

  const input: ResolveInput = {
    format,
    teams,
    standings,
    matches: view.matches.filter((m): m is PublicMatch & FormatMatch => !!m.stageId),
    lotOrders,
  };
  const resolution = resolveFormat(input);
  const resolved = new Map(resolution.matches.map((r) => [r.matchId, r]));
  // Ohne ein einziges Ergebnis im Abschnitt gibt es noch keinen sinnvollen „Stand jetzt“.
  const hasResults = (slot: Exclude<SlotRef, { kind: 'team' }>) =>
    slot.kind === 'group_place'
      ? (tables.get(slot.stageId)?.groups[slot.group]?.matches ?? []).some(counted)
      : (byStage.get(slot.stageId) ?? []).some(counted);

  const marks = (stageId: string) => {
    const out = new Map<number, PlaceMark[]>();
    for (const s of format.stages) {
      if (s.entry?.fromStageId !== stageId) continue;
      const add = (place: number, best: boolean) => out.set(place, [...(out.get(place) ?? []), { stageId: s.id, name: s.name, color: s.color, best }]);
      s.entry.places.forEach((p) => add(p, false));
      s.entry.best?.forEach((b) => add(b.place, true));
    }
    return out;
  };

  const bestOf = (stageId: string, place: number) => {
    const table = tables.get(stageId);
    const st = standings[stageId];
    if (!table || !st) return null;
    let count = 0;
    for (const s of format.stages) {
      if (s.entry?.fromStageId === stageId) for (const b of s.entry.best ?? []) if (b.place === place) count += b.count;
    }
    if (count === 0) return null;
    const ranking = rankBestOfPlace(st, place, lotOrders[`${stageId}|${place}`]);
    return { rows: ranking.rows.map((r) => ({ ...r.row, group: r.group })), count, complete: table.complete };
  };

  const side = (m: PublicMatch, s: 'A' | 'B'): SideView => {
    const stored = s === 'A' ? m.teamAId : m.teamBId;
    const slot = s === 'A' ? m.slotA : m.slotB;
    const text = slot && slot.kind !== 'team' ? slotText(format, slot) : undefined;
    const labels = text ? { slotLabel: text.long, ...(text.short ? { slotShort: text.short } : {}) } : {};
    if (stored) return { teamId: stored, provisional: false, ...labels };
    const r = resolved.get(m.id)?.[s === 'A' ? 'a' : 'b'];
    if (!r?.teamId) return { teamId: null, provisional: false, ...labels };
    if (r.provisional && slot && slot.kind !== 'team' && !hasResults(slot)) return { teamId: null, provisional: false, ...labels };
    return { teamId: r.teamId, provisional: r.provisional, ...labels };
  };

  const winnerOf = (m: PublicMatch) => {
    const o = decideKnockoutMatch(m);
    if (o.state !== 'decided') return null;
    return side(m, o.winner).teamId;
  };

  const placements = () => {
    const result = finalPlacements(input);
    const placed: Placement[] = [];
    const eliminated: string[] = [];
    for (const p of result.placements) {
      if ('placeFrom' in p) placed.push(p);
      else eliminated.push(p.teamId);
    }
    placed.sort((a, b) => a.placeFrom - b.placeFrom || name(a.teamId).localeCompare(name(b.teamId), 'de'));
    return { placements: placed, eliminated };
  };

  return { format, tables, stageOf, side, winnerOf, marks, bestOf, placements };
}

/** Farbe eines Abschnitts als CSS-Wert (Medaillenfarben nach Style Guide). */
export const STAGE_COLORS: Record<StageColor, string> = {
  gold: '#D9A400',
  silver: '#8A94A6',
  bronze: '#B87333',
  neutral: 'var(--ac)',
};

/** Ergebnis-Zusatz für Endrunden-Spiele, z. B. „4:3 n. N.“ oder „n. V.“. */
export function resultNote(m: PublicMatch, long = false): string | undefined {
  if (m.decidedBy === 'penalties' && m.penaltiesA !== undefined && m.penaltiesB !== undefined) {
    return long ? `${m.penaltiesA}:${m.penaltiesB} nach Neunmeterschießen` : `${m.penaltiesA}:${m.penaltiesB} n. N.`;
  }
  if (m.decidedBy === 'extra_time') return long ? 'nach Verlängerung' : 'n. V.';
  if (m.decidedBy === 'walkover') return 'kampflos';
  return undefined;
}

/** Anzeigename eines Spiels mit Abschnitt, z. B. „Gruppe A“, „Gold · Halbfinale 1“. */
export function matchTitle(model: StageModel, m: PublicMatch): string {
  const stage = model.stageOf(m.stageId);
  if (!stage) return `Runde ${m.roundNumber}`;
  if (stage.kind === 'groups') {
    const multi = stage.groupCount > 1;
    const prefix = stage.phase > 0 ? `${stage.name} · ` : '';
    return multi ? `${prefix}Gruppe ${groupLetter(m.groupIndex ?? 0)}` : stage.name;
  }
  if (stage.kind === 'final_group') return stage.name;
  const offset = (stage.placeRange?.from ?? 1) - 1;
  const label = m.matchKey ? (stage.kind === 'placement' ? matchLabel(m.matchKey, 0) : matchLabel(m.matchKey, offset)) : '';
  const finals = model.format.stages.filter((s) => s.phase === stage.phase && (s.kind === 'knockout' || s.kind === 'placement'));
  return finals.length > 1 && stage.kind !== 'placement' ? `${shortStageName(stage)} · ${label}` : label;
}

/** „Goldrunde“ → „Gold“ (auch Silber, Bronze), sonst der Name. */
export function shortStageName(stage: StageConfig): string {
  return /^(Gold|Silber|Bronze)runde$/i.test(stage.name) ? stage.name.slice(0, -5) : stage.name;
}
