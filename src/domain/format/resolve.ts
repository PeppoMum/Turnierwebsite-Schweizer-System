// Platzhalter auflösen: Wer steht nach jetzigem Stand in welchem Spiel? (docs/turnier-baukasten.md, „Endrunde“)
//
// - Feste Plätze einer Gruppe stehen fest, sobald diese Gruppe fertig ist; die Besten eines Platzes
//   („beste Dritte“), sobald alle Gruppen fertig sind und kein Los mehr fehlt. Vorher gibt es eine
//   Vorschau „nach jetzigem Stand“ (`provisional: true`).
// - Sieger/Verlierer stehen fest, sobald das Spiel entschieden ist.
// - Ein Platz, über den in seiner Gruppe noch ein Los entscheiden muss, bleibt vorläufig.
// - `changes` sind neue Teams (Turnierleitung trägt sie automatisch ein) oder, mit `fromTeamId`, Korrekturen
//   (Turnierleitung bestätigt). Nur Spiele, die noch nicht angepfiffen sind, ändern sich. Angepfiffene oder
//   beendete Spiele bleiben („gespielt ist gespielt“), solche Abweichungen stehen in `locked`.
// - Von Hand getauschte Teams tragen den Platzhalter `{ kind: 'team' }` und bleiben, wie sie sind.

import { buildBracket } from '../knockout/bracket';
import { entrySlots, rankBestOfPlace, stageTableSizes } from '../knockout/entry';
import { type Side, decideKnockoutMatch, walkoverFields } from '../knockout/result';
import type { MatchStatus, TeamStatus } from '../types';
import type { GroupStageStandings } from '../groups';
import type { FinalPlacement, GroupTableRow, KnockoutStage, SlotRef, StageConfig, StageMatchFields, StageStandings, TournamentFormat } from './types';

/** Ein Spiel eines Baukasten-Turniers, so wie es gespeichert ist. Leere Team-ID = noch nicht eingetragen. */
export interface FormatMatch extends StageMatchFields {
  id: string;
  teamAId?: string;
  teamBId?: string;
  status: MatchStatus;
  goalsA?: number;
  goalsB?: number;
}

export interface ResolveInput {
  format: TournamentFormat;
  teams: readonly { id: string; status: TeamStatus }[];
  /** Tabellen je Gruppen-, Liga- oder Finalgruppen-Abschnitt (aus dem Gruppen-Teil). */
  standings: Readonly<Record<string, StageStandings>>;
  matches: readonly FormatMatch[];
  /**
   * Von der Turnierleitung gezogene Lose beim Vergleich über Gruppen, Schlüssel `${stageId}|${place}`,
   * Wert = Team-IDs, besseres zuerst.
   */
  lotOrders?: Readonly<Record<string, readonly string[]>>;
}

export interface ResolvedSlot {
  teamId: string | null;
  /** true = Stand jetzt, noch nicht fest. */
  provisional: boolean;
}

export interface ResolvedMatch {
  matchId: string;
  stageId: string;
  matchKey?: string;
  a: ResolvedSlot;
  b: ResolvedSlot;
  started: boolean;
}

export interface FillChange {
  matchId: string;
  side: Side;
  fromTeamId: string | null;
  toTeamId: string;
}

export interface Resolution {
  /** Alle Spiele mit Platzhaltern: gespeichertes Team, sonst der aufgelöste Platzhalter. */
  matches: ResolvedMatch[];
  /** Wer in einen Abschnitt kommt (für Zwischenrunde und Anzeige), in Setzreihenfolge. */
  entrants: Record<string, { slot: SlotRef; team: ResolvedSlot }[]>;
  /** Vorschlag zum Eintragen bzw. Korrigieren, nur noch nicht angepfiffene Spiele. */
  changes: FillChange[];
  /** Hätte sich geändert, Spiel läuft aber schon oder ist vorbei: bleibt, wie es ist. */
  locked: FillChange[];
  /** Gleichstände beim Vergleich über Gruppen, für die die Turnierleitung noch losen muss. */
  needsLot: { stageId: string; place: number; teamIds: string[] }[];
}

const NONE: ResolvedSlot = { teamId: null, provisional: false };

/** Ob ein Spiel angepfiffen ist (läuft, beendet, nicht ausgetragen oder schon gewertet). */
export function isStarted(m: FormatMatch): boolean {
  return m.status === 'live' || m.status === 'completed' || m.status === 'not_played' || m.decidedBy === 'walkover';
}

/** Tabellen ohne zurückgezogene, nicht angetretene und inaktive Teams, Plätze neu durchgezählt. */
function activeStandings(standings: StageStandings, status: ReadonlyMap<string, TeamStatus>): StageStandings {
  return {
    ...standings,
    groups: standings.groups.map((table) =>
      table
        .filter((row) => (status.get(row.teamId) ?? 'active') === 'active')
        .sort((a, b) => a.place - b.place)
        .map((row, i) => ({ ...row, place: i + 1 })),
    ),
  };
}

function stored(id: string | undefined): string | null {
  return id ? id : null;
}

/** Position eines Erstrundenspiels im Hauptbaum (`QF3` → 2), sonst `null`. */
function firstRoundPosition(key: string | undefined, size: number): number | null {
  const prefix = { 32: 'R32_', 16: 'R16_', 8: 'QF', 4: 'SF', 2: '' }[size];
  if (key === undefined || prefix === undefined) return null;
  if (size === 2) return key === 'F' ? 0 : null;
  const m = new RegExp(`^${prefix}(\\d+)$`).exec(key);
  return m ? Number(m[1]) - 1 : null;
}

function meetWeight(i: number, j: number, rounds: number): number {
  const meet = i === j ? 1 : 2 + Math.floor(Math.log2(i ^ j));
  return 100 ** (rounds - meet);
}

function* permutations<T>(items: readonly T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield [...items];
    return;
  }
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) yield [items[i]!, ...p];
  }
}

class Resolver {
  private readonly status: Map<string, TeamStatus>;
  private readonly standings = new Map<string, StageStandings>();
  private readonly byKey = new Map<string, FormatMatch>();
  private readonly teamsCache = new Map<string, [ResolvedSlot, ResolvedSlot]>();
  /** `${matchId}|${side}` → Team für „beste n.“-Platzhalter nach Gruppentrennung im Baum. */
  private readonly bestOverride = new Map<string, string>();

  constructor(private readonly input: ResolveInput) {
    this.status = new Map(input.teams.map((t) => [t.id, t.status]));
    for (const [id, st] of Object.entries(input.standings)) this.standings.set(id, activeStandings(st, this.status));
    for (const m of input.matches) if (m.matchKey) this.byKey.set(`${m.stageId}|${m.matchKey}`, m);
    for (const stage of input.format.stages) if (stage.kind === 'knockout') this.separateBestOf(stage);
  }

  private complete(stageId: string, group?: number): boolean {
    const st = this.standings.get(stageId);
    if (!st) return false;
    return group === undefined ? st.groupComplete.length > 0 && st.groupComplete.every(Boolean) : st.groupComplete[group] === true;
  }

  /** Gruppe, aus der ein Team im Abschnitt `stageId` kommt. */
  groupOfTeam(stageId: string, teamId: string): number | null {
    const g = this.standings.get(stageId)?.groups.findIndex((table) => table.some((r) => r.teamId === teamId));
    return g === undefined || g < 0 ? null : g;
  }

  bestOf(stageId: string, place: number) {
    const st = this.standings.get(stageId);
    if (!st) return null;
    return rankBestOfPlace(st, place, this.input.lotOrders?.[`${stageId}|${place}`]);
  }

  private bestOfSlot(slot: Extract<SlotRef, { kind: 'best_of_place' }>): ResolvedSlot {
    const ranking = this.bestOf(slot.stageId, slot.place);
    const row = ranking?.rows[slot.rank - 1];
    if (!ranking || !row) return NONE;
    const tied = ranking.needsLot.some((ids) => ids.includes(row.row.teamId)) || this.inOpenLot(slot.stageId, row.row.teamId);
    return { teamId: row.row.teamId, provisional: tied || !this.complete(slot.stageId) };
  }

  /** Ob über den Platz des Teams in seiner Gruppe noch ein Los entscheiden muss (offene Lose aus dem Gruppen-Teil). */
  private inOpenLot(stageId: string, teamId: string, group?: number): boolean {
    const tables = (this.input.standings[stageId] as Partial<GroupStageStandings> | undefined)?.tables ?? [];
    return tables.some((t, i) => (group === undefined || i === group) && t.openLots.some((ids) => ids.includes(teamId)));
  }

  private tableRow(stageId: string, group: number, place: number): GroupTableRow | undefined {
    return this.standings.get(stageId)?.groups[group]?.[place - 1];
  }

  slot(ref: SlotRef | undefined): ResolvedSlot {
    if (!ref) return NONE;
    switch (ref.kind) {
      case 'team':
        return { teamId: ref.teamId, provisional: false };
      case 'group_place':
      case 'table_place': {
        const group = ref.kind === 'group_place' ? ref.group : 0;
        const row = this.tableRow(ref.stageId, group, ref.place);
        return row ? { teamId: row.teamId, provisional: !this.complete(ref.stageId, group) || this.inOpenLot(ref.stageId, row.teamId, group) } : NONE;
      }
      case 'best_of_place':
        return this.bestOfSlot(ref);
      case 'winner':
      case 'loser': {
        const source = this.byKey.get(`${ref.stageId}|${ref.matchKey}`);
        if (!source) return NONE;
        const outcome = decideKnockoutMatch(source);
        if (outcome.state !== 'decided') return NONE;
        const [a, b] = this.teams(source);
        const won = outcome.winner === 'A' ? a : b;
        const lost = outcome.winner === 'A' ? b : a;
        const pick = ref.kind === 'winner' ? won : lost;
        return pick.teamId ? { teamId: pick.teamId, provisional: false } : NONE;
      }
    }
  }

  /** Teams eines Spiels: gespeichertes Team, sonst der aufgelöste Platzhalter. */
  teams(m: FormatMatch): [ResolvedSlot, ResolvedSlot] {
    const cached = this.teamsCache.get(m.id);
    if (cached) return cached;
    const side = (s: Side): ResolvedSlot => {
      const id = stored(s === 'A' ? m.teamAId : m.teamBId);
      if (id) return { teamId: id, provisional: false };
      return this.resolved(m, s);
    };
    const result: [ResolvedSlot, ResolvedSlot] = [side('A'), side('B')];
    this.teamsCache.set(m.id, result);
    return result;
  }

  /** Aufgelöster Platzhalter einer Seite, ohne das gespeicherte Team zu beachten. */
  resolved(m: FormatMatch, s: Side): ResolvedSlot {
    const ref = s === 'A' ? m.slotA : m.slotB;
    const override = this.bestOverride.get(`${m.id}|${s}`);
    if (override && ref?.kind === 'best_of_place') return { teamId: override, provisional: this.bestOfSlot(ref).provisional };
    return this.slot(ref);
  }

  /**
   * „Beste n.“-Plätze im Baum so auf die Teams verteilen, dass Teams aus derselben Gruppe sich so spät
   * wie möglich treffen. Bei gleich guter Verteilung bekommt der Beste den Platz für Rang 1 usw.
   */
  private separateBestOf(stage: KnockoutStage) {
    type Leaf = { match: FormatMatch; side: Side; pos: number };
    const leaves: Leaf[] = [];
    for (const m of this.input.matches) {
      if (m.stageId !== stage.id) continue;
      const pos = firstRoundPosition(m.matchKey, stage.size);
      if (pos === null) continue;
      leaves.push({ match: m, side: 'A', pos }, { match: m, side: 'B', pos });
    }
    const refOf = (l: Leaf) => (l.side === 'A' ? l.match.slotA : l.match.slotB);
    const flexible = leaves
      .filter((l) => refOf(l)?.kind === 'best_of_place' && !stored(l.side === 'A' ? l.match.teamAId : l.match.teamBId))
      .sort((x, y) => (refOf(x) as { rank: number }).rank - (refOf(y) as { rank: number }).rank);
    if (flexible.length < 2 || flexible.length > 7) return;
    const sourceId = (refOf(flexible[0]!) as Extract<SlotRef, { kind: 'best_of_place' }>).stageId;
    const teams = flexible.map((l) => this.bestOfSlot(refOf(l) as Extract<SlotRef, { kind: 'best_of_place' }>).teamId);
    if (teams.some((t) => t === null)) return;
    const fixed = leaves.filter((l) => !flexible.includes(l));
    const fixedGroups = fixed.map((l) => {
      const team = this.slot(refOf(l)).teamId ?? stored(l.side === 'A' ? l.match.teamAId : l.match.teamBId);
      return { pos: l.pos, group: team ? this.groupOfTeam(sourceId, team) : null };
    });
    const rounds = Math.log2(stage.size);
    let best: { order: string[]; cost: number } | null = null;
    for (const order of permutations(teams as string[])) {
      const placed = [...fixedGroups, ...order.map((t, i) => ({ pos: flexible[i]!.pos, group: this.groupOfTeam(sourceId, t) }))];
      let cost = 0;
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
          const p = placed[i]!;
          const q = placed[j]!;
          if (p.group !== null && p.group === q.group) cost += meetWeight(p.pos, q.pos, rounds);
        }
      }
      if (!best || cost < best.cost) best = { order, cost };
    }
    best!.order.forEach((teamId, i) => this.bestOverride.set(`${flexible[i]!.match.id}|${flexible[i]!.side}`, teamId));
  }

  entrants(stage: StageConfig, sizes: Map<string, number[]>): { slot: SlotRef; team: ResolvedSlot }[] {
    if (!stage.entry) return [];
    const source = this.input.format.stages.find((s) => s.id === stage.entry!.fromStageId);
    if (!source) return [];
    return entrySlots(stage.entry, source, sizes.get(source.id) ?? []).map((slot) => ({ slot, team: this.slot(slot) }));
  }
}

/** Löst alle Platzhalter auf und schlägt vor, was in noch nicht angepfiffene Spiele eingetragen wird. */
export function resolveFormat(input: ResolveInput): Resolution {
  const r = new Resolver(input);
  const sizes = stageTableSizes(input.format, input.teams.length);
  const out: Resolution = { matches: [], entrants: {}, changes: [], locked: [], needsLot: [] };

  for (const stage of input.format.stages) {
    if (!stage.entry) continue;
    out.entrants[stage.id] = r.entrants(stage, sizes);
    for (const b of stage.entry.best ?? []) {
      for (const teamIds of r.bestOf(stage.entry.fromStageId, b.place)?.needsLot ?? []) {
        out.needsLot.push({ stageId: stage.entry.fromStageId, place: b.place, teamIds });
      }
    }
  }

  for (const m of input.matches) {
    if (!m.slotA && !m.slotB) continue;
    const [a, b] = r.teams(m);
    out.matches.push({ matchId: m.id, stageId: m.stageId, ...(m.matchKey ? { matchKey: m.matchKey } : {}), a, b, started: isStarted(m) });
    for (const side of ['A', 'B'] as const) {
      const ref = side === 'A' ? m.slotA : m.slotB;
      if (!ref || ref.kind === 'team') continue;
      const target = r.resolved(m, side);
      const current = stored(side === 'A' ? m.teamAId : m.teamBId);
      if (!target.teamId || target.provisional || target.teamId === current) continue;
      const change = { matchId: m.id, side, fromTeamId: current, toTeamId: target.teamId };
      (isStarted(m) ? out.locked : out.changes).push(change);
    }
  }
  return out;
}

export interface WithdrawalOption {
  matchId: string;
  /** Seite des zurückgezogenen Teams. */
  side: Side;
  /** „Gegner kampflos weiter“: diese Felder am Spiel setzen. */
  walkover: Required<Pick<StageMatchFields, 'decidedBy' | 'walkoverWinner'>>;
  /**
   * „Nächstbester rückt nach“: dieses Team als `{ kind: 'team' }` eintragen. `leavesStageId` ist der
   * Abschnitt derselben Runde, in dem das Team bisher steht (dort entsteht dann eine Lücke); `null`, wenn
   * es bisher ausgeschieden war. `null` insgesamt, wenn niemand nachrücken kann (z. B. ab der zweiten Runde).
   */
  replacement: { teamId: string; leavesStageId: string | null } | null;
}

/**
 * Wahlmöglichkeiten, wenn ein qualifiziertes Team vor seinem Endrunden-Spiel zurückzieht. Betrifft alle
 * noch nicht angepfiffenen Spiele mit diesem Team.
 */
export function withdrawalOptions(input: ResolveInput, teamId: string): WithdrawalOption[] {
  const r = new Resolver(input);
  const resolution = resolveFormat(input);
  const options: WithdrawalOption[] = [];
  const stageOf = (id: string) => input.format.stages.find((s) => s.id === id);

  const entrantIn = (stage: StageConfig, id: string) =>
    (resolution.entrants[stage.id] ?? []).some((e) => e.team.teamId === id) ||
    resolution.matches.some((m) => m.stageId === stage.id && (m.a.teamId === id || m.b.teamId === id));

  const replacementFor = (stage: StageConfig, ref: SlotRef | undefined): WithdrawalOption['replacement'] => {
    if (!ref || !stage.entry) return null;
    let candidates: string[];
    if (ref.kind === 'group_place' || ref.kind === 'table_place') {
      const st = input.standings[ref.stageId];
      const group = ref.kind === 'group_place' ? ref.group : 0;
      candidates = (st?.groups[group] ?? []).filter((row) => row.place > ref.place).sort((a, b) => a.place - b.place).map((row) => row.teamId);
    } else if (ref.kind === 'best_of_place') {
      candidates = (r.bestOf(ref.stageId, ref.place)?.rows ?? []).slice(ref.rank).map((x) => x.row.teamId);
    } else {
      return null;
    }
    const phaseMates = input.format.stages.filter((s) => s.phase === stage.phase && s.id !== stage.id);
    for (const id of candidates) {
      if (id === teamId || (input.teams.find((t) => t.id === id)?.status ?? 'active') !== 'active') continue;
      if (entrantIn(stage, id)) continue;
      const other = phaseMates.find((s) => entrantIn(s, id));
      return { teamId: id, leavesStageId: other?.id ?? null };
    }
    return null;
  };

  for (const m of input.matches) {
    if (isStarted(m)) continue;
    const [a, b] = r.teams(m);
    const side: Side | null = a.teamId === teamId ? 'A' : b.teamId === teamId ? 'B' : null;
    if (!side) continue;
    const stage = stageOf(m.stageId);
    if (!stage || !stage.entry) continue;
    options.push({
      matchId: m.id,
      side,
      walkover: walkoverFields(side === 'A' ? 'B' : 'A'),
      replacement: replacementFor(stage, side === 'A' ? m.slotA : m.slotB),
    });
  }
  return options;
}

export interface PlacementResult {
  /** Feste Endplätze (geteilt, wo nicht ausgespielt) und Ausgeschiedene. */
  placements: FinalPlacement[];
  /** Teams, deren Endplatz noch nicht feststeht. */
  open: string[];
}

/**
 * Endplatzierung. Nicht ausgespielte Plätze werden geteilt („5.–8.“). Wer in keinen Abschnitt mit
 * Platzbereich kommt, ist ausgeschieden (ohne Platz). Hat kein Abschnitt einen Platzbereich (Liga,
 * Schweizer System), zählt die Tabelle des letzten Abschnitts.
 */
export function finalPlacements(input: ResolveInput): PlacementResult {
  const r = new Resolver(input);
  const resolution = resolveFormat(input);
  const placed = new Map<string, FinalPlacement>();
  const place = (teamId: string | null, stage: StageConfig, from: number, to: number) => {
    if (!teamId || placed.has(teamId)) return;
    const offset = (stage.placeRange?.from ?? 1) - 1;
    placed.set(teamId, { teamId, placeFrom: from + offset, placeTo: to + offset, stageId: stage.id });
  };
  const stages = input.format.stages;
  const ranged = stages.some((s) => s.placeRange) ? stages.filter((s) => s.placeRange) : stages.slice(-1);

  for (const stage of ranged) {
    if (stage.kind === 'knockout') {
      const shape = buildBracket(
        stage,
        Array.from({ length: stage.size }, (_, i): SlotRef => ({ kind: 'table_place', stageId: '', place: i + 1 })),
      );
      const consumed = new Set(shape.flatMap((x) => [x.slotA, x.slotB]).flatMap((s) => (s.kind === 'winner' || s.kind === 'loser' ? [`${s.kind}|${s.matchKey}`] : [])));
      for (const node of shape) {
        const m = input.matches.find((x) => x.stageId === stage.id && x.matchKey === node.key);
        if (!m) continue;
        const outcome = decideKnockoutMatch(m);
        if (outcome.state !== 'decided') continue;
        const [a, b] = r.teams(m);
        const [won, lost] = outcome.winner === 'A' ? [a, b] : [b, a];
        const half = (node.range.to - node.range.from + 1) / 2;
        if (!consumed.has(`winner|${node.key}`)) place(won.teamId, stage, node.range.from, node.range.from + half - 1);
        if (!consumed.has(`loser|${node.key}`)) place(lost.teamId, stage, node.range.from + half, node.range.to);
      }
    } else if (stage.kind === 'placement') {
      const offset = (stage.placeRange?.from ?? 1) - 1;
      for (const pm of stage.matches) {
        const m = input.matches.find((x) => x.stageId === stage.id && x.matchKey === pm.key);
        if (!m) continue;
        const outcome = decideKnockoutMatch(m);
        if (outcome.state !== 'decided') continue;
        const [a, b] = r.teams(m);
        const [won, lost] = outcome.winner === 'A' ? [a, b] : [b, a];
        place(won.teamId, stage, pm.place - offset, pm.place - offset);
        place(lost.teamId, stage, pm.place - offset + 1, pm.place - offset + 1);
      }
    } else {
      const st = input.standings[stage.id];
      if (!st || !st.groupComplete.every(Boolean)) continue;
      const tables = activeStandings(st, new Map(input.teams.map((t) => [t.id, t.status])));
      if (tables.groups.length === 1) for (const row of tables.groups[0]!) place(row.teamId, stage, row.place, row.place);
    }
  }

  // Ausgeschieden: in einem fertigen Abschnitt ohne Platzbereich gespielt und in keinen weiteren gekommen.
  const rangedIds = new Set(ranged.map((s) => s.id));
  const eliminated = new Map<string, FinalPlacement>();
  for (const stage of stages) {
    if (rangedIds.has(stage.id)) continue;
    const st = input.standings[stage.id];
    if (!st || !st.groupComplete.every(Boolean)) continue;
    const next = stages.filter((s) => s.entry?.fromStageId === stage.id);
    const advanced = new Set(next.flatMap((s) => (resolution.entrants[s.id] ?? []).flatMap((e) => (e.team.teamId && !e.team.provisional ? [e.team.teamId] : []))));
    const nextFinal = next.every((s) => (resolution.entrants[s.id] ?? []).every((e) => !e.team.provisional));
    if (!nextFinal) continue;
    for (const row of st.groups.flat()) {
      if (!advanced.has(row.teamId) && !placed.has(row.teamId)) eliminated.set(row.teamId, { teamId: row.teamId, eliminatedInStageId: stage.id });
    }
  }
  const first = stages[0];
  for (const t of input.teams) {
    if (t.status !== 'active' && first && !placed.has(t.id) && !eliminated.has(t.id)) {
      eliminated.set(t.id, { teamId: t.id, eliminatedInStageId: first.id });
    }
  }

  const placements = [
    ...[...placed.values()].sort((x, y) => ('placeFrom' in x && 'placeFrom' in y ? x.placeFrom - y.placeFrom || x.teamId.localeCompare(y.teamId) : 0)),
    ...eliminated.values(),
  ];
  const done = new Set(placements.map((p) => p.teamId));
  return { placements, open: input.teams.filter((t) => !done.has(t.id)).map((t) => t.id) };
}
