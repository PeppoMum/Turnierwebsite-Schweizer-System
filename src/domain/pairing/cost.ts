import type { PairingMode } from '../types';
import type { MeetingCounter } from './meetings';
import { hashString } from './random';
import type { PairingTeam, PairingWeights } from './types';

/**
 * Voreinstellungen je Modus. Ausgangspunkt für Tuning (§7.2, OFFEN 3).
 *
 * Lesehilfe `balanced`: Eine Wiederholung kostet 20. Eine Quotenlücke von 1,0
 * (z. B. 2,0 gegen 1,0) kostet 100 · (1/3)² ≈ 11, eine Lücke von 2,5 (Erster gegen
 * Letzter) ≈ 69. Eine Wiederholung wird also erst in Kauf genommen, wenn die
 * Alternative die Runde insgesamt deutlich unausgeglichener macht.
 */
export const MODE_WEIGHTS: Record<PairingMode, PairingWeights> = {
  balanced: {
    quotient: 100,
    rematch: 20,
    tripleEncounter: 60,
    playedGap: 3,
    confidenceDamping: 1,
    byePlayedDeficit: 30,
    byeRecent: 5,
    jitter: 0.001,
  },
  // Wie balanced, Wiederholungskanten sind aber hart verboten, solange es geht.
  strict_no_rematch: {
    quotient: 100,
    rematch: 20,
    tripleEncounter: 60,
    playedGap: 3,
    confidenceDamping: 1,
    byePlayedDeficit: 30,
    byeRecent: 5,
    jitter: 0.001,
  },
  performance_first: {
    quotient: 100,
    rematch: 6,
    tripleEncounter: 40,
    playedGap: 3,
    confidenceDamping: 0.5,
    byePlayedDeficit: 30,
    byeRecent: 5,
    jitter: 0.001,
  },
};

export function resolveWeights(mode: PairingMode, overrides?: Partial<PairingWeights>): PairingWeights {
  return { ...MODE_WEIGHTS[mode], ...overrides };
}

/** Echter Quotient; `null` bei 0 Spielen (Anzeige „–“). */
export function realQuotient(team: Pick<PairingTeam, 'points' | 'played'>): number | null {
  return team.played === 0 ? null : team.points / team.played;
}

/**
 * Neutraler Prior für Teams ohne Spiel: mittlerer Quotient der Teams mit Spielen,
 * sonst 1,5 (Mitte der Skala). Nur intern für die Paarung, nie anzeigen.
 */
export function neutralPrior(teams: readonly PairingTeam[]): number {
  let sum = 0;
  let n = 0;
  for (const t of teams) {
    const q = realQuotient(t);
    if (q !== null) {
      sum += q;
      n++;
    }
  }
  return n === 0 ? 1.5 : sum / n;
}

/** Quote, mit der gepaart wird: echt, oder bei 0 Spielen der neutrale Prior. */
export function quotientForPairing(team: PairingTeam, prior: number): number {
  return realQuotient(team) ?? prior;
}

export function effectiveQuotientWeight(teams: readonly PairingTeam[], weights: PairingWeights): number {
  if (weights.confidenceDamping <= 0 || teams.length === 0) return weights.quotient;
  const avgPlayed = teams.reduce((s, t) => s + t.played, 0) / teams.length;
  if (avgPlayed === 0) return weights.quotient;
  return (weights.quotient * avgPlayed) / (avgPlayed + weights.confidenceDamping);
}

/** Seeded Zufallsanteil in [0, 1), unabhängig von der Reihenfolge der Teams. */
export function pairJitter(seed: string, a: string, b: string): number {
  const [x, y] = a < b ? [a, b] : [b, a];
  return hashString(`${seed}\u0000${x}\u0000${y}`) / 4294967296;
}

export interface EdgeCostContext {
  weights: PairingWeights;
  quotientWeight: number;
  meetings: MeetingCounter;
  prior: number;
  seed: string;
}

export interface EdgeCostBreakdown {
  total: number;
  quotientGap: number;
  previousMeetings: number;
}

/**
 * Kantenkosten nach §7.2: quadrierte normierte Quotenlücke, quadratische
 * Wiederholungsstrafe (plus Zusatzstrafe ab der dritten Begegnung) und
 * Spielzahl-Unterschied, gewichtet mit der kleineren Stichprobe.
 * Keine feste Punktedifferenz in Rohpunkten.
 */
export function edgeCost(a: PairingTeam, b: PairingTeam, ctx: EdgeCostContext): EdgeCostBreakdown {
  const qa = quotientForPairing(a, ctx.prior);
  const qb = quotientForPairing(b, ctx.prior);
  const quotientGap = Math.abs(qa - qb);
  const g = quotientGap / 3;
  const repeats = ctx.meetings.count(a.id, b.id);
  const playedGap = Math.abs(a.played - b.played);
  const relativeSampleEffect = 1 / (1 + Math.min(a.played, b.played));
  const w = ctx.weights;
  const total =
    ctx.quotientWeight * g * g +
    w.rematch * repeats * repeats +
    (repeats >= 2 ? w.tripleEncounter * (repeats - 1) : 0) +
    w.playedGap * playedGap * relativeSampleEffect +
    w.jitter * pairJitter(ctx.seed, a.id, b.id);
  return { total, quotientGap, previousMeetings: repeats };
}
