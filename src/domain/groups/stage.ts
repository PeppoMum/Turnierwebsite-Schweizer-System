// Tabellen aller Gruppen eines Abschnitts -> `StageStandings` für Weiterkommen und Anzeige.

import type { GroupStage, StageMatchFields, StageStandings, TieBreakVariant } from '../format/types';
import { isRankedStatus, type StandingsTeam } from '../scoring/standings';
import { calculateGroupTable, type CarryOver, type GroupMatch, type GroupTable, type LotDecision } from './table';

export type StageMatch = GroupMatch & Partial<Pick<StageMatchFields, 'stageId'>>;

export interface GroupStageStandingsInput {
  stage: Pick<GroupStage, 'id' | 'doubleRoundRobin' | 'carryOverPoints'>;
  /** Einteilung: pro Gruppe die Team-IDs. */
  groups: readonly (readonly string[])[];
  teams: readonly StandingsTeam[];
  /** Spiele des Turniers; Spiele anderer Abschnitte (anderes `stageId`) werden ignoriert. */
  matches: readonly StageMatch[];
  variant: TieBreakVariant;
  lots?: readonly LotDecision[];
  /** Werte aus dem vorigen Abschnitt; zählen nur, wenn `stage.carryOverPoints` an ist. */
  carryOver?: ReadonlyMap<string, CarryOver>;
}

export interface GroupStageStandings extends StageStandings {
  /** Pro Gruppe die volle Tabelle samt nicht gewerteten Teams und offenen Losen. */
  tables: GroupTable[];
}

const FINAL: ReadonlySet<GroupMatch['status']> = new Set(['completed', 'not_played', 'cancelled']);

/**
 * Eine Gruppe ist fertig, wenn jedes Paar gewerteter Teams so oft gespielt hat wie vorgesehen
 * (einmal, bei Hin- und Rückspiel zweimal) und kein Spiel zwischen ihnen mehr offen ist.
 * Spiele gegen zurückgezogene Teams zählen nicht und halten die Gruppe nicht auf.
 */
function isGroupComplete(teamIds: readonly string[], matches: readonly GroupMatch[], ranked: ReadonlySet<string>, legs: number): boolean {
  const ids = teamIds.filter((id) => ranked.has(id));
  const done = new Map<string, number>();
  for (const m of matches) {
    if (!ranked.has(m.teamAId) || !ranked.has(m.teamBId)) continue;
    if (!FINAL.has(m.status)) return false;
    const key = m.teamAId < m.teamBId ? `${m.teamAId}\u0000${m.teamBId}` : `${m.teamBId}\u0000${m.teamAId}`;
    done.set(key, (done.get(key) ?? 0) + 1);
  }
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i]!;
      const b = ids[j]!;
      if ((done.get(a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`) ?? 0) < legs) return false;
    }
  }
  return true;
}

export function calculateGroupStageStandings(input: GroupStageStandingsInput): GroupStageStandings {
  const teamById = new Map(input.teams.map((t) => [t.id, t]));
  const ranked = new Set(input.teams.filter((t) => isRankedStatus(t.status)).map((t) => t.id));
  const stageMatches = input.matches.filter((m) => m.stageId === undefined || m.stageId === input.stage.id);
  const carryOver = input.stage.carryOverPoints ? input.carryOver : undefined;
  const legs = input.stage.doubleRoundRobin ? 2 : 1;

  const tables: GroupTable[] = [];
  const groupComplete: boolean[] = [];
  for (const teamIds of input.groups) {
    const members = new Set(teamIds);
    const matches = stageMatches.filter((m) => members.has(m.teamAId) && members.has(m.teamBId));
    // Unbekannte IDs (z. B. gelöschtes Team) werden wie zurückgezogene behandelt.
    const teams = teamIds.map((id) => teamById.get(id) ?? { id, name: id, status: 'inactive' as const });
    tables.push(calculateGroupTable({ teams, matches, variant: input.variant, lots: input.lots, carryOver }));
    groupComplete.push(isGroupComplete(teamIds, matches, ranked, legs));
  }
  return { stageId: input.stage.id, groups: tables.map((t) => t.rows), groupComplete, tables };
}
