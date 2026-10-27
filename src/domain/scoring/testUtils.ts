// Kleine Helfer, um Testturniere knapp zu beschreiben.
import type { MatchStatus, TeamStatus } from '../types';
import type { StandingsMatch, StandingsTeam } from './standings';

export function team(id: string, status: TeamStatus = 'active', name = id): StandingsTeam {
  return { id, name, status };
}

export function teams(...ids: string[]): StandingsTeam[] {
  return ids.map((id) => team(id));
}

/** `result('A', 2, 1, 'B')` = A gegen B endet 2:1. */
export function result(a: string, goalsA: number, goalsB: number, b: string, roundNumber = 1): StandingsMatch {
  return { teamAId: a, teamBId: b, goalsA, goalsB, status: 'completed', roundNumber };
}

export function open(a: string, b: string, status: MatchStatus, roundNumber = 1): StandingsMatch {
  return { teamAId: a, teamBId: b, status, roundNumber };
}
