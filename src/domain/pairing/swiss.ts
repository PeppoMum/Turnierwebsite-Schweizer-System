import type { PairingMode } from '../types';
import {
  edgeCost,
  effectiveQuotientWeight,
  neutralPrior,
  quotientForPairing,
  resolveWeights,
  type EdgeCostContext,
} from './cost';
import { formatNumber, teamLabel } from './format';
import { MeetingCounter } from './meetings';
import { hashString } from './random';
import { orient, solveRound, type RoundSolution } from './solve';
import type {
  ExtendedPairingDiagnostics,
  Pairing,
  PairingAlternative,
  PairingPlan,
  PairingTeam,
  PairingWeights,
  PastMeeting,
} from './types';

export interface SwissRoundInput {
  roundNumber: number;
  /** Nur aktive Teams (keine zurückgezogenen, nicht erschienenen oder inaktiven). */
  teams: readonly PairingTeam[];
  /** Bisherige Begegnungen, siehe `collectMeetings`. */
  meetings?: readonly PastMeeting[];
  mode?: PairingMode;
  /** Gespeicherter Zufallsseed; gleiche Eingabe + gleicher Seed = gleiche Paarung. */
  seed: string;
  weights?: Partial<PairingWeights>;
}

/** Ab dieser Quotenlücke (Skala 0..3) wird eine Paarung als auffällig gemeldet. */
export const LARGE_GAP_WARNING = 1.5;

/**
 * Berechnet eine Schweizer Runde als globales Min-Cost-Perfect-Matching (§7.2).
 * Rein und deterministisch: keine Seiteneffekte, kein `Math.random`.
 */
export function pairSwissRound(input: SwissRoundInput): PairingPlan {
  const mode = input.mode ?? 'balanced';
  const weights = resolveWeights(mode, input.weights);
  const teams = sortedUnique(input.teams);
  const names = new Map(teams.map((t) => [t.id, t.name ?? t.id]));
  const byId = new Map(teams.map((t) => [t.id, t]));
  const meetings = new MeetingCounter(
    (input.meetings ?? []).filter((m) => byId.has(m.teamAId) && byId.has(m.teamBId)),
  );
  const prior = neutralPrior(teams);
  const ctx: EdgeCostContext = {
    weights,
    quotientWeight: effectiveQuotientWeight(teams, weights),
    meetings,
    prior,
    seed: input.seed,
  };
  const maxPlayed = Math.max(0, ...teams.map((t) => t.played));
  const byeCost = (t: PairingTeam) =>
    weights.byePlayedDeficit * (maxPlayed - t.played) +
    (t.lastByeRound !== undefined && t.lastByeRound === input.roundNumber - 1 ? weights.byeRecent : 0) +
    weights.jitter * (hashString(`${input.seed}\u0000bye\u0000${t.id}`) / 4294967296);

  const solve = (forbidRematch: boolean) =>
    solveRound(teams, {
      edge: (a, b) => {
        if (forbidRematch && meetings.count(a.id, b.id) > 0) return null;
        return edgeCost(a, b, ctx);
      },
      byeCost,
    });

  const explanations: string[] = [];
  const warnings: string[] = [];
  const alternatives: PairingAlternative[] = [];

  // Strict: zuerst ohne Wiederholungskanten. Sonst: frei optimieren und die
  // wiederholungsfreie Variante nur zur Begründung berechnen, wenn nötig.
  let noRematch: RoundSolution | null | undefined;
  let chosen: RoundSolution;
  let status: PairingPlan['status'] = 'ok';
  if (mode === 'strict_no_rematch') noRematch = solve(true);
  if (noRematch) {
    chosen = noRematch;
  } else {
    const free = solve(false);
    if (!free) throw new Error('Für diese Runde konnte keine gültige Paarung berechnet werden.');
    chosen = free;
    if (mode === 'strict_no_rematch') {
      status = 'needs_confirmation';
      warnings.push(
        'Im Modus „Keine Wiederholungen“ ist diese Runde nicht ohne Wiederholung möglich. ' +
          'Der Vorschlag unten nimmt so wenige Wiederholungen wie sinnvoll in Kauf – bitte ausdrücklich bestätigen.',
      );
    }
  }
  if (noRematch === undefined) {
    noRematch = chosen.pairs.some((p) => p.edge.previousMeetings > 0) ? solve(true) : chosen;
  }

  const plan = buildPlan(chosen, {
    roundNumber: input.roundNumber,
    kind: 'swiss',
    mode,
    seed: input.seed,
    byId,
    prior,
    weights,
    quotientWeight: ctx.quotientWeight,
  });

  if (plan.diagnostics.repeats > 0) {
    if (noRematch) {
      const alt = toAlternative('Beste Runde ohne Wiederholung', noRematch, byId, prior, weights);
      alternatives.push(alt);
      explanations.push(
        `Wiederholung bewusst gewählt: Ohne Wiederholung läge die größte Quotenlücke bei ${formatNumber(alt.maxQuotientGap)} ` +
          `statt ${formatNumber(plan.diagnostics.maxQuotientGap)}; die Runde wäre insgesamt um ` +
          `${formatNumber(alt.objectiveCost - plan.diagnostics.objectiveCost, 1)} Kostenpunkte unausgeglichener.`,
      );
    } else {
      explanations.push('Eine Runde ganz ohne Wiederholung ist mit den aktiven Teams nicht möglich.');
    }
  }
  for (const r of plan.diagnostics.rematches) {
    const which = r.previousMeetings + 1;
    const text = `${teamLabel(names, r.teamAId)} – ${teamLabel(names, r.teamBId)} treffen zum ${which}. Mal aufeinander.`;
    (which >= 3 ? warnings : explanations).push(text);
  }
  for (const p of plan.pairings) {
    if (p.quotientGap >= LARGE_GAP_WARNING) {
      const a = byId.get(p.teamAId)!;
      const b = byId.get(p.teamBId)!;
      warnings.push(
        `Große Quotenlücke: ${teamLabel(names, a.id)} (${formatNumber(quotientForPairing(a, prior))}) gegen ` +
          `${teamLabel(names, b.id)} (${formatNumber(quotientForPairing(b, prior))}).`,
      );
    }
  }
  if (plan.byeTeamId) {
    const bye = byId.get(plan.byeTeamId)!;
    if (bye.byes > 0) {
      explanations.push(
        `${teamLabel(names, bye.id)} erhält das ${bye.byes + 1}. Freilos; alle aktiven Teams hatten bereits mindestens ${bye.byes}.`,
      );
    }
  }
  if (teams.some((t) => t.played === 0) && teams.some((t) => t.played > 0)) {
    explanations.push(
      `Teams ohne Spiel werden für die Paarung intern mit dem Durchschnittsquotienten ${formatNumber(prior)} eingestuft (nicht in der Tabelle).`,
    );
  }

  plan.status = status;
  plan.diagnostics = {
    ...plan.diagnostics,
    warnings: [...warnings, ...plan.diagnostics.warnings],
    explanations: [...explanations, ...plan.diagnostics.explanations],
    alternatives,
    noRematchFeasible: noRematch !== null,
  };
  return plan;
}

export function sortedUnique<T extends { id: string }>(teams: readonly T[]): T[] {
  const seen = new Set<string>();
  for (const t of teams) {
    if (seen.has(t.id)) throw new Error(`Team ${t.id} ist mehrfach angegeben.`);
    seen.add(t.id);
  }
  return teams.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

interface BuildContext {
  roundNumber: number;
  kind: PairingPlan['kind'];
  mode: PairingMode;
  seed: string;
  byId: ReadonlyMap<string, PairingTeam>;
  prior: number;
  weights: PairingWeights;
  quotientWeight: number;
}

/** Baut Plan und Basis-Diagnose aus einer Lösung; Paarungen nach Spielstärke sortiert. */
export function buildPlan(solution: RoundSolution, c: BuildContext): PairingPlan {
  const strength = (id: string) => {
    const t = c.byId.get(id);
    return t ? quotientForPairing(t, c.prior) : 0;
  };
  const pairings: Pairing[] = solution.pairs
    .map(({ a, b, edge }) => {
      const [teamAId, teamBId] = orient(c.seed, a, b);
      return {
        teamAId,
        teamBId,
        previousMeetings: edge.previousMeetings,
        quotientGap: edge.quotientGap,
        cost: edge.total,
      };
    })
    .sort((x, y) => {
      const sx = Math.max(strength(x.teamAId), strength(x.teamBId));
      const sy = Math.max(strength(y.teamAId), strength(y.teamBId));
      return sy - sx || (x.teamAId < y.teamAId ? -1 : 1);
    });
  const gaps = pairings.map((p) => p.quotientGap);
  const diagnostics: ExtendedPairingDiagnostics = {
    objectiveCost: solution.totalCost,
    repeats: pairings.filter((p) => p.previousMeetings > 0).length,
    tripleEncounters: pairings.filter((p) => p.previousMeetings >= 2).length,
    meanQuotientGap: gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : 0,
    maxQuotientGap: gaps.length ? Math.max(...gaps) : 0,
    warnings: [],
    rematches: pairings
      .filter((p) => p.previousMeetings > 0)
      .map((p) => ({ teamAId: p.teamAId, teamBId: p.teamBId, previousMeetings: p.previousMeetings })),
    byeCandidates: solution.byeCandidates,
    explanations: [],
    alternatives: [],
    noRematchFeasible: false,
    weights: c.weights,
    effectiveQuotientWeight: c.quotientWeight,
  };
  if (solution.byeTeamId) diagnostics.byeTeamId = solution.byeTeamId;
  const plan: PairingPlan = {
    roundNumber: c.roundNumber,
    kind: c.kind,
    mode: c.mode,
    seed: c.seed,
    pairings,
    status: 'ok',
    diagnostics,
  };
  if (solution.byeTeamId) plan.byeTeamId = solution.byeTeamId;
  return plan;
}

function toAlternative(
  label: string,
  solution: RoundSolution,
  byId: ReadonlyMap<string, PairingTeam>,
  prior: number,
  weights: PairingWeights,
): PairingAlternative {
  const plan = buildPlan(solution, {
    roundNumber: 0,
    kind: 'swiss',
    mode: 'balanced',
    seed: '',
    byId,
    prior,
    weights,
    quotientWeight: weights.quotient,
  });
  const alt: PairingAlternative = {
    label,
    objectiveCost: plan.diagnostics.objectiveCost,
    repeats: plan.diagnostics.repeats,
    maxQuotientGap: plan.diagnostics.maxQuotientGap,
    pairings: plan.pairings.map((p) => ({ teamAId: p.teamAId, teamBId: p.teamBId })),
  };
  if (plan.byeTeamId) alt.byeTeamId = plan.byeTeamId;
  return alt;
}
