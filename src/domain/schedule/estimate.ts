import { wavesNeeded } from './plan';
import { addMinutes } from './time';
import type { ScheduleConfig } from '../types';

/** Zeitwerte, die für die Hochrechnung reichen (auch öffentlich bekannt). */
export type RoundTiming = Pick<
  ScheduleConfig,
  'tournamentStartISO' | 'matchMinutes' | 'turnoverMinutes' | 'roundBreakMinutes'
>;

/** Eine bereits geplante Runde mit den tatsächlichen Anstoßzeiten ihrer Spiele. */
export interface KnownRoundTimes {
  number: number;
  plannedStartISO: string;
  matches: ReadonlyArray<{ startISO?: string; durationMinutes?: number }>;
}

export interface RoundTimeEstimate {
  number: number;
  startISO: string;
  endISO: string;
  /** Anstoß jeder Welle. */
  waveStartISOs: string[];
  /** true = Runde ist noch nicht gepaart, Zeiten sind hochgerechnet. */
  estimated: boolean;
}

export interface EstimateRoundTimesInput {
  roundsTotal: number;
  timing: RoundTiming;
  /** Teams, die noch mitspielen. */
  teamCount: number;
  fieldCount: number;
  known: readonly KnownRoundTimes[];
}

/**
 * Ungefähre Start- und Endzeiten aller Runden (§8), damit Teams und Zuschauer schon vorab
 * sehen, wann gespielt wird. Geplante Runden übernehmen ihre echten Zeiten; jede spätere
 * Runde beginnt nach dem Ende der vorigen plus Rundenpause, mit so vielen Wellen, wie die
 * aktuelle Teamzahl auf den Feldern braucht. Eine harte Mindestpause kann den echten Start
 * später noch etwas verschieben.
 */
export function estimateRoundTimes(input: EstimateRoundTimesInput): RoundTimeEstimate[] {
  const { timing } = input;
  const waveStep = timing.matchMinutes + timing.turnoverMinutes;
  const betweenRounds = Math.max(timing.turnoverMinutes, timing.roundBreakMinutes);
  const waves = input.fieldCount > 0 ? wavesNeeded(Math.floor(input.teamCount / 2), input.fieldCount) : 0;
  const known = new Map(input.known.map((r) => [r.number, r]));
  const out: RoundTimeEstimate[] = [];
  let previousEnd: string | undefined;
  for (let n = 1; n <= input.roundsTotal; n++) {
    const k = known.get(n);
    const timed = (k?.matches ?? []).filter((m): m is { startISO: string; durationMinutes?: number } => !!m.startISO);
    if (k && timed.length > 0) {
      const starts = [...new Set(timed.map((m) => m.startISO))].sort((a, b) => Date.parse(a) - Date.parse(b));
      const endISO = timed
        .map((m) => addMinutes(m.startISO, m.durationMinutes ?? timing.matchMinutes))
        .reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));
      out.push({ number: n, startISO: starts[0]!, endISO, waveStartISOs: starts, estimated: false });
      previousEnd = endISO;
      continue;
    }
    const startISO = k?.plannedStartISO ?? (previousEnd ? addMinutes(previousEnd, betweenRounds) : timing.tournamentStartISO);
    const waveStartISOs = Array.from({ length: waves }, (_, w) => addMinutes(startISO, w * waveStep));
    const endISO = waves > 0 ? addMinutes(waveStartISOs[waves - 1]!, timing.matchMinutes) : startISO;
    out.push({ number: n, startISO, endISO, waveStartISOs, estimated: !k });
    previousEnd = endISO;
  }
  return out;
}
