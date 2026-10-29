// Ergebnis eines K.-o.- oder Platzierungsspiels: Wer kommt weiter?
//
// `goalsA/B` sind der Stand nach regulärer Spielzeit bzw. nach Verlängerung. Steht es danach
// unentschieden, entscheidet das Neunmeterschießen (`penaltiesA/B`). Reine Neunmeterspiele haben keine
// Tore, nur Neunmeter. Kampflos: `decidedBy: 'walkover'` mit `walkoverWinner`.

import type { StageMatchFields } from '../format/types';
import type { MatchStatus } from '../types';

export type Side = 'A' | 'B';

export type KnockoutResultInput = Pick<StageMatchFields, 'decidedBy' | 'penaltiesA' | 'penaltiesB' | 'penaltyOnly' | 'walkoverWinner'> & {
  status: MatchStatus;
  goalsA?: number;
  goalsB?: number;
};

export type KnockoutIssue = 'goals_missing' | 'penalties_missing' | 'penalties_tied' | 'walkover_side_missing';

export type KnockoutOutcome =
  | { state: 'pending' }
  | { state: 'decided'; winner: Side; decidedBy: NonNullable<StageMatchFields['decidedBy']> }
  /** Eingetragen, aber so noch nicht entschieden (z. B. Unentschieden ohne Neunmeter). */
  | { state: 'incomplete'; issue: KnockoutIssue };

export const KNOCKOUT_ISSUE_TEXT: Record<KnockoutIssue, string> = {
  goals_missing: 'Es fehlen die Tore.',
  penalties_missing: 'Unentschieden: Bitte das Ergebnis vom Neunmeterschießen eintragen.',
  penalties_tied: 'Beim Neunmeterschießen muss es einen Sieger geben.',
  walkover_side_missing: 'Bitte angeben, welches Team kampflos weiterkommt.',
};

function isGoal(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function penaltyWinner(m: KnockoutResultInput): KnockoutOutcome {
  if (!isGoal(m.penaltiesA) || !isGoal(m.penaltiesB)) return { state: 'incomplete', issue: 'penalties_missing' };
  if (m.penaltiesA === m.penaltiesB) return { state: 'incomplete', issue: 'penalties_tied' };
  return { state: 'decided', winner: m.penaltiesA > m.penaltiesB ? 'A' : 'B', decidedBy: 'penalties' };
}

/** Wer ein K.-o.-Spiel gewonnen hat. Nur beendete oder kampflos gewertete Spiele haben einen Sieger. */
export function decideKnockoutMatch(m: KnockoutResultInput): KnockoutOutcome {
  if (m.decidedBy === 'walkover') {
    if (m.status !== 'completed' && m.status !== 'not_played') return { state: 'pending' };
    if (m.walkoverWinner) return { state: 'decided', winner: m.walkoverWinner, decidedBy: 'walkover' };
    return { state: 'incomplete', issue: 'walkover_side_missing' };
  }
  if (m.status !== 'completed') return { state: 'pending' };
  if (m.penaltyOnly) return penaltyWinner(m);
  if (!isGoal(m.goalsA) || !isGoal(m.goalsB)) return { state: 'incomplete', issue: 'goals_missing' };
  if (m.goalsA !== m.goalsB) {
    return { state: 'decided', winner: m.goalsA > m.goalsB ? 'A' : 'B', decidedBy: m.decidedBy === 'extra_time' ? 'extra_time' : 'regular' };
  }
  return penaltyWinner(m);
}

/** Anzeige wie „2:1“, „2:1 n. V.“, „1:1, 4:3 n. N.“, „4:3 n. N.“ (reines Neunmeterschießen), „kampflos“. */
export function formatKnockoutResult(m: KnockoutResultInput): string {
  const outcome = decideKnockoutMatch(m);
  if (outcome.state !== 'decided') return '';
  switch (outcome.decidedBy) {
    case 'walkover':
      return 'kampflos';
    case 'regular':
      return `${m.goalsA}:${m.goalsB}`;
    case 'extra_time':
      return `${m.goalsA}:${m.goalsB} n. V.`;
    case 'penalties': {
      const shootout = `${m.penaltiesA}:${m.penaltiesB} n. N.`;
      return m.penaltyOnly ? shootout : `${m.goalsA}:${m.goalsB}, ${shootout}`;
    }
  }
}

/** Felder, mit denen ein Spiel kampflos für `winner` gewertet wird (Gegner hat zurückgezogen). */
export function walkoverFields(winner: Side): Required<Pick<StageMatchFields, 'decidedBy' | 'walkoverWinner'>> {
  return { decidedBy: 'walkover', walkoverWinner: winner };
}
