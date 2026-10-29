// Turnier-Baukasten auf der Zuschauerseite: was aus der öffentlichen Projektion angezeigt wird
// (Gruppentabellen, Weiterkommen, Vorschau „Stand jetzt“, Endplatzierung). Regeln in docs/turnier-baukasten.md.
//
// Übergangslösung: Die Fachlogik dazu entsteht in src/domain/groups (Tabelle) und src/domain/format/resolve.ts
// (Platzhalter, Endplatzierung). Bis die da sind, rechnet diese Datei die Anzeige selbst, mit denselben
// Regeln, aber nur so weit, wie die Zuschauerseite sie braucht. Danach hier auf die Domain-Funktionen umstellen;
// die Oberfläche benutzt nur die Funktionen und Typen aus dieser Datei.
import type {
  GroupStage,
  GroupTableRow,
  GroupTieBreaker,
  KnockoutStage,
  SlotRef,
  StageColor,
  StageConfig,
  TieBreakVariant,
  TournamentFormat,
} from '../../../domain/format';
import { TIE_BREAK_ORDER } from '../../../domain/format';
import type { PublicMatch, PublicTournamentView } from '../../data/types';

export const groupLetter = (i: number) => String.fromCharCode(65 + i);

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

const POINTS = { win: 3, draw: 1 } as const;

function counted(m: PublicMatch): boolean {
  return m.status === 'completed' && m.goalsA !== undefined && m.goalsB !== undefined && !!m.teamAId && !!m.teamBId;
}

interface Acc {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

const emptyAcc = (): Acc => ({ played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 });

function accumulate(teamIds: readonly string[], matches: readonly PublicMatch[], base?: ReadonlyMap<string, Acc>): Map<string, Acc> {
  const ids = new Set(teamIds);
  const acc = new Map(teamIds.map((id) => [id, { ...(base?.get(id) ?? emptyAcc()) }]));
  for (const m of matches) {
    if (!counted(m) || !ids.has(m.teamAId) || !ids.has(m.teamBId)) continue;
    const a = acc.get(m.teamAId)!;
    const b = acc.get(m.teamBId)!;
    const ga = m.goalsA!;
    const gb = m.goalsB!;
    a.played++;
    b.played++;
    a.goalsFor += ga;
    a.goalsAgainst += gb;
    b.goalsFor += gb;
    b.goalsAgainst += ga;
    if (ga > gb) {
      a.won++;
      b.lost++;
      a.points += POINTS.win;
    } else if (ga < gb) {
      b.won++;
      a.lost++;
      b.points += POINTS.win;
    } else {
      a.drawn++;
      b.drawn++;
      a.points += POINTS.draw;
      b.points += POINTS.draw;
    }
  }
  return acc;
}

function criterion(c: GroupTieBreaker, ids: readonly string[], acc: Map<string, Acc>, matches: readonly PublicMatch[]): Map<string, number[]> {
  if (c === 'head_to_head') {
    const mini = accumulate(ids, matches);
    return new Map(ids.map((id) => {
      const r = mini.get(id)!;
      return [id, [r.points, r.goalsFor - r.goalsAgainst, r.goalsFor]];
    }));
  }
  return new Map(ids.map((id) => {
    const r = acc.get(id)!;
    return [id, [c === 'goal_diff' ? r.goalsFor - r.goalsAgainst : c === 'goals_for' ? r.goalsFor : r.won]];
  }));
}

const cmpVec = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i]! - a[i]!;
  return 0;
};

/** Teilt eine Liste nach Schlüssel in Blöcke Gleichstehender (Reihenfolge bleibt). */
function clusters(ids: string[], key: Map<string, number[]>): string[][] {
  const sorted = [...ids].sort((x, y) => cmpVec(key.get(x)!, key.get(y)!));
  const out: string[][] = [];
  for (const id of sorted) {
    const last = out[out.length - 1];
    if (last && cmpVec(key.get(last[0]!)!, key.get(id)!) === 0) last.push(id);
    else out.push([id]);
  }
  return out;
}

function rank(
  ids: string[],
  acc: Map<string, Acc>,
  matches: readonly PublicMatch[],
  order: readonly GroupTieBreaker[],
  lots: readonly (readonly string[])[],
  name: (id: string) => string,
): Array<{ id: string; by?: GroupTableRow['decidedBy'] }> {
  const out: Array<{ id: string; by?: GroupTableRow['decidedBy'] }> = [];
  const split = (block: string[], step: number, by: GroupTableRow['decidedBy']) => {
    if (block.length === 1) {
      out.push({ id: block[0]!, by });
      return;
    }
    if (step >= order.length) {
      // Zuletzt das Los; ohne gezogenes Los vorläufig nach Name.
      const lot = lots.find((l) => block.every((id) => l.includes(id)));
      const sorted = [...block].sort((x, y) => (lot ? lot.indexOf(x) - lot.indexOf(y) : name(x).localeCompare(name(y), 'de')));
      sorted.forEach((id, i) => out.push({ id, by: i === 0 ? by : 'lot' }));
      return;
    }
    const c = order[step]!;
    const parts = clusters(block, criterion(c, block, acc, matches));
    // Trennt ein Kriterium nur teilweise, wird unter den weiterhin Gleichstehenden von vorn verglichen.
    parts.forEach((p, i) => split(p, parts.length > 1 ? 0 : step + 1, i === 0 ? by : c));
  };
  const byPoints = clusters(ids, new Map(ids.map((id) => [id, [acc.get(id)!.points]])));
  byPoints.forEach((block, i) => split(block, 0, i === 0 ? undefined : 'points'));
  return out;
}

function tableOf(
  teamIds: string[],
  matches: readonly PublicMatch[],
  variant: TieBreakVariant,
  ranked: (id: string) => boolean,
  lots: readonly (readonly string[])[],
  name: (id: string) => string,
  carry?: ReadonlyMap<string, Acc>,
): { rows: GroupTableRow[]; unranked: string[] } {
  const ids = teamIds.filter(ranked);
  // Spiele mit zurückgezogenen Teams zählen für niemanden.
  const acc = accumulate(ids, matches, carry);
  const order = rank(ids, acc, matches, TIE_BREAK_ORDER[variant], lots, name);
  const rows = order.map(({ id, by }, i): GroupTableRow => ({ teamId: id, place: i + 1, ...acc.get(id)!, ...(by ? { decidedBy: by } : {}) }));
  return { rows, unranked: teamIds.filter((id) => !ranked(id)).sort((a, b) => name(a).localeCompare(name(b), 'de')) };
}

const finished = (m: PublicMatch) => m.status === 'completed' || m.status === 'not_played' || m.status === 'cancelled';

/** Quotient für den Vergleich über Gruppen: Punkte, Tordifferenz, Tore, jeweils pro Spiel. */
function quotientKey(r: GroupTableRow): number[] {
  const n = r.played || 1;
  return [r.points / n, (r.goalsFor - r.goalsAgainst) / n, r.goalsFor / n];
}

const ROUND_NAMES: Record<string, string> = { R32_: 'Sechzehntelfinale', R16_: 'Achtelfinale', QF: 'Viertelfinale', SF: 'Halbfinale' };
const ROUND_SIZE: Record<string, number> = { R32_: 32, R16_: 16, QF: 8, SF: 4 };
const KEY_RE = /^(?:P(\d+)_)?(R32_|R16_|QF|SF)(\d+)$/;

/** Anzeigename eines Endrunden-Spiels („Viertelfinale 2“, „Spiel um Platz 3“); Plätze ab `offset`. */
export function matchLabel(key: string, offset = 0): string {
  if (key === 'F') return 'Finale';
  const p = /^P(\d+)$/.exec(key);
  if (p) return `Spiel um Platz ${Number(p[1]) + offset}`;
  const sub = KEY_RE.exec(key);
  if (!sub) return key;
  const [, from, round, n] = sub;
  if (!from) return `${ROUND_NAMES[round!]} ${n}`;
  const start = Number(from) + offset;
  return `${ROUND_NAMES[round!]} ${n}, Platz ${start}–${start + ROUND_SIZE[round!]! - 1}`;
}

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

/** Sieger eines beendeten Endrunden-Spiels mit festen Teams, sonst null. */
function decidedWinner(m: PublicMatch, withdrawn: (id: string) => boolean): string | null {
  if (!m.teamAId || !m.teamBId) return null;
  if (m.decidedBy === 'walkover' || m.status === 'not_played') {
    if (withdrawn(m.teamAId) && !withdrawn(m.teamBId)) return m.teamBId;
    if (withdrawn(m.teamBId) && !withdrawn(m.teamAId)) return m.teamAId;
    return null;
  }
  if (m.status !== 'completed' || m.goalsA === undefined || m.goalsB === undefined) return null;
  if (m.decidedBy === 'penalties' && m.penaltiesA !== undefined && m.penaltiesB !== undefined) {
    return m.penaltiesA > m.penaltiesB ? m.teamAId : m.teamBId;
  }
  if (m.goalsA === m.goalsB) return null;
  return m.goalsA > m.goalsB ? m.teamAId : m.teamBId;
}

export function buildStageModel(view: PublicTournamentView): StageModel | null {
  const format = view.format;
  if (!format) return null;
  const teamStatus = new Map(view.teams.map((t) => [t.id, t.status]));
  const names = new Map(view.teams.map((t) => [t.id, t.name]));
  const name = (id: string) => names.get(id) ?? '';
  const isRanked = (id: string) => teamStatus.get(id) === 'active';
  const withdrawn = (id: string) => !isRanked(id);
  const stageOf = (id: string | undefined) => format.stages.find((s) => s.id === id);
  const byStage = new Map<string, PublicMatch[]>();
  for (const m of view.matches) if (m.stageId) byStage.set(m.stageId, [...(byStage.get(m.stageId) ?? []), m]);
  const lotsFor = (stageId: string, groupIndex?: number, place?: number) =>
    (view.lots ?? []).filter((l) => l.stageId === stageId && l.groupIndex === groupIndex && l.place === place).map((l) => l.order);

  const tables = new Map<string, StageTable>();
  for (const stage of format.stages) {
    if (stage.kind !== 'groups' && stage.kind !== 'final_group') continue;
    const matches = byStage.get(stage.id) ?? [];
    const draw = view.groupDraws?.find((g) => g.stageId === stage.id);
    let groupIds: string[][];
    if (draw) groupIds = draw.groups;
    else {
      // Ohne gespeicherte Einteilung (Finalgruppe, Zwischenrunde): Teams aus den Spielen.
      const count = stage.kind === 'groups' ? stage.groupCount : 1;
      groupIds = Array.from({ length: count }, (_, gi) => [
        ...new Set(matches.filter((m) => (m.groupIndex ?? 0) === gi).flatMap((m) => [m.teamAId, m.teamBId]).filter(Boolean)),
      ]);
    }
    let carry: Map<string, Acc> | undefined;
    if (stage.kind === 'groups' && stage.carryOverPoints && stage.entry) {
      const prev = tables.get(stage.entry.fromStageId);
      if (prev) carry = new Map(prev.groups.flatMap((g) => g.rows.map((r) => [r.teamId, { ...r }] as const)));
    }
    const groups = groupIds.map((teamIds, index): GroupView => {
      const gm = matches.filter((m) => (m.groupIndex ?? 0) === index);
      const t = tableOf(teamIds, gm, format.tieBreakVariant, isRanked, lotsFor(stage.id, index), name, carry);
      return {
        index,
        name: groupLetter(index),
        teamIds,
        ...t,
        matches: gm,
        complete: gm.length > 0 && gm.every(finished),
        started: gm.some((m) => m.status !== 'scheduled' && m.status !== 'draft'),
        live: gm.some((m) => m.status === 'live'),
      };
    });
    tables.set(stage.id, { stage, groups, complete: groups.length > 0 && groups.every((g) => g.complete) });
  }

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
    if (!table) return null;
    let count = 0;
    for (const s of format.stages) {
      if (s.entry?.fromStageId === stageId) for (const b of s.entry.best ?? []) if (b.place === place) count += b.count;
    }
    if (count === 0) return null;
    const rows = table.groups.flatMap((g) => g.rows.filter((r) => r.place === place).map((r) => ({ ...r, group: g.index })));
    const lot = lotsFor(stageId, undefined, place);
    rows.sort((a, b) => {
      const d = cmpVec(quotientKey(a), quotientKey(b));
      if (d) return d;
      const l = lot.find((o) => o.includes(a.teamId) && o.includes(b.teamId));
      return l ? l.indexOf(a.teamId) - l.indexOf(b.teamId) : name(a.teamId).localeCompare(name(b.teamId), 'de');
    });
    return { rows, count, complete: table.complete };
  };

  const resolving = new Set<string>();
  const resolveSlot = (slot: SlotRef): Omit<SideView, 'slotLabel' | 'slotShort'> => {
    switch (slot.kind) {
      case 'team':
        return { teamId: slot.teamId, provisional: false };
      case 'group_place':
      case 'table_place': {
        const g = tables.get(slot.stageId)?.groups[slot.kind === 'group_place' ? slot.group : 0];
        // Ohne ein einziges Ergebnis gibt es noch keinen sinnvollen „Stand jetzt“.
        if (!g || !g.matches.some(counted)) return { teamId: null, provisional: false };
        const row = g.rows.find((r) => r.place === slot.place);
        return { teamId: row?.teamId ?? null, provisional: !g.complete };
      }
      case 'best_of_place': {
        const b = bestOf(slot.stageId, slot.place);
        const table = tables.get(slot.stageId);
        if (!b || !table?.groups.some((g) => g.matches.some(counted))) return { teamId: null, provisional: false };
        return { teamId: b.rows[slot.rank - 1]?.teamId ?? null, provisional: !b.complete };
      }
      case 'winner':
      case 'loser': {
        const m = (byStage.get(slot.stageId) ?? []).find((x) => x.matchKey === slot.matchKey);
        if (!m || resolving.has(m.id)) return { teamId: null, provisional: false };
        const w = decidedWinner(m, withdrawn);
        if (!w) return { teamId: null, provisional: false };
        return { teamId: slot.kind === 'winner' ? w : w === m.teamAId ? m.teamBId : m.teamAId, provisional: false };
      }
    }
  };

  const side = (m: PublicMatch, s: 'A' | 'B'): SideView => {
    const stored = s === 'A' ? m.teamAId : m.teamBId;
    const slot = s === 'A' ? m.slotA : m.slotB;
    const text = slot && slot.kind !== 'team' ? slotText(format, slot) : undefined;
    const labels = text ? { slotLabel: text.long, ...(text.short ? { slotShort: text.short } : {}) } : {};
    if (stored) return { teamId: stored, provisional: false, ...labels };
    if (!slot) return { teamId: null, provisional: false };
    resolving.add(m.id);
    try {
      return { ...resolveSlot(slot), ...labels };
    } finally {
      resolving.delete(m.id);
    }
  };

  const placements = () => {
    const placed = new Map<string, Placement>();
    const put = (teamId: string | null, stageId: string, from: number, to = from) => {
      if (teamId && !placed.has(teamId)) placed.set(teamId, { teamId, placeFrom: from, placeTo: to, stageId });
    };
    for (const stage of format.stages) {
      if (!stage.placeRange) continue;
      const offset = stage.placeRange.from - 1;
      const ms = byStage.get(stage.id) ?? [];
      if (stage.kind === 'placement') {
        for (const pm of stage.matches) {
          const m = ms.find((x) => x.matchKey === pm.key);
          const w = m && decidedWinner(m, withdrawn);
          if (m && w) {
            put(w, stage.id, pm.place);
            put(w === m.teamAId ? m.teamBId : m.teamAId, stage.id, pm.place + 1);
          }
        }
      } else if (stage.kind === 'knockout') {
        placeKnockout(stage, ms, offset, put, withdrawn);
      } else if (stage.kind === 'final_group') {
        const t = tables.get(stage.id);
        if (t?.complete) t.groups[0]?.rows.forEach((r) => put(r.teamId, stage.id, r.place + offset));
      }
    }
    // Ausgeschieden: Gruppenplatz führt nirgendwohin (bzw. nicht unter den Besten), sobald das feststeht.
    const eliminated: string[] = [];
    for (const [stageId, t] of tables) {
      const later = format.stages.some((s) => s.entry?.fromStageId === stageId);
      if (!later) continue;
      const mk = marks(stageId);
      for (const g of t.groups) {
        if (!g.complete) continue;
        for (const r of g.rows) {
          const ms = mk.get(r.place) ?? [];
          if (ms.some((x) => !x.best)) continue;
          if (ms.length > 0) {
            const b = bestOf(stageId, r.place);
            if (!b?.complete || b.rows.findIndex((x) => x.teamId === r.teamId) < b.count) continue;
          }
          if (!placed.has(r.teamId)) eliminated.push(r.teamId);
        }
      }
    }
    for (const t of view.teams) if (withdrawn(t.id) && !placed.has(t.id) && !eliminated.includes(t.id)) eliminated.push(t.id);
    return { placements: [...placed.values()].sort((a, b) => a.placeFrom - b.placeFrom || name(a.teamId).localeCompare(name(b.teamId), 'de')), eliminated };
  };

  return {
    format,
    tables,
    stageOf,
    side,
    winnerOf: (m) => decidedWinner(m, withdrawn),
    marks,
    bestOf,
    placements,
  };
}

/**
 * Endplätze aus einem K.-o.-Baum: Finale und Spiele um Platz n vergeben feste Plätze. Wer in einer Runde
 * verliert, nach der für die Verlierer nichts mehr ausgespielt wird, teilt sich die Plätze („5.–8.“).
 */
function placeKnockout(
  stage: KnockoutStage,
  ms: readonly PublicMatch[],
  offset: number,
  put: (teamId: string | null, stageId: string, from: number, to?: number) => void,
  withdrawn: (id: string) => boolean,
) {
  const keys = new Set(ms.map((m) => m.matchKey).filter(Boolean) as string[]);
  const hasFrom = (from: number) => [...keys].some((k) => k === `P${from}` || k.startsWith(`P${from}_`) || (from === 1 && !k.startsWith('P')));
  // Zuerst die Endspiele (feste Plätze), dann die geteilten Plätze.
  const sorted = [...ms].sort((a, b) => Number(KEY_RE.test(a.matchKey ?? '')) - Number(KEY_RE.test(b.matchKey ?? '')));
  for (const m of sorted) {
    const key = m.matchKey;
    const w = key ? decidedWinner(m, withdrawn) : null;
    if (!key || !w) continue;
    const l = w === m.teamAId ? m.teamBId : m.teamAId;
    const final = key === 'F' ? 1 : /^P(\d+)$/.exec(key)?.[1];
    if (final !== undefined) {
      const from = Number(final);
      put(w, stage.id, from + offset);
      put(l, stage.id, from + 1 + offset);
      continue;
    }
    const sub = KEY_RE.exec(key);
    if (!sub) continue;
    const from = sub[1] ? Number(sub[1]) : 1;
    const size = ROUND_SIZE[sub[2]!]!;
    const loserFrom = from + size / 2;
    if (!hasFrom(loserFrom)) put(l, stage.id, loserFrom + offset, from + size - 1 + offset);
  }
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
