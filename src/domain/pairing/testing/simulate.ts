// Testhilfen: simuliert komplette Turniere mit verdeckten Spielstärken.
// Die Mini-Wertung hier dient nur den Pairer-Tests (Punkte/Spiele/Freilose);
// die offizielle Tabelle kommt aus src/domain/scoring.
import { previewDrawRounds } from '../draw';
import { createRng, deriveSeed, type Rng } from '../random';
import { pairSwissRound } from '../swiss';
import type { PairingPlan, PairingTeam, PairingWeights, PastMeeting } from '../types';
import type { PairingMode } from '../../types';

export interface SimTeam {
  id: string;
  strength: number;
  points: number;
  played: number;
  byes: number;
  lastByeRound?: number;
  active: boolean;
}

export interface SimMatch {
  round: number;
  a: string;
  b: string;
  goalsA: number;
  goalsB: number;
  played: boolean;
}

export interface SimOptions {
  teams: number;
  rounds: number;
  preDrawRounds: number;
  seed: string;
  mode?: PairingMode;
  weights?: Partial<PairingWeights>;
  /** Wahrscheinlichkeit, dass ein Spiel nicht ausgetragen wird. */
  notPlayedRate?: number;
  /** Team-Index, der nach Runde `withdrawAfterRound` zurückzieht. */
  withdrawTeam?: number;
  withdrawAfterRound?: number;
}

export interface SimResult {
  teams: SimTeam[];
  matches: SimMatch[];
  plans: PairingPlan[];
}

export function teamId(i: number): string {
  return `T${String(i + 1).padStart(2, '0')}`;
}

export function toPairingTeams(teams: readonly SimTeam[]): PairingTeam[] {
  return teams
    .filter((t) => t.active)
    .map((t) => {
      const p: PairingTeam = { id: t.id, points: t.points, played: t.played, byes: t.byes };
      if (t.lastByeRound !== undefined) p.lastByeRound = t.lastByeRound;
      return p;
    });
}

/** Begegnungen ohne zurückgezogene Teams (Phils Regel: deren Spiele sind gelöscht). */
export function meetingsOf(result: Pick<SimResult, 'matches' | 'teams'>): PastMeeting[] {
  const active = new Set(result.teams.filter((t) => t.active).map((t) => t.id));
  return result.matches
    .filter((m) => m.played && active.has(m.a) && active.has(m.b))
    .map((m) => ({ teamAId: m.a, teamBId: m.b, roundNumber: m.round }));
}

function poisson(rng: Rng, lambda: number): number {
  const l = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > l);
  return k - 1;
}

/** Wertet das Ergebnis aus, getrennt von der Paarung. */
export function applyResult(teams: Map<string, SimTeam>, m: SimMatch): void {
  if (!m.played) return;
  const a = teams.get(m.a)!;
  const b = teams.get(m.b)!;
  a.played++;
  b.played++;
  if (m.goalsA > m.goalsB) a.points += 3;
  else if (m.goalsB > m.goalsA) b.points += 3;
  else {
    a.points++;
    b.points++;
  }
}

/** Erzeugt Punkte/Spiele neu aus allen Matches, ohne Spiele zurückgezogener Teams. */
export function recomputeStandings(result: SimResult): void {
  const byId = new Map(result.teams.map((t) => [t.id, t]));
  for (const t of result.teams) {
    t.points = 0;
    t.played = 0;
  }
  for (const m of result.matches) {
    if (!byId.get(m.a)!.active || !byId.get(m.b)!.active) continue;
    applyResult(byId, m);
  }
}

export function simulateTournament(o: SimOptions): SimResult {
  const rng = createRng(deriveSeed(o.seed, 'results'));
  const teams: SimTeam[] = Array.from({ length: o.teams }, (_, i) => ({
    id: teamId(i),
    strength: rng() * 2,
    points: 0,
    played: 0,
    byes: 0,
    active: true,
  }));
  const byId = new Map(teams.map((t) => [t.id, t]));
  const result: SimResult = { teams, matches: [], plans: [] };

  const play = (plan: PairingPlan) => {
    for (const p of plan.pairings) {
      const a = byId.get(p.teamAId)!;
      const b = byId.get(p.teamBId)!;
      const m: SimMatch = {
        round: plan.roundNumber,
        a: a.id,
        b: b.id,
        goalsA: poisson(rng, 1.2 * Math.exp(a.strength - b.strength)),
        goalsB: poisson(rng, 1.2 * Math.exp(b.strength - a.strength)),
        played: rng() >= (o.notPlayedRate ?? 0),
      };
      result.matches.push(m);
      applyResult(byId, m);
    }
    if (plan.byeTeamId) {
      const t = byId.get(plan.byeTeamId)!;
      t.byes++;
      t.lastByeRound = plan.roundNumber;
    }
    result.plans.push(plan);
  };

  const pre = Math.min(o.preDrawRounds, o.rounds);
  if (pre > 0) {
    const draw = previewDrawRounds({
      teams: teams.map((t) => ({ id: t.id })),
      count: pre,
      seed: o.seed,
    });
    for (const plan of draw.plans) play(plan);
  }
  for (let r = pre + 1; r <= o.rounds; r++) {
    if (o.withdrawTeam !== undefined && o.withdrawAfterRound === r - 1) {
      byId.get(teamId(o.withdrawTeam))!.active = false;
      recomputeStandings(result);
    }
    const input: Parameters<typeof pairSwissRound>[0] = {
      roundNumber: r,
      teams: toPairingTeams(teams),
      meetings: meetingsOf(result),
      seed: deriveSeed(o.seed, 'swiss', r),
    };
    if (o.mode) input.mode = o.mode;
    if (o.weights) input.weights = o.weights;
    play(pairSwissRound(input));
  }
  return result;
}

/** Tabellenrang nach Quotient (nur für Tests; Gleichstand nach ID). */
export function rankByQuotient(teams: readonly PairingTeam[]): string[] {
  const q = (t: PairingTeam) => (t.played === 0 ? -1 : t.points / t.played);
  return teams
    .slice()
    .sort((a, b) => q(b) - q(a) || (a.id < b.id ? -1 : 1))
    .map((t) => t.id);
}
