// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { previewNextRound, type NextRoundInput } from './preview';
import type { Match, Team } from '../types';

const team = (id: string, status: Team['status'] = 'active') => ({ id, name: `Team ${id}`, status });
const match = (id: string, roundNumber: number, a: string, b: string, goalsA: number, goalsB: number): Match => ({
  id,
  roundId: `r${roundNumber}`,
  roundNumber,
  teamAId: a,
  teamBId: b,
  durationMinutes: 12,
  status: 'completed',
  goalsA,
  goalsB,
  revision: 1,
  createdAt: '',
  updatedAt: '',
});

describe('previewNextRound', () => {
  const base: NextRoundInput = {
    tournament: { id: 't1', preDrawRounds: 2, pairingMode: 'balanced' },
    teams: ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => team(id)),
    matches: [],
    byes: [],
    rounds: [],
  };

  it('Losrunde 1 und 2: gemeinsam ausgelost, keine Wiederholung, reproduzierbar', () => {
    const r1 = previewNextRound(base, 42);
    expect(r1.roundNumber).toBe(1);
    expect(r1.mode).toBe('draw');
    expect(r1.pairs).toHaveLength(3);
    expect(previewNextRound(base, 42)).toEqual(r1);
    const played = r1.pairs.map((p, i) => match(`m${i}`, 1, p.teamAId, p.teamBId, 1, 0));
    const r2 = previewNextRound({ ...base, matches: played, rounds: [{ id: 'r1', number: 1 }] }, 42);
    expect(r2.mode).toBe('draw');
    expect(r2.pairs.every((p) => p.repeat === 0)).toBe(true);
  });

  it('Schweizer Runde: nutzt den Tabellenstand und lässt zurückgezogene Teams weg', () => {
    const matches = [match('1', 1, 'A', 'B', 2, 0), match('2', 1, 'C', 'W', 0, 3), match('3', 1, 'D', 'E', 1, 1)];
    const preview = previewNextRound(
      {
        ...base,
        tournament: { ...base.tournament, preDrawRounds: 1 },
        teams: [...['A', 'B', 'C', 'D', 'E'].map((id) => team(id)), team('W', 'withdrawn')],
        matches,
        byes: [],
        rounds: [{ id: 'r1', number: 1 }],
        standings: [
          { teamId: 'A', points: 3, played: 1 },
          { teamId: 'B', points: 0, played: 1 },
          { teamId: 'C', points: 0, played: 0 }, // Spiel gegen W gelöscht
          { teamId: 'D', points: 1, played: 1 },
          { teamId: 'E', points: 1, played: 1 },
        ],
      },
      'seed',
    );
    expect(preview.mode).toBe('swiss');
    expect(preview.roundNumber).toBe(2);
    const ids = preview.pairs.flatMap((p) => [p.teamAId, p.teamBId]);
    expect(ids).not.toContain('W');
    expect(ids.length + (preview.byeTeamId ? 1 : 0)).toBe(5);
    // C hat (nach gelöschtem Spiel) 0 Spiele und soll nicht auch noch das Freilos bekommen
    expect(preview.byeTeamId).not.toBe('C');
    expect(preview.diagnostics.repeats).toBe(0);
  });
});
