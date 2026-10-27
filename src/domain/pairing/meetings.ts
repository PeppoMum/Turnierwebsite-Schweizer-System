import type { Match, MatchStatus } from '../types';
import type { PastMeeting } from './types';

/** Symmetrischer Zähler bisheriger Begegnungen. */
export class MeetingCounter {
  private readonly counts = new Map<string, number>();

  constructor(meetings: Iterable<PastMeeting> = []) {
    for (const m of meetings) this.add(m.teamAId, m.teamBId);
  }

  private static key(a: string, b: string): string {
    return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
  }

  add(a: string, b: string): void {
    const k = MeetingCounter.key(a, b);
    this.counts.set(k, (this.counts.get(k) ?? 0) + 1);
  }

  count(a: string, b: string): number {
    return this.counts.get(MeetingCounter.key(a, b)) ?? 0;
  }

  clone(): MeetingCounter {
    const copy = new MeetingCounter();
    for (const [k, v] of this.counts) copy.counts.set(k, v);
    return copy;
  }
}

/**
 * Status, die als Begegnung zählen: gespielt, laufend oder fest angesetzt. Ein
 * angesetztes Spiel wird gespielt werden, also darf der Pairer es nicht erneut
 * ansetzen. `not_played` und `cancelled` zählen nicht: Die Teams haben sich nie
 * gegenübergestanden.
 */
export const MEETING_STATUSES: readonly MatchStatus[] = ['completed', 'live', 'scheduled'];

export interface CollectMeetingsOptions {
  /** Teams, deren Begegnungen komplett gelöscht sind (zurückgezogene Teams). */
  excludedTeamIds?: Iterable<string>;
  /** Abweichende Status-Auswahl, z. B. inkl. `draft` bei gemeinsamer Vorschau. */
  statuses?: readonly MatchStatus[];
  /** Runden, die nicht zählen sollen (z. B. die Runde, die gerade neu gelost wird). */
  excludeRoundNumbers?: Iterable<number>;
}

/**
 * Leitet die für die Paarung relevanten Begegnungen aus Matches ab.
 * Spiele mit zurückgezogenen Teams werden ausgelassen: Nach Phils Regel gelten sie
 * für alle Beteiligten als nie gespielt.
 */
export function collectMeetings(matches: readonly Match[], options: CollectMeetingsOptions = {}): PastMeeting[] {
  const excluded = new Set(options.excludedTeamIds ?? []);
  const statuses = new Set(options.statuses ?? MEETING_STATUSES);
  const skipRounds = new Set(options.excludeRoundNumbers ?? []);
  return matches
    .filter(
      (m) =>
        statuses.has(m.status) &&
        !skipRounds.has(m.roundNumber) &&
        !excluded.has(m.teamAId) &&
        !excluded.has(m.teamBId),
    )
    .map((m) => ({ teamAId: m.teamAId, teamBId: m.teamBId, roundNumber: m.roundNumber }));
}
