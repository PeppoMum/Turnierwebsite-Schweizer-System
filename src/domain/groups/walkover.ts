// Kampflos gewertetes Gruppenspiel (Team kommt zu spät oder gar nicht, bleibt aber im Turnier;
// Entscheidung Phil, 29.10.2026). Anders als beim Rückzug zählt das Spiel: wie ein 2:0-Sieg für
// den Gegner, in Tabelle und Tordifferenz. Gespeichert als beendetes Spiel mit Toren und
// `decidedBy: 'walkover'` / `walkoverWinner`; die Tabelle braucht dafür nichts Besonderes.
// Endrunden-Spiele werden weiter über src/domain/knockout/result.ts kampflos entschieden (ohne Tore).
import type { StageMatchFields } from '../format/types';
import type { MatchStatus } from '../types';

/** Tore des Siegers bei einem kampflos gewerteten Gruppenspiel. */
export const WALKOVER_GOALS = 2;

export interface ScoredWalkover {
  goalsA: number;
  goalsB: number;
  decidedBy: 'walkover';
  walkoverWinner: 'A' | 'B';
}

/** Ergebnis, wenn `winner` kampflos gewinnt: 2:0 bzw. 0:2. */
export function scoredWalkover(winner: 'A' | 'B'): ScoredWalkover {
  return {
    goalsA: winner === 'A' ? WALKOVER_GOALS : 0,
    goalsB: winner === 'B' ? WALKOVER_GOALS : 0,
    decidedBy: 'walkover',
    walkoverWinner: winner,
  };
}

/** Beendetes, kampflos gewertetes Spiel mit Ergebnis (zählt in der Tabelle). */
export function isScoredWalkover(m: { status: MatchStatus; goalsA?: number; goalsB?: number } & Partial<Pick<StageMatchFields, 'decidedBy'>>): boolean {
  return m.status === 'completed' && m.decidedBy === 'walkover' && m.goalsA !== undefined && m.goalsB !== undefined;
}
