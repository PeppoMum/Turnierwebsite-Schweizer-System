// @vitest-environment node
// Eigenschaftsbasierte Tests (§13): zufällige Turniere mit 3–40 Teams, 1–12 Runden,
// Ausfällen und Rückzügen. Dazu Gütevergleich gegen eine Greedy-Referenz.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { edgeCost, effectiveQuotientWeight, neutralPrior, quotientForPairing, resolveWeights } from './cost';
import { MeetingCounter } from './meetings';
import { pairSwissRound } from './swiss';
import { meetingsOf, simulateTournament, teamId, toPairingTeams } from './testing/simulate';
import type { PairingPlan, PairingTeam, PastMeeting } from './types';
import { validatePairingPlan } from './validate';
import type { PairingMode } from '../types';

/**
 * Greedy-Referenz, wie sie viele einfache Swiss-Generatoren nutzen: Tabelle von oben
 * abarbeiten, jedes Team bekommt den nächstplatzierten noch freien Gegner, gegen den
 * es noch nicht gespielt hat (sonst den nächsten freien).
 */
function greedyPlan(teams: readonly PairingTeam[], meetings: readonly PastMeeting[], byeTeamId?: string) {
  const counter = new MeetingCounter(meetings);
  const prior = neutralPrior(teams);
  const order = teams
    .filter((t) => t.id !== byeTeamId)
    .sort((a, b) => quotientForPairing(b, prior) - quotientForPairing(a, prior) || (a.id < b.id ? -1 : 1));
  const free = order.slice();
  const pairings: Array<{ teamAId: string; teamBId: string }> = [];
  while (free.length > 0) {
    const a = free.shift()!;
    let idx = free.findIndex((b) => counter.count(a.id, b.id) === 0);
    if (idx === -1) idx = 0;
    const [b] = free.splice(idx, 1);
    pairings.push({ teamAId: a.id, teamBId: b!.id });
  }
  return byeTeamId ? { pairings, byeTeamId } : { pairings };
}

function edgeSum(teams: readonly PairingTeam[], meetings: readonly PastMeeting[], plan: { pairings: ReadonlyArray<{ teamAId: string; teamBId: string }> }, seed: string, mode: PairingMode = 'balanced') {
  return validatePairingPlan({ teams, plan, meetings, seed, mode }).objectiveCost;
}

/** Exaktes Minimum über alle perfekten Matchings (nur kleine n). */
function bruteForce(teams: readonly PairingTeam[], meetings: readonly PastMeeting[], seed: string): number {
  const weights = resolveWeights('balanced');
  const ctx = {
    weights,
    quotientWeight: effectiveQuotientWeight(teams, weights),
    meetings: new MeetingCounter(meetings),
    prior: neutralPrior(teams),
    seed,
  };
  const go = (rest: readonly PairingTeam[]): number => {
    if (rest.length === 0) return 0;
    const [a, ...others] = rest;
    let best = Infinity;
    others.forEach((b, i) => {
      const remaining = others.filter((_, k) => k !== i);
      best = Math.min(best, edgeCost(a!, b, ctx).total + go(remaining));
    });
    return best;
  };
  return go(teams);
}

const scenario = fc.record({
  teams: fc.integer({ min: 3, max: 40 }),
  rounds: fc.integer({ min: 1, max: 12 }),
  preDrawRounds: fc.integer({ min: 0, max: 3 }),
  notPlayedRate: fc.constantFrom(0, 0, 0.05, 0.2),
  withdraw: fc.option(fc.record({ team: fc.nat(), afterRound: fc.integer({ min: 1, max: 11 }) }), { nil: undefined }),
  mode: fc.constantFrom<PairingMode>('balanced', 'balanced', 'strict_no_rematch', 'performance_first'),
  seed: fc.string({ minLength: 1, maxLength: 8 }),
});

describe('Eigenschaften zufälliger Turniere', () => {
  it('Invarianten: ein Spiel pro Team und Runde, faire Freilose, keine zurückgezogenen Teams, nie schlechter als Greedy', () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const options: Parameters<typeof simulateTournament>[0] = {
          teams: s.teams,
          rounds: s.rounds,
          preDrawRounds: s.preDrawRounds,
          notPlayedRate: s.notPlayedRate,
          mode: s.mode,
          seed: s.seed,
        };
        // Rückzug nach einer Runde, die schon gespielt wurde (Losrunden stehen vorab fest)
        if (s.withdraw && s.withdraw.afterRound >= s.preDrawRounds && s.withdraw.afterRound < s.rounds) {
          options.withdrawTeam = s.withdraw.team % s.teams;
          options.withdrawAfterRound = s.withdraw.afterRound;
        }
        const result = simulateTournament(options);
        const withdrawn = options.withdrawTeam !== undefined ? teamId(options.withdrawTeam) : undefined;
        const byes = new Map<string, number>();
        expect(result.plans).toHaveLength(s.rounds);

        for (const plan of result.plans) {
          const ids = plan.pairings.flatMap((p) => [p.teamAId, p.teamBId]);
          if (plan.byeTeamId) ids.push(plan.byeTeamId);
          // max. ein Spiel pro Team pro Runde
          expect(new Set(ids).size).toBe(ids.length);
          const afterWithdrawal = withdrawn !== undefined && plan.roundNumber > options.withdrawAfterRound!;
          const activeCount = afterWithdrawal ? s.teams - 1 : s.teams;
          expect(ids.length).toBe(activeCount);
          if (afterWithdrawal) expect(ids).not.toContain(withdrawn);
          // Freilos nur bei ungerader Zahl und nur an Teams mit minimaler Freiloszahl
          expect(plan.byeTeamId !== undefined).toBe(activeCount % 2 === 1);
          if (plan.byeTeamId) {
            const min = Math.min(...ids.map((id) => byes.get(id) ?? 0));
            expect(byes.get(plan.byeTeamId) ?? 0).toBe(min);
            byes.set(plan.byeTeamId, (byes.get(plan.byeTeamId) ?? 0) + 1);
          }
          // Diagnose konsistent
          expect(plan.diagnostics.repeats).toBe(plan.pairings.filter((p) => p.previousMeetings > 0).length);
          expect(plan.diagnostics.tripleEncounters).toBeLessThanOrEqual(plan.diagnostics.repeats);
          if (plan.mode === 'strict_no_rematch' && plan.kind === 'swiss' && plan.status === 'ok') {
            expect(plan.diagnostics.repeats).toBe(0);
          }
          // Keine Wiederholung aus Versehen: wenn es eine wiederholungsfreie Alternative gibt, ist sie teurer
          if (plan.kind === 'swiss' && plan.diagnostics.repeats > 0 && plan.diagnostics.noRematchFeasible) {
            expect(plan.diagnostics.alternatives[0]!.objectiveCost).toBeGreaterThanOrEqual(plan.diagnostics.objectiveCost - 1e-9);
          }
        }

        // Gütevergleich der letzten Schweizer Runde gegen Greedy (gleiches Freilos, gleiche Kostenfunktion)
        const last = result.plans.at(-1)!;
        // (ohne Rückzug, damit der Tabellenstand vor der Runde exakt nachgebaut werden kann)
        if (last.kind === 'swiss' && last.mode !== 'strict_no_rematch' && s.rounds > 1 && withdrawn === undefined) {
          const before = simulateTournament({ ...options, rounds: s.rounds - 1 });
          const teams = toPairingTeams(before.teams);
          const meetings = meetingsOf(before);
          const optimal = edgeSum(teams, meetings, last, last.seed, last.mode);
          const greedy = edgeSum(teams, meetings, greedyPlan(teams, meetings, last.byeTeamId), last.seed, last.mode);
          expect(optimal).toBeLessThanOrEqual(greedy + 1e-9);
        }
      }),
      { numRuns: 120, seed: 20261027 },
    );
  }, 180_000);

  it('Optimalität: kleine Runden stimmen exakt mit vollständiger Suche überein', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }).map((k) => 2 * k),
        fc.integer({ min: 1, max: 8 }),
        fc.string({ minLength: 1, maxLength: 6 }),
        (n, rounds, seed) => {
          const before = simulateTournament({ teams: n, rounds, preDrawRounds: 1, seed });
          const teams = toPairingTeams(before.teams);
          const meetings = meetingsOf(before);
          const plan = pairSwissRound({ roundNumber: rounds + 1, teams, meetings, seed });
          const cost = plan.pairings.reduce((sum, p) => sum + p.cost, 0);
          expect(cost).toBeCloseTo(bruteForce(teams, meetings, seed), 4);
        },
      ),
      { numRuns: 200, seed: 7 },
    );
  });
});

describe('Gütevergleich gegen Greedy', () => {
  it('Worst Case: Greedy erzwingt eine Wiederholung, das globale Matching nicht', () => {
    const teams: PairingTeam[] = [
      { id: 'A', points: 12, played: 6, byes: 0 },
      { id: 'B', points: 11, played: 6, byes: 0 },
      { id: 'C', points: 11, played: 6, byes: 0 },
      { id: 'D', points: 10, played: 6, byes: 0 },
    ];
    const meetings = [{ teamAId: 'C', teamBId: 'D' }];
    const greedy = greedyPlan(teams, meetings);
    expect(validatePairingPlan({ teams, plan: greedy, meetings }).repeats).toBe(1);
    const plan = pairSwissRound({ roundNumber: 7, teams, meetings, seed: 's' });
    expect(plan.diagnostics.repeats).toBe(0);
  });

  it('Worst Case: Greedy lässt am Ende Erster-gegen-Letzter-artige Lücken entstehen', () => {
    // Greedy paart oben „bequem“ und schiebt die Restteams mit großer Lücke zusammen.
    const teams: PairingTeam[] = ['A', 'B', 'C', 'D', 'E', 'F'].map((id, i) => ({ id, points: 18 - 3 * i, played: 6, byes: 0 }));
    const meetings = [
      { teamAId: 'A', teamBId: 'B' },
      { teamAId: 'C', teamBId: 'D' },
      { teamAId: 'E', teamBId: 'F' },
      { teamAId: 'B', teamBId: 'D' },
      { teamAId: 'D', teamBId: 'E' },
    ];
    const greedy = greedyPlan(teams, meetings);
    const greedyReport = validatePairingPlan({ teams, plan: greedy, meetings });
    const plan = pairSwissRound({ roundNumber: 7, teams, meetings, seed: 's' });
    const optimal = validatePairingPlan({ teams, plan, meetings, seed: 's' });
    expect(optimal.objectiveCost).toBeLessThan(greedyReport.objectiveCost);
  });

  it('über viele simulierte Turniere ist das globale Matching im Mittel deutlich besser', () => {
    let optimalTotal = 0;
    let greedyTotal = 0;
    let strictlyBetter = 0;
    let rounds = 0;
    for (let s = 0; s < 60; s++) {
      const n = 10 + (s % 8) * 2;
      const before = simulateTournament({ teams: n, rounds: 6, preDrawRounds: 2, seed: `cmp-${s}` });
      const teams = toPairingTeams(before.teams);
      const meetings = meetingsOf(before);
      const plan: PairingPlan = pairSwissRound({ roundNumber: 7, teams, meetings, seed: `cmp-${s}` });
      const o = edgeSum(teams, meetings, plan, plan.seed);
      const g = edgeSum(teams, meetings, greedyPlan(teams, meetings), plan.seed);
      expect(o).toBeLessThanOrEqual(g + 1e-9);
      optimalTotal += o;
      greedyTotal += g;
      if (o < g - 1e-6) strictlyBetter++;
      rounds++;
    }
    expect(optimalTotal).toBeLessThan(greedyTotal);
    expect(strictlyBetter / rounds).toBeGreaterThan(0.2);
  });
});
