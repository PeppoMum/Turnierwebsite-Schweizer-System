// Wertungslogik (Spezifikation §6): Tabelle, Quotient, Feinwertungen.
export {
  calculateStandings,
  compareQuotient,
  countedMatches,
  isRankedStatus,
  DEFAULT_BUCHHOLZ_VARIANT,
  DEFAULT_TIE_BREAKERS,
  POINTS,
} from './standings';
export type { RankDecider, StandingsInput, StandingsMatch, StandingsTeam, TeamStanding } from './standings';
export { formatGoalDiff, formatQuotient, NO_QUOTIENT } from './format';
export { BUCHHOLZ_EXPLANATION, BUCHHOLZ_VARIANT_LABELS, TIE_BREAKER_LABELS, LOT_EXPLANATION } from './labels';
