// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { decideKnockoutMatch, formatKnockoutResult, walkoverFields } from './result';

describe('decideKnockoutMatch', () => {
  it('Sieger nach Toren', () => {
    expect(decideKnockoutMatch({ status: 'completed', goalsA: 2, goalsB: 1 })).toEqual({ state: 'decided', winner: 'A', decidedBy: 'regular' });
    expect(decideKnockoutMatch({ status: 'completed', goalsA: 2, goalsB: 3, decidedBy: 'extra_time' })).toEqual({
      state: 'decided',
      winner: 'B',
      decidedBy: 'extra_time',
    });
  });

  it('Unentschieden braucht Neunmeter mit Sieger', () => {
    expect(decideKnockoutMatch({ status: 'completed', goalsA: 1, goalsB: 1 })).toEqual({ state: 'incomplete', issue: 'penalties_missing' });
    expect(decideKnockoutMatch({ status: 'completed', goalsA: 1, goalsB: 1, penaltiesA: 3, penaltiesB: 3 })).toEqual({
      state: 'incomplete',
      issue: 'penalties_tied',
    });
    expect(decideKnockoutMatch({ status: 'completed', goalsA: 1, goalsB: 1, penaltiesA: 4, penaltiesB: 5 })).toEqual({
      state: 'decided',
      winner: 'B',
      decidedBy: 'penalties',
    });
  });

  it('reines Neunmeterschießen', () => {
    expect(decideKnockoutMatch({ status: 'completed', penaltyOnly: true, penaltiesA: 5, penaltiesB: 4 })).toEqual({
      state: 'decided',
      winner: 'A',
      decidedBy: 'penalties',
    });
    expect(decideKnockoutMatch({ status: 'completed', penaltyOnly: true })).toEqual({ state: 'incomplete', issue: 'penalties_missing' });
  });

  it('kampflos', () => {
    expect(decideKnockoutMatch({ status: 'not_played', ...walkoverFields('B') })).toEqual({ state: 'decided', winner: 'B', decidedBy: 'walkover' });
    expect(decideKnockoutMatch({ status: 'completed', decidedBy: 'walkover' })).toEqual({ state: 'incomplete', issue: 'walkover_side_missing' });
  });

  it('nicht beendete Spiele haben keinen Sieger', () => {
    for (const status of ['draft', 'scheduled', 'live'] as const) {
      expect(decideKnockoutMatch({ status, goalsA: 3, goalsB: 0 })).toEqual({ state: 'pending' });
    }
    expect(decideKnockoutMatch({ status: 'completed' })).toEqual({ state: 'incomplete', issue: 'goals_missing' });
  });
});

describe('formatKnockoutResult', () => {
  it('zeigt n. V. und n. N.', () => {
    expect(formatKnockoutResult({ status: 'completed', goalsA: 2, goalsB: 0 })).toBe('2:0');
    expect(formatKnockoutResult({ status: 'completed', goalsA: 2, goalsB: 1, decidedBy: 'extra_time' })).toBe('2:1 n. V.');
    expect(formatKnockoutResult({ status: 'completed', goalsA: 1, goalsB: 1, penaltiesA: 4, penaltiesB: 3 })).toBe('1:1, 4:3 n. N.');
    expect(formatKnockoutResult({ status: 'completed', penaltyOnly: true, penaltiesA: 4, penaltiesB: 3 })).toBe('4:3 n. N.');
    expect(formatKnockoutResult({ status: 'not_played', ...walkoverFields('A') })).toBe('kampflos');
    expect(formatKnockoutResult({ status: 'live', goalsA: 1, goalsB: 0 })).toBe('');
  });
});
