import type { PairingMode } from '../types';
import { MODE_WEIGHTS, pairJitter } from './cost';
import { teamLabel } from './format';
import { MeetingCounter } from './meetings';
import { createRng, deriveSeed, hashString, shuffled } from './random';
import { solveRound, type RoundSolution } from './solve';
import { buildPlan, sortedUnique } from './swiss';
import type { PairingPlan, PairingTeam, PastMeeting } from './types';

export interface DrawTeam {
  id: string;
  name?: string;
  /** Bisherige Freilose (bei Neuauslosung nach bereits veröffentlichten Runden). */
  byes?: number;
}

export interface DrawRoundsInput {
  teams: readonly DrawTeam[];
  /** Anzahl vorab auszulosender Runden. */
  count: number;
  /** Nummer der ersten ausgelosten Runde (Standard 1). */
  firstRoundNumber?: number;
  seed: string;
  /** Bereits feststehende Begegnungen, z. B. schon veröffentlichte Losrunden. */
  meetings?: readonly PastMeeting[];
  /** Turniermodus, nur zur Dokumentation im Plan. */
  mode?: PairingMode;
  /** Anzahl Neustarts der Suche, wenn feste Begegnungen berücksichtigt werden müssen. */
  attempts?: number;
}

export interface DrawRoundsResult {
  plans: PairingPlan[];
  warnings: string[];
}

/** Höchstzahl an Runden ohne jede Wiederholung bei n Teams (1-Faktorisierung). */
export function maxRoundsWithoutRepeat(teamCount: number): number {
  if (teamCount < 2) return 0;
  return teamCount % 2 === 0 ? teamCount - 1 : teamCount;
}

/**
 * Frühe Plausibilitätsprüfung der Rundenkonfiguration (§7.1 letzter Punkt).
 * Liefert deutsche Hinweise; leere Liste = unproblematisch.
 */
export function checkRoundConfiguration(teamCount: number, roundsTotal: number, preDrawRounds: number): string[] {
  const out: string[] = [];
  const maxClean = maxRoundsWithoutRepeat(teamCount);
  if (preDrawRounds > roundsTotal) {
    out.push(`Es sind mehr Losrunden (${preDrawRounds}) als Runden insgesamt (${roundsTotal}) eingestellt.`);
  }
  if (preDrawRounds > maxClean) {
    out.push(
      `Mit ${teamCount} Teams lassen sich höchstens ${maxClean} Runden ganz ohne Wiederholung auslosen; ` +
        `bei ${preDrawRounds} Losrunden kommt es zwangsläufig zu Wiederholungen. ` +
        `Kompromiss: weniger Losrunden oder mehr Teams.`,
    );
  } else if (roundsTotal > maxClean) {
    out.push(
      `Mit ${teamCount} Teams sind ${roundsTotal} Runden mehr als ein vollständiges Jeder-gegen-jeden (${maxClean}); ` +
        `Wiederholungen sind im Turnierverlauf unvermeidbar.`,
    );
  }
  if (roundsTotal > 0 && preDrawRounds === roundsTotal) {
    out.push('Alle Runden werden ausgelost; es gibt keine leistungsbasierte Schweizer Runde.');
  }
  return out;
}

const DRAW_REMATCH = 1000;
const DRAW_TRIPLE = 3000;

/**
 * Lost `count` Anfangsrunden gemeinsam aus (§7.1).
 *
 * Ohne feste Vorgaben wird eine zufällig permutierte 1-Faktorisierung (Kreisverfahren)
 * verwendet: Sie garantiert die theoretisch maximale Zahl wiederholungsfreier Runden
 * und bei ungerader Teamzahl lauter verschiedene Freilos-Teams. Mit festen Vorgaben
 * (bereits veröffentlichte Runden, ungleich verteilte Freilose) wird jede Runde als
 * globales Matching mit seeded Zufallskosten gelöst und die beste von mehreren
 * Gesamtauslosungen gewählt.
 */
export function previewDrawRounds(input: DrawRoundsInput): DrawRoundsResult {
  const teams = sortedUnique(input.teams);
  const first = input.firstRoundNumber ?? 1;
  const mode = input.mode ?? 'balanced';
  const ids = new Set(teams.map((t) => t.id));
  const fixed = (input.meetings ?? []).filter((m) => ids.has(m.teamAId) && ids.has(m.teamBId));
  const byes = new Map(teams.map((t) => [t.id, t.byes ?? 0]));
  const warnings: string[] = [];

  if (input.count <= 0 || teams.length < 2) return { plans: [], warnings };
  if (input.count > maxRoundsWithoutRepeat(teams.length)) {
    warnings.push(
      `Mit ${teams.length} Teams sind höchstens ${maxRoundsWithoutRepeat(teams.length)} Losrunden ohne Wiederholung möglich; ` +
        `es wurden ${input.count} angefordert. Wiederholungen werden so gleichmäßig wie möglich verteilt.`,
    );
  }

  const byeValues = [...byes.values()];
  const unconstrained = fixed.length === 0 && byeValues.every((b) => b === byeValues[0]);
  const rounds = unconstrained
    ? circleRounds(teams, input.count, input.seed)
    : bestSequentialDraw(teams, input.count, input.seed, fixed, byes, input.attempts ?? 16);

  const names = new Map(teams.map((t) => [t.id, t.name ?? t.id]));
  const counter = new MeetingCounter(fixed);
  const runningByes = new Map(byes);
  const plans = rounds.map((round, k) => {
    const roundNumber = first + k;
    const solution: RoundSolution = {
      pairs: round.pairs.map(([a, b]) => ({
        a,
        b,
        edge: { total: 0, quotientGap: 0, previousMeetings: counter.count(a, b) },
      })),
      totalCost: 0,
      byeCandidates: [],
    };
    if (round.bye) solution.byeTeamId = round.bye;
    const byId = new Map<string, PairingTeam>(
      teams.map((t) => [t.id, { id: t.id, points: 0, played: 0, byes: runningByes.get(t.id) ?? 0 }]),
    );
    const plan = buildPlan(solution, {
      roundNumber,
      kind: 'draw',
      mode,
      seed: deriveSeed(input.seed, 'draw', roundNumber),
      byId,
      prior: 0,
      weights: MODE_WEIGHTS[mode],
      quotientWeight: 0,
    });
    plan.diagnostics.objectiveCost = plan.diagnostics.repeats * DRAW_REMATCH;
    plan.diagnostics.noRematchFeasible = plan.diagnostics.repeats === 0;
    for (const r of plan.diagnostics.rematches) {
      plan.diagnostics.warnings.push(
        `${teamLabel(names, r.teamAId)} – ${teamLabel(names, r.teamBId)} treffen zum ${r.previousMeetings + 1}. Mal aufeinander.`,
      );
    }
    for (const [a, b] of round.pairs) counter.add(a, b);
    if (round.bye) runningByes.set(round.bye, (runningByes.get(round.bye) ?? 0) + 1);
    return plan;
  });
  return { plans, warnings };
}

interface DrawRound {
  pairs: Array<[string, string]>;
  bye?: string;
}

const DUMMY = '\u0000freilos';

/** Kreisverfahren (Berger-Tabelle) auf zufällig permutierter Teamliste. */
function circleRounds(teams: readonly DrawTeam[], count: number, seed: string): DrawRound[] {
  const rng = createRng(deriveSeed(seed, 'circle'));
  const ids = shuffled(
    teams.map((t) => t.id),
    rng,
  );
  if (ids.length % 2 === 1) ids.push(DUMMY);
  const m = ids.length;
  const fixedId = ids[0]!;
  const rotating = ids.slice(1);
  // Reihenfolge der Faktoren ebenfalls zufällig, damit Runde 1 nicht immer gleich aussieht.
  const factorOrder = shuffled(
    Array.from({ length: m - 1 }, (_, i) => i),
    rng,
  );
  const out: DrawRound[] = [];
  for (let k = 0; k < count; k++) {
    const r = factorOrder[k % (m - 1)]!;
    const arr = [fixedId, ...rotating.slice(r), ...rotating.slice(0, r)];
    const round: DrawRound = { pairs: [] };
    for (let i = 0; i < m / 2; i++) {
      const a = arr[i]!;
      const b = arr[m - 1 - i]!;
      if (a === DUMMY) round.bye = b;
      else if (b === DUMMY) round.bye = a;
      else round.pairs.push([a, b]);
    }
    out.push(round);
  }
  return out;
}

interface DrawScore {
  repeats: number;
  triples: number;
  noise: number;
}

function better(a: DrawScore, b: DrawScore): boolean {
  if (a.triples !== b.triples) return a.triples < b.triples;
  if (a.repeats !== b.repeats) return a.repeats < b.repeats;
  return a.noise < b.noise;
}

function bestSequentialDraw(
  teams: readonly DrawTeam[],
  count: number,
  seed: string,
  fixed: readonly PastMeeting[],
  initialByes: ReadonlyMap<string, number>,
  attempts: number,
): DrawRound[] {
  let best: { rounds: DrawRound[]; score: DrawScore } | null = null;
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt++) {
    const attemptSeed = deriveSeed(seed, 'draw-attempt', attempt);
    const counter = new MeetingCounter(fixed);
    const byes = new Map(initialByes);
    const rounds: DrawRound[] = [];
    const score: DrawScore = { repeats: 0, triples: 0, noise: 0 };
    for (let k = 0; k < count; k++) {
      const roundSeed = deriveSeed(attemptSeed, k);
      const refs = teams.map((t) => ({ id: t.id, byes: byes.get(t.id) ?? 0 }));
      const solution = solveRound(refs, {
        edge: (a, b) => {
          const c = counter.count(a.id, b.id);
          return {
            total: DRAW_REMATCH * c * c + (c >= 2 ? DRAW_TRIPLE : 0) + pairJitter(roundSeed, a.id, b.id),
            quotientGap: 0,
            previousMeetings: c,
          };
        },
        // Fairness ist schon durch die Kandidatenwahl (minimale Freiloszahl) gesichert.
        byeCost: (t) => hashString(`${roundSeed}\u0000bye\u0000${t.id}`) / 4294967296,
      });
      if (!solution) throw new Error('Auslosung nicht möglich.');
      const round: DrawRound = { pairs: solution.pairs.map((p) => [p.a, p.b]) };
      for (const p of solution.pairs) {
        if (p.edge.previousMeetings > 0) score.repeats++;
        if (p.edge.previousMeetings > 1) score.triples++;
        counter.add(p.a, p.b);
      }
      if (solution.byeTeamId) {
        round.bye = solution.byeTeamId;
        byes.set(round.bye, (byes.get(round.bye) ?? 0) + 1);
      }
      score.noise += solution.totalCost;
      rounds.push(round);
    }
    if (!best || better(score, best.score)) best = { rounds, score };
  }
  return best!.rounds;
}
