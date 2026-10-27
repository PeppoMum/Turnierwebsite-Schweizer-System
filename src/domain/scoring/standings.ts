// Tabellenberechnung (Spezifikation §6) als reine, deterministische Funktion.
//
// Verbindliche Abweichung von §6.1/§6.3 (Entscheidung Phil, 27.10.2026):
// Ein zurückgezogenes Team kann nie Turniersieger werden. Alle Spiele mit ihm werden für
// ALLE Teams aus der Wertung gelöscht, als hätten sie nie stattgefunden – egal wie sie
// ausgegangen sind. Die Spiele bleiben in den Daten erhalten, zählen aber nirgends mehr.
// Dasselbe gilt für Teams mit Status `no_show` und `inactive`: Gewertet wird nur, wer `active` ist.

import type { Bye, BuchholzVariant, Match, Round, Team, TeamStatus, TieBreaker } from '../types';
import { type Fraction, ZERO, add, compare as compareFractions, divide, fraction, toNumber } from './fraction';
import { compareByLot } from './lot';

export const POINTS = { win: 3, draw: 1, loss: 0 } as const;
export const DEFAULT_TIE_BREAKERS: readonly TieBreaker[] = ['head_to_head', 'goal_diff', 'goals_for'];
export const DEFAULT_BUCHHOLZ_VARIANT: BuchholzVariant = 'avg_opponent_quotient';

export type StandingsTeam = Pick<Team, 'id' | 'name' | 'status'>;
export type StandingsMatch = Pick<Match, 'teamAId' | 'teamBId' | 'status' | 'goalsA' | 'goalsB' | 'roundNumber'>;

export interface StandingsInput {
  teams: readonly StandingsTeam[];
  matches: readonly StandingsMatch[];
  byes?: readonly Pick<Bye, 'teamId' | 'roundId'>[];
  /** Nur nötig, um Freilose mit `throughRound` nach Runde zu filtern. */
  rounds?: readonly Pick<Round, 'id' | 'number'>[];
  /** Reihenfolge der Feinwertungen nach dem Quotienten. Standard: direkter Vergleich, Tordifferenz, Tore. */
  tieBreakers?: readonly TieBreaker[];
  buchholzVariant?: BuchholzVariant;
  /** Gespeicherter Seed für den Losentscheid bei vollständigem Gleichstand, z. B. die Turnier-ID. */
  lotSeed: string;
  /** Nur Spiele bis einschließlich dieser Runde berücksichtigen (z. B. eingefrorener Stand für die Paarung). */
  throughRound?: number;
}

/** Wodurch sich ein Team vom direkt darüber stehenden Team unterscheidet. */
export type RankDecider = 'quotient' | TieBreaker | 'lot';

export interface TeamStanding {
  teamId: string;
  name: string;
  status: TeamStatus;
  /** 1-basiert und eindeutig; `null` für nicht wertungsberechtigte Teams. */
  rank: number | null;
  /** false: zurückgezogen, nicht angetreten oder inaktiv – steht unter der Tabelle und kann nicht gewinnen. */
  eligible: boolean;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  /** Punkte pro Spiel, nur zur Anzeige. `null` bei 0 Spielen (Anzeige „–“). Sortiert wird exakt. */
  quotient: number | null;
  byes: number;
  /** Nur gesetzt, wenn Buchholz als Feinwertung aktiv ist und das Team gespielt hat. */
  buchholz: number | null;
  decidedBy: RankDecider | null;
}

interface Stats {
  team: StandingsTeam;
  eligible: boolean;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  byes: number;
  opponents: string[];
  buchholz: Fraction | null;
  decidedBy: RankDecider | null;
}

interface CountedMatch {
  a: string;
  b: string;
  goalsA: number;
  goalsB: number;
}

function isValidGoal(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Ob ein Teamstatus in der Wertung zählt. */
export function isRankedStatus(status: TeamStatus): boolean {
  return status === 'active';
}

/**
 * Spiele, die in die Wertung eingehen: `completed`, zwei gültige Torwerte, zwei verschiedene
 * wertungsberechtigte Teams. Alles andere (nicht ausgetragen, abgesagt, geplant, läuft, Spiele
 * gegen zurückgezogene Teams) zählt nicht.
 */
export function countedMatches(input: Pick<StandingsInput, 'teams' | 'matches' | 'throughRound'>): CountedMatch[] {
  const ranked = new Set(input.teams.filter((t) => isRankedStatus(t.status)).map((t) => t.id));
  const result: CountedMatch[] = [];
  for (const m of input.matches) {
    if (m.status !== 'completed') continue;
    if (!isValidGoal(m.goalsA) || !isValidGoal(m.goalsB)) continue;
    if (m.teamAId === m.teamBId) continue;
    if (!ranked.has(m.teamAId) || !ranked.has(m.teamBId)) continue;
    if (input.throughRound !== undefined && m.roundNumber > input.throughRound) continue;
    result.push({ a: m.teamAId, b: m.teamBId, goalsA: m.goalsA, goalsB: m.goalsB });
  }
  return result;
}

/** Vergleicht Quotienten exakt per Kreuzmultiplikation. Teams ohne Spiel stehen hinter allen anderen. */
export function compareQuotient(a: { points: number; played: number }, b: { points: number; played: number }): number {
  if (a.played === 0 || b.played === 0) {
    if (a.played === 0 && b.played === 0) return 0;
    return a.played === 0 ? -1 : 1;
  }
  const l = a.points * b.played;
  const r = b.points * a.played;
  return l < r ? -1 : l > r ? 1 : 0;
}

function quotientFraction(s: Stats): Fraction | null {
  return s.played === 0 ? null : fraction(s.points, s.played);
}

function computeBuchholz(s: Stats, byId: Map<string, Stats>, variant: BuchholzVariant): Fraction | null {
  if (s.opponents.length === 0) return null;
  let sum = ZERO;
  for (const oppId of s.opponents) {
    const opp = byId.get(oppId)!;
    sum = add(sum, variant === 'sum_opponent_points' ? fraction(opp.points) : quotientFraction(opp)!);
  }
  return variant === 'avg_opponent_quotient' ? divide(sum, s.opponents.length) : sum;
}

function compareNullableFractions(a: Fraction | null, b: Fraction | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? -1 : 1;
  return compareFractions(a, b);
}

/**
 * Punkte im direkten Vergleich innerhalb der Gruppe, oder `null`, wenn keine vollständige,
 * vergleichbare Mini-Liga vorliegt: Jedes Paar der Gruppe muss gleich oft (mindestens einmal)
 * gegeneinander gewertet gespielt haben. Bei genau zwei Teams reicht ein gewertetes Spiel.
 */
function headToHeadPoints(group: readonly Stats[], matches: readonly CountedMatch[]): Map<string, number> | null {
  const ids = new Set(group.map((s) => s.team.id));
  const pairCounts = new Map<string, number>();
  const points = new Map<string, number>(group.map((s) => [s.team.id, 0]));
  for (const m of matches) {
    if (!ids.has(m.a) || !ids.has(m.b)) continue;
    const key = m.a < m.b ? `${m.a}\u0000${m.b}` : `${m.b}\u0000${m.a}`;
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    const [pa, pb] = m.goalsA > m.goalsB ? [POINTS.win, POINTS.loss] : m.goalsA < m.goalsB ? [POINTS.loss, POINTS.win] : [POINTS.draw, POINTS.draw];
    points.set(m.a, points.get(m.a)! + pa);
    points.set(m.b, points.get(m.b)! + pb);
  }
  const expectedPairs = (group.length * (group.length - 1)) / 2;
  if (pairCounts.size !== expectedPairs) return null;
  const counts = new Set(pairCounts.values());
  if (counts.size !== 1) return null;
  return points;
}

/** Sortiert absteigend nach `cmp` (größer = besser) und teilt in Läufe gleicher Werte. */
function partition(group: readonly Stats[], cmp: (a: Stats, b: Stats) => number): Stats[][] {
  const sorted = [...group].sort((a, b) => cmp(b, a));
  const runs: Stats[][] = [];
  for (const s of sorted) {
    const run = runs[runs.length - 1];
    if (run && cmp(run[0]!, s) === 0) run.push(s);
    else runs.push([s]);
  }
  return runs;
}

function criterionComparator(
  criterion: TieBreaker,
  group: readonly Stats[],
  matches: readonly CountedMatch[],
): ((a: Stats, b: Stats) => number) | null {
  switch (criterion) {
    case 'head_to_head': {
      const h2h = headToHeadPoints(group, matches);
      if (!h2h) return null;
      return (a, b) => h2h.get(a.team.id)! - h2h.get(b.team.id)!;
    }
    case 'goal_diff':
      return (a, b) => a.goalsFor - a.goalsAgainst - (b.goalsFor - b.goalsAgainst);
    case 'goals_for':
      return (a, b) => a.goalsFor - b.goalsFor;
    case 'buchholz':
      return (a, b) => compareNullableFractions(a.buchholz, b.buchholz);
  }
}

/**
 * Ordnet eine Gruppe quotientengleicher Teams. Trennt ein Kriterium die Gruppe, wird jede
 * Teilgruppe erneut mit demselben Kriterium geprüft (wichtig für den direkten Vergleich: die
 * Mini-Liga wird dann nur unter den weiterhin Gleichstehenden gebildet), sonst geht es mit dem
 * nächsten Kriterium weiter. Am Ende entscheidet das Los.
 */
function resolveTie(
  group: Stats[],
  index: number,
  ctx: { tieBreakers: readonly TieBreaker[]; matches: readonly CountedMatch[]; lotSeed: string },
): Stats[] {
  if (group.length <= 1) return group;
  const criterion = ctx.tieBreakers[index];
  if (criterion === undefined) {
    const byLot = [...group].sort((a, b) => compareByLot(ctx.lotSeed, a.team.id, b.team.id));
    for (const s of byLot.slice(1)) s.decidedBy = 'lot';
    return byLot;
  }
  const cmp = criterionComparator(criterion, group, ctx.matches);
  const runs = cmp ? partition(group, cmp) : [group];
  if (runs.length === 1) return resolveTie(group, index + 1, ctx);
  const resolved = runs.map((run) => resolveTie(run, index, ctx));
  for (const run of resolved.slice(1)) run[0]!.decidedBy = criterion;
  return resolved.flat();
}

function compareUnranked(a: Stats, b: Stats): number {
  const byName = a.team.name.localeCompare(b.team.name, 'de');
  if (byName !== 0) return byName;
  return a.team.id < b.team.id ? -1 : a.team.id > b.team.id ? 1 : 0;
}

export function calculateStandings(input: StandingsInput): TeamStanding[] {
  const tieBreakers = input.tieBreakers ?? DEFAULT_TIE_BREAKERS;
  const buchholzActive = tieBreakers.includes('buchholz');
  const variant = input.buchholzVariant ?? DEFAULT_BUCHHOLZ_VARIANT;

  const byId = new Map<string, Stats>();
  for (const team of input.teams) {
    if (byId.has(team.id)) continue;
    byId.set(team.id, {
      team,
      eligible: isRankedStatus(team.status),
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      points: 0,
      byes: 0,
      opponents: [],
      buchholz: null,
      decidedBy: null,
    });
  }

  const matches = countedMatches(input);
  for (const m of matches) {
    const a = byId.get(m.a)!;
    const b = byId.get(m.b)!;
    for (const [self, opp, gf, ga] of [
      [a, b, m.goalsA, m.goalsB],
      [b, a, m.goalsB, m.goalsA],
    ] as const) {
      self.played++;
      self.goalsFor += gf;
      self.goalsAgainst += ga;
      self.opponents.push(opp.team.id);
      if (gf > ga) {
        self.wins++;
        self.points += POINTS.win;
      } else if (gf === ga) {
        self.draws++;
        self.points += POINTS.draw;
      } else {
        self.losses++;
      }
    }
  }

  const roundNumberById = new Map(input.rounds?.map((r) => [r.id, r.number]));
  for (const bye of input.byes ?? []) {
    const s = byId.get(bye.teamId);
    if (!s) continue;
    if (input.throughRound !== undefined) {
      const n = roundNumberById.get(bye.roundId);
      if (n === undefined || n > input.throughRound) continue;
    }
    s.byes++;
  }

  const all = [...byId.values()];
  if (buchholzActive) {
    for (const s of all) if (s.eligible) s.buchholz = computeBuchholz(s, byId, variant);
  }

  const ctx = { tieBreakers, matches, lotSeed: input.lotSeed };
  const quotientGroups = partition(
    all.filter((s) => s.eligible),
    compareQuotient,
  );
  const resolvedGroups = quotientGroups.map((g) => resolveTie(g, 0, ctx));
  for (const g of resolvedGroups.slice(1)) g[0]!.decidedBy = 'quotient';
  const ranked = resolvedGroups.flat();
  const unranked = all.filter((s) => !s.eligible).sort(compareUnranked);

  return [...ranked, ...unranked].map((s, i) => ({
    teamId: s.team.id,
    name: s.team.name,
    status: s.team.status,
    rank: s.eligible ? i + 1 : null,
    eligible: s.eligible,
    played: s.played,
    wins: s.wins,
    draws: s.draws,
    losses: s.losses,
    goalsFor: s.goalsFor,
    goalsAgainst: s.goalsAgainst,
    goalDiff: s.goalsFor - s.goalsAgainst,
    points: s.points,
    quotient: s.played === 0 ? null : s.points / s.played,
    byes: s.byes,
    buchholz: s.buchholz === null ? null : toNumber(s.buchholz),
    decidedBy: s.eligible ? s.decidedBy : null,
  }));
}
