import { solveAssignment } from './assignment';
import { addMinutes, minutesBetween } from './time';
import type {
  RoundSchedule,
  RoundToSchedule,
  ScheduleConstraints,
  ScheduledMatch,
  ScheduleField,
  SchedulePlan,
} from './types';

/** Mindestens benötigte Wellen: ceil(Spiele / Felder) (§8.1). */
export function wavesNeeded(matchCount: number, fieldCount: number): number {
  if (matchCount === 0) return 0;
  if (fieldCount <= 0) throw new Error('Es ist kein aktives Spielfeld vorhanden.');
  return Math.ceil(matchCount / fieldCount);
}

/**
 * Spiele je Welle. `max_capacity` füllt die ersten Wellen voll (16 Teams, 5 Felder: 5 + 3),
 * `balanced_waves` verteilt gleichmäßig auf dieselbe Wellenzahl (4 + 4).
 */
export function waveSizes(
  matchCount: number,
  fieldCount: number,
  allocation: ScheduleConstraints['allocation'],
): number[] {
  const waves = wavesNeeded(matchCount, fieldCount);
  if (waves === 0) return [];
  if (allocation === 'max_capacity') {
    return Array.from({ length: waves }, (_, w) => (w < waves - 1 ? fieldCount : matchCount - fieldCount * (waves - 1)));
  }
  const base = Math.floor(matchCount / waves);
  const extra = matchCount % waves;
  return Array.from({ length: waves }, (_, w) => base + (w < extra ? 1 : 0));
}

/** Gewicht je fehlender Pausenminute (quadratisch) für das weiche Ziel. */
const SOFT_REST_WEIGHT = 1;
/** Gewicht je fehlender Minute zur harten Mindestpause; dominiert alles andere. */
const HARD_REST_WEIGHT = 1_000_000;

export interface CreateScheduleOptions {
  /** Spielende (ISO) der Teams vor der ersten zu planenden Runde, für die Pausenberechnung. */
  teamLastEndISO?: Readonly<Record<string, string>>;
  /** Anzeigenamen für Hinweistexte. */
  teamNames?: ReadonlyMap<string, string>;
}

/**
 * Verteilt gepaarte Runden auf Wellen und Felder (§8). Die Paarungen bleiben unverändert;
 * optimiert wird nur, welches Spiel in welcher Welle liegt: Pro Runde wird exakt (Ungarische
 * Methode) die Zuordnung gesucht, die zu kurze Pausen am wenigsten verletzt. Eine harte
 * Mindestpause wird notfalls durch Verschieben des Rundenstarts eingehalten und gemeldet.
 */
export function createWaveSchedule(
  rounds: readonly RoundToSchedule[],
  fields: readonly ScheduleField[],
  constraints: ScheduleConstraints,
  options: CreateScheduleOptions = {},
): SchedulePlan {
  const active = fields.filter((f) => f.active).sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
  const names = options.teamNames ?? new Map<string, string>();
  const label = (id: string) => names.get(id) ?? id;
  const softTarget = constraints.desiredRestMinutes ?? constraints.matchMinutes;
  const hardTarget = constraints.optionalHardRestMinutes;
  const waveStep = constraints.matchMinutes + constraints.turnoverMinutes;
  const betweenRounds = Math.max(constraints.turnoverMinutes, constraints.roundBreakMinutes);

  const lastEnd = new Map<string, string>(Object.entries(options.teamLastEndISO ?? {}));
  const plan: SchedulePlan = { matches: [], rounds: [], restWarnings: [], warnings: [], problems: [] };
  if (active.length === 0) {
    plan.problems.push('Es ist kein aktives Spielfeld vorhanden.');
    return plan;
  }

  let previousEnd: string | undefined;
  for (const round of [...rounds].sort((a, b) => a.roundNumber - b.roundNumber)) {
    let start = round.startISO ?? (previousEnd ? addMinutes(previousEnd, betweenRounds) : constraints.tournamentStartISO);
    if (round.startISO && previousEnd && minutesBetween(previousEnd, round.startISO) < constraints.turnoverMinutes) {
      plan.problems.push(
        `Runde ${round.roundNumber} soll beginnen, bevor Runde ${round.roundNumber - 1} samt Wechselpause vorbei ist.`,
      );
    }

    const sizes = waveSizes(round.matches.length, active.length, constraints.allocation);
    const slots: number[] = sizes.flatMap((size, w) => Array.from({ length: size }, () => w));
    const n = round.matches.length;

    // Pause eines Teams, wenn es in Welle w (relativ zu `start`) spielt.
    const rest = (teamId: string, w: number, roundStart: string): number => {
      const end = lastEnd.get(teamId);
      return end === undefined ? Infinity : minutesBetween(end, addMinutes(roundStart, w * waveStep));
    };
    const slotCost = (matchIdx: number, slotIdx: number): number => {
      const w = slots[slotIdx]!;
      const m = round.matches[matchIdx]!;
      let c = 0;
      for (const t of [m.teamAId, m.teamBId]) {
        const r = rest(t, w, start);
        if (r < softTarget) c += SOFT_REST_WEIGHT * (softTarget - r) ** 2;
        if (hardTarget !== undefined && r < hardTarget) c += HARD_REST_WEIGHT * (hardTarget - r);
      }
      // Winzige Präferenz für die Paarungsreihenfolge, damit gleichwertige Pläne stabil sind.
      return c + 1e-6 * Math.abs(matchIdx - slotIdx);
    };
    const assignment = n > 0 ? solveAssignment(round.matches.map((_, i) => slots.map((_, j) => slotCost(i, j)))) : [];

    let shift = 0;
    if (hardTarget !== undefined) {
      for (let i = 0; i < n; i++) {
        const m = round.matches[i]!;
        const w = slots[assignment[i]!]!;
        for (const t of [m.teamAId, m.teamBId]) shift = Math.max(shift, hardTarget - rest(t, w, start));
      }
      shift = Math.max(0, Math.ceil(shift));
      if (shift > 0) {
        start = addMinutes(start, shift);
        plan.warnings.push(
          `Runde ${round.roundNumber} beginnt ${shift} Minuten später, damit die harte Mindestpause von ${hardTarget} Minuten eingehalten wird.`,
        );
      }
    }

    // Feldzuordnung innerhalb der Welle in Paarungsreihenfolge.
    const byWave = sizes.map(() => [] as number[]);
    for (let i = 0; i < n; i++) byWave[slots[assignment[i]!]!]!.push(i);
    const roundSchedule: RoundSchedule = {
      roundNumber: round.roundNumber,
      startISO: start,
      endISO: start,
      waves: [],
      startShiftedByMinutes: shift,
    };
    const scheduled: ScheduledMatch[] = [];
    byWave.forEach((matchIdxs, w) => {
      const waveStart = addMinutes(start, w * waveStep);
      roundSchedule.waves.push({ index: w, startISO: waveStart, matchIds: [] });
      matchIdxs.sort((a, b) => a - b);
      matchIdxs.forEach((idx, k) => {
        const m = round.matches[idx]!;
        const field = active[k]!;
        const endISO = addMinutes(waveStart, constraints.matchMinutes);
        scheduled.push({
          matchId: m.id,
          roundNumber: round.roundNumber,
          teamAId: m.teamAId,
          teamBId: m.teamBId,
          fieldId: field.id,
          fieldName: field.name,
          waveIndex: w,
          startISO: waveStart,
          endISO,
        });
        roundSchedule.waves[w]!.matchIds.push(m.id);
        roundSchedule.endISO = endISO;
      });
    });

    for (const s of scheduled) {
      for (const t of [s.teamAId, s.teamBId]) {
        const end = lastEnd.get(t);
        if (end !== undefined) {
          const r = minutesBetween(end, s.startISO);
          const hard = hardTarget !== undefined && r < hardTarget;
          if (r < softTarget || hard) {
            const target = hard ? hardTarget! : softTarget;
            plan.restWarnings.push({
              teamId: t,
              roundNumber: s.roundNumber,
              matchId: s.matchId,
              restMinutes: r,
              targetMinutes: target,
              hard,
              message: `${label(t)} hat vor dem Spiel in Runde ${s.roundNumber} nur ${r} Minuten Pause (gewünscht: ${target}).`,
            });
          }
        }
      }
    }
    for (const s of scheduled) {
      lastEnd.set(s.teamAId, s.endISO);
      lastEnd.set(s.teamBId, s.endISO);
    }
    plan.matches.push(...scheduled);
    plan.rounds.push(roundSchedule);
    previousEnd = roundSchedule.endISO;
  }

  const unusedFields = active.filter((f) => !plan.matches.some((m) => m.fieldId === f.id));
  if (unusedFields.length > 0 && plan.matches.length > 0) {
    plan.warnings.push(`Nicht genutzte Felder: ${unusedFields.map((f) => f.name).join(', ')}.`);
  }
  return plan;
}

/**
 * Pausenstatistik eines Plans: kürzeste Pause und Anzahl der Teams, die direkt von
 * der letzten Welle einer Runde in die erste Welle der nächsten müssen.
 */
export function restSummary(plan: SchedulePlan): { minRestMinutes: number; backToBack: number } {
  const byTeam = new Map<string, ScheduledMatch[]>();
  for (const m of plan.matches) {
    for (const t of [m.teamAId, m.teamBId]) byTeam.set(t, [...(byTeam.get(t) ?? []), m]);
  }
  let minRest = Infinity;
  let backToBack = 0;
  const lastWave = new Map(plan.rounds.map((r) => [r.roundNumber, r.waves.length - 1]));
  for (const list of byTeam.values()) {
    list.sort((a, b) => Date.parse(a.startISO) - Date.parse(b.startISO));
    for (let i = 1; i < list.length; i++) {
      minRest = Math.min(minRest, minutesBetween(list[i - 1]!.endISO, list[i]!.startISO));
      const prev = list[i - 1]!;
      const cur = list[i]!;
      if (prev.waveIndex === lastWave.get(prev.roundNumber) && cur.waveIndex === 0 && lastWave.get(prev.roundNumber)! > 0) {
        backToBack++;
      }
    }
  }
  return { minRestMinutes: minRest, backToBack };
}
