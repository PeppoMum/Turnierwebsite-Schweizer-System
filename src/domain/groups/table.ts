// Gruppentabelle im Turnier-Baukasten (docs/turnier-baukasten.md, Abschnitt „Wertung“).
//
// - Punkte immer 3 / 1 / 0. Sortiert wird nach Punkten, nicht nach Quotient: in einer Gruppe
//   spielen alle gleich viele Spiele.
// - Punktgleichheit nach `TIE_BREAK_ORDER` (Variante 1 `h2h_first`, Variante 2 `goals_first`).
//   Direkter Vergleich = Mini-Tabelle aus den Spielen der Gleichstehenden untereinander
//   (Punkte, dann Tordifferenz, dann Tore). Trennt ein Kriterium nur teilweise, wird es unter den
//   weiterhin Gleichstehenden neu angewendet, wie im Schweizer System (src/domain/scoring/standings.ts).
// - Zuletzt das Los. Es zieht die Turnierleitung; gezogene Lose kommen als `lots` herein. Ist für
//   einen Gleichstand noch kein Los gezogen, steht er in `openLots` und die Reihenfolge ist vorläufig.
// - Zurückgezogene, nicht angetretene und inaktive Teams: alle ihre Spiele zählen für niemanden
//   (Entscheidung Phil, 27.10.2026). Sie stehen nicht in der Tabelle, sondern in `unranked`.

import type { TieBreakVariant, GroupTableRow, GroupTieBreaker } from '../format/types';
import { TIE_BREAK_ORDER } from '../format/types';
import { POINTS, countedMatches, isRankedStatus, type StandingsTeam } from '../scoring/standings';
import type { MatchStatus } from '../types';

export interface GroupMatch {
  teamAId: string;
  teamBId: string;
  status: MatchStatus;
  goalsA?: number;
  goalsB?: number;
}

/** Ein gezogenes Los: Reihenfolge der Teams, das bessere zuerst. Gilt für jeden Gleichstand, dessen Teams alle darin vorkommen. */
export interface LotDecision {
  teamIds: string[];
}

/** Aus der Vorrunde mitgenommene Werte (nur Zwischenrunde mit `carryOverPoints`). */
export interface CarryOver {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

export interface GroupTableInput {
  /** Alle Teams der Gruppe, auch zurückgezogene. */
  teams: readonly StandingsTeam[];
  /** Spiele dieser Gruppe in diesem Abschnitt. Gezählt wird nur `completed` mit gültigen Toren. */
  matches: readonly GroupMatch[];
  variant: TieBreakVariant;
  lots?: readonly LotDecision[];
  carryOver?: ReadonlyMap<string, CarryOver>;
}

export interface GroupTable {
  /** Gewertete Teams, `place` 1-basiert und eindeutig. */
  rows: GroupTableRow[];
  /** Nicht gewertete Teams (zurückgezogen, nicht angetreten, inaktiv), nach Name. */
  unranked: string[];
  /** Gleichstände, die nur noch ein Los entscheiden kann und für die keins gezogen ist (vorläufige Reihenfolge). */
  openLots: string[][];
}

interface Stats extends CarryOver {
  team: StandingsTeam;
  decidedBy?: GroupTableRow['decidedBy'];
}

interface Counted {
  a: string;
  b: string;
  goalsA: number;
  goalsB: number;
}

type Cmp = (a: Stats, b: Stats) => number;

/**
 * Mini-Tabelle der Gleichstehenden aus ihren Spielen untereinander, oder `null`, solange sie nicht
 * vergleichbar ist: Jedes Paar muss gleich oft (mindestens einmal) gegeneinander gewertet gespielt haben.
 */
function miniTable(group: readonly Stats[], matches: readonly Counted[]): Cmp | null {
  const ids = new Set(group.map((s) => s.team.id));
  const mini = new Map(group.map((s) => [s.team.id, { points: 0, diff: 0, goals: 0 }]));
  const pairCounts = new Map<string, number>();
  for (const m of matches) {
    if (!ids.has(m.a) || !ids.has(m.b)) continue;
    const key = m.a < m.b ? `${m.a}\u0000${m.b}` : `${m.b}\u0000${m.a}`;
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    const a = mini.get(m.a)!;
    const b = mini.get(m.b)!;
    a.goals += m.goalsA;
    b.goals += m.goalsB;
    a.diff += m.goalsA - m.goalsB;
    b.diff += m.goalsB - m.goalsA;
    if (m.goalsA > m.goalsB) a.points += POINTS.win;
    else if (m.goalsA < m.goalsB) b.points += POINTS.win;
    else {
      a.points += POINTS.draw;
      b.points += POINTS.draw;
    }
  }
  if (pairCounts.size !== (group.length * (group.length - 1)) / 2) return null;
  if (new Set(pairCounts.values()).size !== 1) return null;
  return (x, y) => {
    const a = mini.get(x.team.id)!;
    const b = mini.get(y.team.id)!;
    return a.points - b.points || a.diff - b.diff || a.goals - b.goals;
  };
}

function comparator(criterion: GroupTieBreaker, group: readonly Stats[], matches: readonly Counted[]): Cmp | null {
  switch (criterion) {
    case 'head_to_head':
      return miniTable(group, matches);
    case 'goal_diff':
      return (a, b) => a.goalsFor - a.goalsAgainst - (b.goalsFor - b.goalsAgainst);
    case 'goals_for':
      return (a, b) => a.goalsFor - b.goalsFor;
    case 'wins':
      return (a, b) => a.won - b.won;
  }
}

/** Sortiert absteigend (größer = besser) und teilt in Läufe gleicher Werte. */
function partition(group: readonly Stats[], cmp: Cmp): Stats[][] {
  const sorted = [...group].sort((a, b) => cmp(b, a));
  const runs: Stats[][] = [];
  for (const s of sorted) {
    const run = runs[runs.length - 1];
    if (run && cmp(run[0]!, s) === 0) run.push(s);
    else runs.push([s]);
  }
  return runs;
}

function byName(a: StandingsTeam, b: StandingsTeam): number {
  return a.name.localeCompare(b.name, 'de') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

interface Ctx {
  order: readonly GroupTieBreaker[];
  matches: readonly Counted[];
  lots: readonly LotDecision[];
  openLots: string[][];
}

/** Los anwenden: das jüngste gezogene Los, das alle Teams des Gleichstands enthält. */
function applyLot(group: Stats[], ctx: Ctx): Stats[] {
  const ids = group.map((s) => s.team.id);
  for (let i = ctx.lots.length - 1; i >= 0; i--) {
    const order = ctx.lots[i]!.teamIds;
    if (!ids.every((id) => order.includes(id))) continue;
    const sorted = [...group].sort((a, b) => order.indexOf(a.team.id) - order.indexOf(b.team.id));
    for (const s of sorted.slice(1)) s.decidedBy = 'lot';
    return sorted;
  }
  const provisional = [...group].sort((a, b) => byName(a.team, b.team));
  ctx.openLots.push(provisional.map((s) => s.team.id));
  return provisional;
}

function resolveTie(group: Stats[], index: number, ctx: Ctx): Stats[] {
  if (group.length <= 1) return group;
  const criterion = ctx.order[index];
  if (criterion === undefined) return applyLot(group, ctx);
  const cmp = comparator(criterion, group, ctx.matches);
  const runs = cmp ? partition(group, cmp) : [group];
  if (runs.length === 1) return resolveTie(group, index + 1, ctx);
  const resolved = runs.map((run) => resolveTie(run, index, ctx));
  for (const run of resolved.slice(1)) run[0]!.decidedBy = criterion;
  return resolved.flat();
}

export function calculateGroupTable(input: GroupTableInput): GroupTable {
  const byId = new Map<string, Stats>();
  for (const team of input.teams) {
    if (byId.has(team.id)) continue;
    const carried = isRankedStatus(team.status) ? input.carryOver?.get(team.id) : undefined;
    byId.set(team.id, {
      team,
      played: carried?.played ?? 0,
      won: carried?.won ?? 0,
      drawn: carried?.drawn ?? 0,
      lost: carried?.lost ?? 0,
      goalsFor: carried?.goalsFor ?? 0,
      goalsAgainst: carried?.goalsAgainst ?? 0,
      points: carried?.points ?? 0,
    });
  }

  const matches: Counted[] = countedMatches({
    teams: input.teams,
    matches: input.matches.map((m) => ({ ...m, roundNumber: 0 })),
  });
  for (const m of matches) {
    const a = byId.get(m.a)!;
    const b = byId.get(m.b)!;
    for (const [self, gf, ga] of [
      [a, m.goalsA, m.goalsB],
      [b, m.goalsB, m.goalsA],
    ] as const) {
      self.played++;
      self.goalsFor += gf;
      self.goalsAgainst += ga;
      if (gf > ga) {
        self.won++;
        self.points += POINTS.win;
      } else if (gf === ga) {
        self.drawn++;
        self.points += POINTS.draw;
      } else {
        self.lost++;
      }
    }
  }

  const all = [...byId.values()];
  const ranked = all.filter((s) => isRankedStatus(s.team.status));
  const ctx: Ctx = { order: TIE_BREAK_ORDER[input.variant], matches, lots: input.lots ?? [], openLots: [] };
  const byPoints = partition(ranked, (a, b) => a.points - b.points);
  const resolved = byPoints.map((g) => resolveTie(g, 0, ctx));
  for (const g of resolved.slice(1)) g[0]!.decidedBy = 'points';

  return {
    rows: resolved.flat().map((s, i) => ({
      teamId: s.team.id,
      place: i + 1,
      played: s.played,
      won: s.won,
      drawn: s.drawn,
      lost: s.lost,
      goalsFor: s.goalsFor,
      goalsAgainst: s.goalsAgainst,
      points: s.points,
      ...(i > 0 && s.decidedBy ? { decidedBy: s.decidedBy } : {}),
    })),
    unranked: all
      .filter((s) => !isRankedStatus(s.team.status))
      .map((s) => s.team)
      .sort(byName)
      .map((t) => t.id),
    openLots: ctx.openLots,
  };
}

/** Mitnahme-Werte aus einer fertigen Tabelle (für `carryOverPoints`). */
export function carryOverFrom(tables: readonly (readonly GroupTableRow[])[]): Map<string, CarryOver> {
  const out = new Map<string, CarryOver>();
  for (const row of tables.flat()) {
    const { played, won, drawn, lost, goalsFor, goalsAgainst, points } = row;
    out.set(row.teamId, { played, won, drawn, lost, goalsFor, goalsAgainst, points });
  }
  return out;
}
