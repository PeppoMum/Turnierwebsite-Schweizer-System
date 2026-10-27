// Paarungsalgorithmus (Spezifikation §7): Auslosung und Schweizer Runden als Min-Cost-Perfect-Matching.
export * from './types';
export { maxWeightMatching, type WeightedEdge } from './blossom';
export { minCostPerfectMatching, type EdgeCostFn, type MatchingResult } from './matching';
export { MeetingCounter, collectMeetings, MEETING_STATUSES, type CollectMeetingsOptions } from './meetings';
export {
  MODE_WEIGHTS,
  resolveWeights,
  realQuotient,
  neutralPrior,
  quotientForPairing,
  edgeCost,
  effectiveQuotientWeight,
} from './cost';
export { pairSwissRound, LARGE_GAP_WARNING, type SwissRoundInput } from './swiss';
export {
  previewDrawRounds,
  maxRoundsWithoutRepeat,
  checkRoundConfiguration,
  type DrawTeam,
  type DrawRoundsInput,
  type DrawRoundsResult,
} from './draw';
export { validatePairingPlan, swapTeams, type ProposedPlan, type ValidatePlanInput, type ValidationReport } from './validate';
export { createRng, hashString, deriveSeed } from './random';
export { previewNextRound, toPairingPreview, type NextRoundInput, type PairingPreview, type StandingForPairing } from './preview';
