// Turnier-Baukasten: Handänderungen am fertigen Spielplan (docs/turnier-baukasten.md, „Ändern und
// korrigieren“). Zwei Spiele tauschen, Gegner tauschen, Feld oder Uhrzeit ändern, ab einem Zeitpunkt
// verschieben. Warnungen statt Verbote; nur laufende/beendete Spiele sind gesperrt. Geänderte Zeiten
// und Felder werden mit `manual` markiert, damit eine Neuberechnung sie stehen lässt.
import type { SlotRef } from '../format/types';
import type { MatchStatus } from '../types';
import { EDITABLE_STATUSES, matchKeyIndex, predecessorIds, sideKeys, sideLabel, slotKey, slotLabel } from './stages';
import { addMinutes, minutesBetween } from './time';
import type { TimedMatch } from './types';
import { validateSchedule, type ValidateScheduleOptions } from './validate';

/** Ein geplantes Spiel des Baukastens, wie es die Turnierleitung bearbeitet. */
export interface EditableMatch {
  id: string;
  stageId: string;
  matchKey?: string;
  teamAId?: string;
  teamBId?: string;
  slotA?: SlotRef;
  slotB?: SlotRef;
  fieldId: string;
  startISO: string;
  durationMinutes: number;
  status?: MatchStatus;
  manual?: boolean;
}

export interface ScheduleIssue {
  /** `field` doppelt belegt, `team` gleichzeitig zwei Spiele, `rest` zu kurze Pause, `order` K.-o.-Spiel vor seinem Vorgänger. */
  kind: 'field' | 'team' | 'rest' | 'order';
  matchIds: string[];
  message: string;
}

export type EditResult =
  | { ok: true; matches: EditableMatch[]; changedIds: string[]; issues: ScheduleIssue[] }
  | { ok: false; error: string };

export type CheckOptions = ValidateScheduleOptions;

/** Laufende, beendete oder ausgefallene Spiele dürfen nicht mehr verschoben oder getauscht werden. */
export function isLocked(m: Pick<EditableMatch, 'status'>): boolean {
  return !EDITABLE_STATUSES.has(m.status ?? 'scheduled');
}

/**
 * Prüft einen Spielplan mit Platzhaltern: Feld doppelt belegt, Team (oder Platzhalter) gleichzeitig
 * in zwei Spielen, zu kurze Pausen, K.-o.-Spiel beginnt vor dem Ende seines Vorgänger-Spiels.
 */
export function checkStageSchedule(matches: readonly EditableMatch[], options: CheckOptions = {}): ScheduleIssue[] {
  const names = new Map(options.teamNames ?? []);
  for (const m of matches) {
    for (const slot of [m.slotA, m.slotB]) if (slot && !names.has(slotKey(slot))) names.set(slotKey(slot), slotLabel(slot, options.teamNames));
  }
  const timed: TimedMatch[] = matches.map((m) => {
    const [a, b] = sideKeys(m);
    return { id: m.id, teamAId: a, teamBId: b, fieldId: m.fieldId, startISO: m.startISO, durationMinutes: m.durationMinutes };
  });
  const v = validateSchedule(timed, { ...options, teamNames: names });
  const issues: ScheduleIssue[] = [
    ...v.conflicts.map((c) => ({ kind: c.kind, matchIds: [...c.matchIds], message: c.message })),
    ...v.restWarnings.map((r) => ({ kind: 'rest' as const, matchIds: [r.matchId], message: r.message })),
  ];

  const byKey = matchKeyIndex(matches);
  const byId = new Map(matches.map((m) => [m.id, m]));
  for (const m of matches) {
    for (const p of predecessorIds(m, byKey)) {
      const pre = byId.get(p.matchId)!;
      const rest = minutesBetween(addMinutes(pre.startISO, pre.durationMinutes), m.startISO);
      const what = `${m.matchKey ?? 'Spiel'}`;
      if (rest < 0) {
        issues.push({
          kind: 'order',
          matchIds: [pre.id, m.id],
          message: `${what} beginnt, bevor ${pre.matchKey ?? 'das Spiel davor'} vorbei ist.`,
        });
      } else if (
        options.desiredRestMinutes !== undefined &&
        rest < options.desiredRestMinutes &&
        !(p.side === 'A' ? m.teamAId : m.teamBId) // bekannte Teams prüft validateSchedule schon
      ) {
        issues.push({
          kind: 'rest',
          matchIds: [m.id],
          message: `${sideLabel(m, p.side, options.teamNames)} hat vor ${what} nur ${rest} Minuten Pause (gewünscht: ${options.desiredRestMinutes}).`,
        });
      }
    }
  }
  return issues;
}

function apply(
  matches: readonly EditableMatch[],
  changes: ReadonlyMap<string, Partial<EditableMatch>>,
  options: CheckOptions,
): EditResult {
  for (const id of changes.keys()) {
    const m = matches.find((x) => x.id === id);
    if (!m) return { ok: false, error: 'Das Spiel gibt es nicht (mehr).' };
    if (isLocked(m)) return { ok: false, error: 'Das Spiel läuft schon oder ist vorbei und kann nicht mehr geändert werden.' };
  }
  const next = matches.map((m) => (changes.has(m.id) ? { ...m, ...changes.get(m.id)! } : m));
  return { ok: true, matches: next, changedIds: [...changes.keys()], issues: checkStageSchedule(next, options) };
}

/** Zwei Spiele tauschen Uhrzeit und Feld. */
export function swapMatchTimes(matches: readonly EditableMatch[], idA: string, idB: string, options: CheckOptions = {}): EditResult {
  const a = matches.find((m) => m.id === idA);
  const b = matches.find((m) => m.id === idB);
  if (!a || !b) return { ok: false, error: 'Das Spiel gibt es nicht (mehr).' };
  if (idA === idB) return { ok: false, error: 'Bitte zwei verschiedene Spiele wählen.' };
  return apply(
    matches,
    new Map([
      [a.id, { startISO: b.startISO, fieldId: b.fieldId, manual: true }],
      [b.id, { startISO: a.startISO, fieldId: a.fieldId, manual: true }],
    ]),
    options,
  );
}

export interface MatchSide {
  matchId: string;
  side: 'A' | 'B';
}

/**
 * Zwei Teams (oder Platzhalter) zwischen zwei noch nicht angepfiffenen Spielen tauschen. Ein
 * bekanntes Team wird dabei fest gesetzt (`{ kind: 'team' }`), damit das spätere Füllen der
 * Endrunde den Tausch nicht überschreibt.
 */
export function swapOpponents(matches: readonly EditableMatch[], x: MatchSide, y: MatchSide, options: CheckOptions = {}): EditResult {
  const mx = matches.find((m) => m.id === x.matchId);
  const my = matches.find((m) => m.id === y.matchId);
  if (!mx || !my) return { ok: false, error: 'Das Spiel gibt es nicht (mehr).' };
  if (x.matchId === y.matchId) return { ok: false, error: 'Bitte Teams aus zwei verschiedenen Spielen wählen.' };
  const get = (m: EditableMatch, side: 'A' | 'B') => {
    const team = side === 'A' ? m.teamAId : m.teamBId;
    const slot = side === 'A' ? m.slotA : m.slotB;
    return { team, slot: team ? ({ kind: 'team', teamId: team } as SlotRef) : slot };
  };
  const put = (side: 'A' | 'B', v: { team?: string; slot?: SlotRef }): Partial<EditableMatch> =>
    side === 'A' ? { teamAId: v.team, slotA: v.slot } : { teamBId: v.team, slotB: v.slot };
  const vx = get(mx, x.side);
  const vy = get(my, y.side);
  const cx = put(x.side, vy);
  const cy = put(y.side, vx);
  for (const [m, c] of [[mx, cx], [my, cy]] as const) {
    const after = { ...m, ...c };
    if (after.teamAId && after.teamAId === after.teamBId) return { ok: false, error: 'Ein Team kann nicht gegen sich selbst spielen.' };
  }
  return apply(matches, new Map([[mx.id, cx], [my.id, cy]]), options);
}

/** Feld und/oder Uhrzeit eines Spiels ändern. */
export function moveMatch(
  matches: readonly EditableMatch[],
  id: string,
  to: { fieldId?: string; startISO?: string },
  options: CheckOptions = {},
): EditResult {
  const change: Partial<EditableMatch> = { manual: true };
  if (to.fieldId !== undefined) change.fieldId = to.fieldId;
  if (to.startISO !== undefined) change.startISO = to.startISO;
  return apply(matches, new Map([[id, change]]), options);
}

/**
 * Alle noch nicht angepfiffenen Spiele ab `fromISO` (Anstoß ab diesem Zeitpunkt) um ±N Minuten
 * verschieben, wie `previewShift` beim Schweizer System. Laufende und beendete Spiele bleiben.
 */
export function shiftFrom(
  matches: readonly EditableMatch[],
  deltaMinutes: number,
  fromISO: string,
  options: CheckOptions = {},
): EditResult {
  const changes = new Map<string, Partial<EditableMatch>>();
  for (const m of matches) {
    if (Date.parse(m.startISO) < Date.parse(fromISO) || isLocked(m)) continue;
    changes.set(m.id, { startISO: addMinutes(m.startISO, deltaMinutes), manual: true });
  }
  return apply(matches, changes, options);
}
