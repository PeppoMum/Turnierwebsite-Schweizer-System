// Gruppenabschnitte im Turnier-Baukasten: Größen, Auslosung, Spielpaarungen, Tabelle, Zwischenrunde.
export { evenGroupSizes, checkGroupSizes, groupSizesFor, groupLetter } from './sizes';
export { drawRandom, drawWithPots, checkGroupAssignment } from './draw';
export type { DrawCheck, DrawInput, GroupAssignment, PotDrawInput } from './draw';
export { backToBackCount, groupFixtures, roundRobinRounds, stageFixtures } from './fixtures';
export type { GroupFixture } from './fixtures';
export { calculateGroupTable, carryOverFrom } from './table';
export type { CarryOver, GroupMatch, GroupTable, GroupTableInput, LotDecision } from './table';
export { calculateGroupStageStandings } from './stage';
export type { GroupStageStandings, GroupStageStandingsInput, StageMatch } from './stage';
export { crossoverGroups } from './crossover';
export { GROUP_LOT_EXPLANATION, GROUP_TIE_BREAKER_LABELS, HEAD_TO_HEAD_EXPLANATION, TIE_BREAK_VARIANT_LABELS } from './labels';
export { WALKOVER_GOALS, isScoredWalkover, scoredWalkover } from './walkover';
export type { ScoredWalkover } from './walkover';
