import type { MatchStatus, ScheduleConfig } from '../types';

export interface ScheduleField {
  id: string;
  name: string;
  order: number;
  active: boolean;
}

export interface PairedMatch {
  id: string;
  teamAId: string;
  teamBId: string;
}

/** Eine fertig gepaarte Runde; die Feldplanung ändert die Paarungen nie (§8.2). */
export interface RoundToSchedule {
  roundNumber: number;
  matches: readonly PairedMatch[];
  /** Vom Admin fest gesetzter Rundenstart (ISO); sonst direkt nach der Vorrunde. */
  startISO?: string;
}

export interface ScheduleConstraints extends Omit<ScheduleConfig, 'tournamentStartISO'> {
  /** Start der ersten zu planenden Runde, falls sie keinen eigenen Start hat. */
  tournamentStartISO: string;
  /**
   * Gewünschte Mindestpause zwischen zwei Spielen eines Teams (weiches Ziel).
   * Standard: eine Spiellänge, d. h. nicht direkt von der letzten Welle in die erste.
   */
  desiredRestMinutes?: number;
}

export interface ScheduledMatch {
  matchId: string;
  roundNumber: number;
  teamAId: string;
  teamBId: string;
  fieldId: string;
  fieldName: string;
  waveIndex: number;
  startISO: string;
  endISO: string;
}

export interface RestWarning {
  teamId: string;
  roundNumber: number;
  matchId: string;
  restMinutes: number;
  targetMinutes: number;
  /** true = harte Mindestpause unterschritten (nur wenn aktiviert). */
  hard: boolean;
  message: string;
}

export interface WavePlan {
  index: number;
  startISO: string;
  matchIds: string[];
}

export interface RoundSchedule {
  roundNumber: number;
  startISO: string;
  endISO: string;
  waves: WavePlan[];
  /** > 0, wenn der Rundenstart wegen einer harten Mindestpause verschoben wurde. */
  startShiftedByMinutes: number;
}

export interface SchedulePlan {
  matches: ScheduledMatch[];
  rounds: RoundSchedule[];
  restWarnings: RestWarning[];
  /** Hinweise, z. B. verschobene Rundenstarts oder ungenutzte Felder. */
  warnings: string[];
  /** Blockierende Planungsprobleme (Plan so nicht veröffentlichen). */
  problems: string[];
}

/** Ein Spiel mit Zeit und Feld, wie es für Prüfung und Verschiebung gebraucht wird. */
export interface TimedMatch {
  id: string;
  teamAId: string;
  teamBId: string;
  fieldId: string;
  startISO: string;
  durationMinutes: number;
  roundNumber?: number;
  status?: MatchStatus;
}
