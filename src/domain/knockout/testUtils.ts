// Hand gebaute Tabellen für Tests, bis der Gruppen-Teil sie liefert.
import type { GroupTableRow, StageStandings } from '../format/types';

export interface RowStats {
  points?: number;
  played?: number;
  goalsFor?: number;
  goalsAgainst?: number;
}

export function row(teamId: string, place: number, s: RowStats = {}): GroupTableRow {
  const played = s.played ?? 3;
  const points = s.points ?? 0;
  return {
    teamId,
    place,
    played,
    won: Math.floor(points / 3),
    drawn: points % 3,
    lost: 0,
    goalsFor: s.goalsFor ?? 0,
    goalsAgainst: s.goalsAgainst ?? 0,
    points,
  };
}

/**
 * Tabellen aus Team-IDs in Platzreihenfolge. Ohne Angaben bekommt Platz p in einer Gruppe mit n Teams
 * (n − p) · 3 Punkte, damit die Reihenfolge stimmt.
 */
export function standings(stageId: string, groups: string[][], complete: boolean | boolean[] = true, stats: Record<string, RowStats> = {}): StageStandings {
  return {
    stageId,
    groups: groups.map((ids) => ids.map((id, i) => row(id, i + 1, stats[id] ?? { points: (ids.length - i - 1) * 3 }))),
    groupComplete: Array.isArray(complete) ? complete : groups.map(() => complete),
  };
}

/** Teams „A1“, „A2“ … für Gruppe A usw. */
export function groupTeams(groupCount: number, size: number): string[][] {
  return Array.from({ length: groupCount }, (_, g) => Array.from({ length: size }, (_, i) => `${String.fromCharCode(65 + g)}${i + 1}`));
}
