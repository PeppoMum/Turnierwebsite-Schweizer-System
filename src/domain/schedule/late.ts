// Team kommt zu spät: Vorschläge für „Spiel nach hinten tauschen“ (Paket U2, Turnier umstellen).
// Gesucht wird ein späteres, noch nicht angepfiffenes Spiel derselben Gruppe ohne das späte Team;
// beide Spiele tauschen Uhrzeit und Feld (swapMatchTimes). Ausgeschlossen sind Tausche, die ein Feld
// doppelt belegen oder ein Team gleichzeitig in zwei Spiele setzen. Nach vorne rücken ist erlaubt;
// rückt ein Team vor sein bisher erstes Spiel, gibt es nur den Hinweis, dass es vielleicht noch nicht
// da ist. Reihenfolge: zuerst ohne diesen Hinweis, dann ohne neue Pausen-Warnung, dann das früheste.
import { minutesBetween } from './time';
import { checkStageSchedule, isLocked, swapMatchTimes, type CheckOptions, type EditableMatch, type ScheduleIssue } from './swap';

export interface LaterSwapOption {
  /** Spiel, mit dem getauscht wird. */
  matchId: string;
  /** Neue Anstoßzeit und neues Feld des Spiels mit dem späten Team. */
  startISO: string;
  fieldId: string;
  /** Um so viele Minuten spielt das späte Team später. */
  delayMinutes: number;
  /** Teams des anderen Spiels, die dadurch vor ihrem bisher ersten Spiel dran sind. */
  earlyTeamIds: string[];
  /** Neue Warnungen (nur Pausen; Feld- und Team-Konflikte werden nicht vorgeschlagen). */
  issues: ScheduleIssue[];
}

export type LaterSwapResult = { ok: true; options: LaterSwapOption[] } | { ok: false; error: string };

const BLOCKING = new Set<ScheduleIssue['kind']>(['field', 'team', 'order']);

function teamsOf(m: EditableMatch): string[] {
  return [m.teamAId, m.teamBId].filter((x): x is string => Boolean(x));
}

/** Spiele, mit denen das Spiel `matchId` nach hinten getauscht werden kann, das beste zuerst. */
export function laterSwapOptions(
  matches: readonly EditableMatch[],
  matchId: string,
  lateTeamId: string,
  options: CheckOptions & { limit?: number } = {},
): LaterSwapResult {
  const m = matches.find((x) => x.id === matchId);
  if (!m) return { ok: false, error: 'Das Spiel gibt es nicht (mehr).' };
  if (m.matchKey) return { ok: false, error: 'Endrunden-Spiele lassen sich so nicht tauschen.' };
  if (isLocked(m)) return { ok: false, error: 'Das Spiel läuft schon oder ist vorbei.' };
  if (!teamsOf(m).includes(lateTeamId)) return { ok: false, error: 'Das Team spielt nicht in diesem Spiel.' };

  const key = (i: ScheduleIssue) => `${i.kind}|${[...i.matchIds].sort().join(',')}|${i.message}`;
  const before = new Set(checkStageSchedule(matches, options).map(key));
  const firstStart = new Map<string, number>();
  for (const x of matches) {
    for (const t of teamsOf(x)) firstStart.set(t, Math.min(firstStart.get(t) ?? Infinity, Date.parse(x.startISO)));
  }

  const found: LaterSwapOption[] = [];
  for (const c of matches) {
    if (c.id === m.id || c.stageId !== m.stageId || c.groupIndex !== m.groupIndex || c.matchKey) continue;
    if (isLocked(c) || !c.teamAId || !c.teamBId || teamsOf(c).includes(lateTeamId)) continue;
    if (Date.parse(c.startISO) <= Date.parse(m.startISO)) continue;
    const r = swapMatchTimes(matches, m.id, c.id, options);
    if (!r.ok) continue;
    const added = r.issues.filter((i) => !before.has(key(i)));
    if (added.some((i) => BLOCKING.has(i.kind))) continue;
    found.push({
      matchId: c.id,
      startISO: c.startISO,
      fieldId: c.fieldId,
      delayMinutes: minutesBetween(m.startISO, c.startISO),
      earlyTeamIds: teamsOf(c).filter((t) => Date.parse(m.startISO) < (firstStart.get(t) ?? Infinity)),
      issues: added,
    });
  }
  found.sort(
    (a, b) =>
      a.earlyTeamIds.length - b.earlyTeamIds.length ||
      a.issues.length - b.issues.length ||
      a.delayMinutes - b.delayMinutes ||
      a.matchId.localeCompare(b.matchId),
  );
  return { ok: true, options: found.slice(0, options.limit ?? 3) };
}
