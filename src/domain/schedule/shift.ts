import { addMinutes } from './time';
import type { TimedMatch } from './types';
import { validateSchedule, type ScheduleValidation, type ValidateScheduleOptions } from './validate';

export interface ShiftChange {
  matchId: string;
  oldStartISO: string;
  newStartISO: string;
}

export interface ShiftPreview {
  changes: ShiftChange[];
  /** Spiele, die bleiben, weil sie schon laufen oder vorbei sind. */
  unchangedMatchIds: string[];
  /** Neuer Gesamtstand zur Übernahme nach Bestätigung. */
  matches: TimedMatch[];
  validation: ScheduleValidation;
}

/** Nur noch nicht begonnene Spiele dürfen verschoben werden. */
const SHIFTABLE = new Set(['draft', 'scheduled']);

export interface ShiftOptions extends ValidateScheduleOptions {
  /** Nur Spiele ab dieser Rundennummer verschieben (z. B. ab der nächsten Runde). */
  fromRoundNumber?: number;
}

/**
 * Vorschau „alle noch nicht begonnenen Spiele um ±N Minuten verschieben“ (§8.3, Akzeptanzkriterium H).
 * Laufende, beendete und nicht ausgetragene Spiele behalten ihre Zeiten. Die Vorschau enthält
 * eine Kollisionsprüfung; übernommen wird erst nach Bestätigung durch den Admin.
 */
export function previewShift(matches: readonly TimedMatch[], deltaMinutes: number, options: ShiftOptions = {}): ShiftPreview {
  const changes: ShiftChange[] = [];
  const unchangedMatchIds: string[] = [];
  const next = matches.map((m) => {
    const inRange = options.fromRoundNumber === undefined || (m.roundNumber ?? Infinity) >= options.fromRoundNumber;
    if (!inRange) return m;
    if (!SHIFTABLE.has(m.status ?? 'scheduled')) {
      unchangedMatchIds.push(m.id);
      return m;
    }
    const newStartISO = addMinutes(m.startISO, deltaMinutes);
    changes.push({ matchId: m.id, oldStartISO: m.startISO, newStartISO });
    return { ...m, startISO: newStartISO };
  });
  return { changes, unchangedMatchIds, matches: next, validation: validateSchedule(next, options) };
}
