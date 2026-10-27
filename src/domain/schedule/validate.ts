import { addMinutes, minutesBetween } from './time';
import type { TimedMatch } from './types';

export interface ScheduleConflict {
  kind: 'field' | 'team';
  matchIds: [string, string];
  message: string;
}

export interface ScheduleValidation {
  /** Feld doppelt belegt (inkl. Wechselpause) oder Team gleichzeitig in zwei Spielen. */
  conflicts: ScheduleConflict[];
  /** Zu kurze Pausen gegenüber dem gewünschten Wert (weich). */
  restWarnings: Array<{ teamId: string; matchId: string; restMinutes: number; message: string }>;
}

export interface ValidateScheduleOptions {
  turnoverMinutes?: number;
  desiredRestMinutes?: number;
  teamNames?: ReadonlyMap<string, string>;
  fieldNames?: ReadonlyMap<string, string>;
}

const end = (m: TimedMatch) => addMinutes(m.startISO, m.durationMinutes);

/** Prüft Feld- und Teamkollisionen sowie Pausen (§8.3 letzter Punkt). */
export function validateSchedule(matches: readonly TimedMatch[], options: ValidateScheduleOptions = {}): ScheduleValidation {
  const turnover = options.turnoverMinutes ?? 0;
  const teamLabel = (id: string) => options.teamNames?.get(id) ?? id;
  const fieldLabel = (id: string) => options.fieldNames?.get(id) ?? id;
  const result: ScheduleValidation = { conflicts: [], restWarnings: [] };
  const sorted = [...matches].sort((a, b) => Date.parse(a.startISO) - Date.parse(b.startISO) || (a.id < b.id ? -1 : 1));

  const byField = new Map<string, TimedMatch[]>();
  for (const m of sorted) byField.set(m.fieldId, [...(byField.get(m.fieldId) ?? []), m]);
  for (const [fieldId, list] of byField) {
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1]!;
      const cur = list[i]!;
      const gap = minutesBetween(end(prev), cur.startISO);
      if (gap < turnover) {
        result.conflicts.push({
          kind: 'field',
          matchIds: [prev.id, cur.id],
          message:
            gap < 0
              ? `${fieldLabel(fieldId)} ist doppelt belegt.`
              : `${fieldLabel(fieldId)}: nur ${gap} Minuten Wechselpause statt ${turnover}.`,
        });
      }
    }
  }

  const byTeam = new Map<string, TimedMatch[]>();
  for (const m of sorted) {
    for (const t of [m.teamAId, m.teamBId]) byTeam.set(t, [...(byTeam.get(t) ?? []), m]);
  }
  for (const [teamId, list] of byTeam) {
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1]!;
      const cur = list[i]!;
      const rest = minutesBetween(end(prev), cur.startISO);
      if (rest < 0) {
        result.conflicts.push({
          kind: 'team',
          matchIds: [prev.id, cur.id],
          message: `${teamLabel(teamId)} wäre gleichzeitig in zwei Spielen eingeplant.`,
        });
      } else if (options.desiredRestMinutes !== undefined && rest < options.desiredRestMinutes) {
        result.restWarnings.push({
          teamId,
          matchId: cur.id,
          restMinutes: rest,
          message: `${teamLabel(teamId)} hat nur ${rest} Minuten Pause (gewünscht: ${options.desiredRestMinutes}).`,
        });
      }
    }
  }
  return result;
}
