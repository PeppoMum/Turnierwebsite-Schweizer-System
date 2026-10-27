// Bequemer Einstieg für Oberfläche und Services: nächste Runde aus dem Turnierstand.
// Die Signatur lehnt sich an den Stellvertreter `previewNextRound` der Oberfläche an.
import type { Bye, Match, PairingDiagnostics, Round, Team, Tournament } from '../types';
import { deriveSeed } from './random';
import { previewDrawRounds } from './draw';
import { collectMeetings } from './meetings';
import { pairSwissRound } from './swiss';
import type { PairingPlan, PairingTeam, PairingWeights } from './types';

/** Minimaler Tabellenauszug je Team, z. B. `TeamStanding` aus src/domain/scoring. */
export interface StandingForPairing {
  teamId: string;
  points: number;
  played: number;
}

export interface NextRoundInput {
  tournament: Pick<Tournament, 'id' | 'preDrawRounds' | 'pairingMode'>;
  teams: readonly Pick<Team, 'id' | 'name' | 'status'>[];
  matches: readonly Match[];
  byes: readonly Pick<Bye, 'teamId' | 'roundId'>[];
  rounds: readonly Pick<Round, 'id' | 'number'>[];
  /**
   * Eingefrorener Tabellenstand aus der Wertung (Spiele gegen zurückgezogene Teams sind dort
   * schon gelöscht). Für Losrunden nicht nötig.
   */
  standings?: readonly StandingForPairing[];
  weights?: Partial<PairingWeights>;
}

/** Form, die die Oberfläche anzeigt. */
export interface PairingPreview {
  roundNumber: number;
  mode: 'draw' | 'swiss';
  pairs: Array<{ teamAId: string; teamBId: string; repeat: number }>;
  byeTeamId?: string;
  diagnostics: PairingDiagnostics;
  /** Vollständiger Plan inkl. erweiterter Diagnose. */
  plan: PairingPlan;
}

export function toPairingPreview(plan: PairingPlan): PairingPreview {
  const preview: PairingPreview = {
    roundNumber: plan.roundNumber,
    mode: plan.kind,
    pairs: plan.pairings.map((p) => ({ teamAId: p.teamAId, teamBId: p.teamBId, repeat: p.previousMeetings })),
    diagnostics: plan.diagnostics,
    plan,
  };
  if (plan.byeTeamId) preview.byeTeamId = plan.byeTeamId;
  return preview;
}

/**
 * Berechnet die Vorschau der nächsten Runde. Losrunden werden mit allen noch offenen
 * Losrunden gemeinsam ausgelost (zurückgegeben wird die erste davon), Schweizer Runden
 * als globales Matching auf dem übergebenen Tabellenstand.
 * Nur Teams mit Status `active` werden gepaart; Begegnungen mit anderen Teams zählen nicht.
 */
export function previewNextRound(input: NextRoundInput, seed: string | number): PairingPreview {
  const roundNumber = Math.max(0, ...input.rounds.map((r) => r.number)) + 1;
  const baseSeed = deriveSeed(String(seed), input.tournament.id);
  const active = input.teams.filter((t) => t.status === 'active');
  const activeIds = new Set(active.map((t) => t.id));
  const excluded = input.teams.filter((t) => t.status !== 'active').map((t) => t.id);
  const meetings = collectMeetings(input.matches, { excludedTeamIds: excluded, excludeRoundNumbers: [roundNumber] });

  const roundNumberById = new Map(input.rounds.map((r) => [r.id, r.number]));
  const byeCount = new Map<string, number>();
  const lastBye = new Map<string, number>();
  for (const b of input.byes) {
    if (!activeIds.has(b.teamId)) continue;
    byeCount.set(b.teamId, (byeCount.get(b.teamId) ?? 0) + 1);
    const n = roundNumberById.get(b.roundId);
    if (n !== undefined) lastBye.set(b.teamId, Math.max(lastBye.get(b.teamId) ?? 0, n));
  }

  if (roundNumber <= input.tournament.preDrawRounds) {
    const { plans } = previewDrawRounds({
      teams: active.map((t) => ({ id: t.id, name: t.name, byes: byeCount.get(t.id) ?? 0 })),
      count: input.tournament.preDrawRounds - roundNumber + 1,
      firstRoundNumber: roundNumber,
      seed: baseSeed,
      meetings,
      mode: input.tournament.pairingMode,
    });
    return toPairingPreview(plans[0]!);
  }

  const standing = new Map((input.standings ?? []).map((s) => [s.teamId, s]));
  const teams: PairingTeam[] = active.map((t) => {
    const s = standing.get(t.id);
    const team: PairingTeam = {
      id: t.id,
      name: t.name,
      points: s?.points ?? 0,
      played: s?.played ?? 0,
      byes: byeCount.get(t.id) ?? 0,
    };
    const last = lastBye.get(t.id);
    if (last !== undefined) team.lastByeRound = last;
    return team;
  });
  const swissInput: Parameters<typeof pairSwissRound>[0] = {
    roundNumber,
    teams,
    meetings,
    mode: input.tournament.pairingMode,
    seed: deriveSeed(baseSeed, 'swiss', roundNumber),
  };
  if (input.weights) swissInput.weights = input.weights;
  return toPairingPreview(pairSwissRound(swissInput));
}
