// Weiterkommen, K.-o.-Baum und Ergebnis von Endrunden-Spielen (docs/turnier-baukasten.md, „Endrunde“).
export {
  compareAcrossGroups,
  entryCount,
  entrySlots,
  evenGroupSizes,
  rankBestOfPlace,
  stageCapacity,
  stageTableSizes,
  tableCount,
  validateFormat,
} from './entry';
export type { BestOfRanking, FormatIssue, FormatIssueCode } from './entry';
export { buildBracket, buildFormatBrackets, firstRoundPairs, matchLabel, meetingRound, placementMatches, standardSeedOrder } from './bracket';
export type { BracketMatch } from './bracket';
export { KNOCKOUT_ISSUE_TEXT, decideKnockoutMatch, formatKnockoutResult, walkoverFields } from './result';
export type { KnockoutIssue, KnockoutOutcome, KnockoutResultInput, Side } from './result';
