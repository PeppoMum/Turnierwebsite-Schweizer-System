import { minCostPerfectMatching } from './matching';
import { hashString } from './random';
import type { ByeCandidateEvaluation } from './types';

export interface TeamRef {
  id: string;
  byes: number;
}

export interface EdgeEval {
  total: number;
  quotientGap: number;
  previousMeetings: number;
}

export interface RoundSolution {
  pairs: Array<{ a: string; b: string; edge: EdgeEval }>;
  byeTeamId?: string;
  /** Matching-Kosten plus Freilos-Kosten. */
  totalCost: number;
  byeCandidates: ByeCandidateEvaluation[];
}

export interface SolveOptions<T extends TeamRef> {
  /** Kantenbewertung; `null` = Paarung verboten. */
  edge: (a: T, b: T) => EdgeEval | null;
  /** Kosten, wenn dieses Team das Freilos erhält. */
  byeCost: (team: T) => number;
}

/**
 * Löst eine Runde global: bei gerader Teamzahl ein Min-Cost-Perfect-Matching,
 * bei ungerader Zahl für jeden fairen Freilos-Kandidaten (minimale Freiloszahl)
 * ein eigenes Matching; gewählt wird die global günstigste Kombination (§7.2 Schritt 2 und 6).
 * Gibt `null` zurück, wenn kein gültiges Matching existiert.
 */
export function solveRound<T extends TeamRef>(teams: readonly T[], options: SolveOptions<T>): RoundSolution | null {
  if (teams.length % 2 === 0) {
    const solved = matchAll(teams, options);
    return solved && { ...solved, byeCandidates: [] };
  }

  const minByes = Math.min(...teams.map((t) => t.byes));
  const candidates = teams.filter((t) => t.byes === minByes);
  const evaluations: ByeCandidateEvaluation[] = [];
  let best: RoundSolution | null = null;
  for (const candidate of candidates) {
    const rest = teams.filter((t) => t !== candidate);
    const solved = matchAll(rest, options);
    if (!solved) {
      evaluations.push({ teamId: candidate.id, totalCost: null, chosen: false });
      continue;
    }
    const totalCost = solved.totalCost + options.byeCost(candidate);
    evaluations.push({ teamId: candidate.id, totalCost, chosen: false });
    if (!best || totalCost < best.totalCost) {
      best = { pairs: solved.pairs, byeTeamId: candidate.id, totalCost, byeCandidates: [] };
    }
  }
  if (!best) return null;
  for (const e of evaluations) e.chosen = e.teamId === best.byeTeamId;
  evaluations.sort((x, y) => (x.totalCost ?? Infinity) - (y.totalCost ?? Infinity));
  best.byeCandidates = evaluations;
  return best;
}

function matchAll<T extends TeamRef>(
  teams: readonly T[],
  options: SolveOptions<T>,
): Omit<RoundSolution, 'byeCandidates'> | null {
  const n = teams.length;
  const evals: Array<EdgeEval | null> = new Array(n * n).fill(null);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) evals[i * n + j] = options.edge(teams[i]!, teams[j]!);
  }
  const result = minCostPerfectMatching(n, (i, j) => evals[i * n + j]?.total ?? null);
  if (!result) return null;
  return {
    pairs: result.pairs.map(([i, j]) => ({ a: teams[i]!.id, b: teams[j]!.id, edge: evals[i * n + j]! })),
    totalCost: result.cost,
  };
}

/** Seeded Münzwurf für Heim/Auswärts (ohne sportliche Bedeutung). */
export function orient(seed: string, a: string, b: string): [string, string] {
  const [x, y] = a < b ? [a, b] : [b, a];
  return hashString(`${seed}\u0000side\u0000${x}\u0000${y}`) & 1 ? [y, x] : [x, y];
}
