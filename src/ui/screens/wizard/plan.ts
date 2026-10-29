// Spielgerüst und Spielplan beim Anlegen eines Baukasten-Turniers. Dieselbe Funktion liefert die
// Live-Skizze (mit Ersatz-Teams) und den Plan, der nach dem Anlegen gespeichert wird (mit der
// echten Gruppeneinteilung).
//
// Gruppenspiele kommen aus src/domain/groups, Zeiten und Felder aus src/domain/schedule.
// Die Endrunden-Spiele bekommen Platzhalter („1. Gruppe A“, „Sieger QF1“). Die Paarung der ersten
// K.-o.-Runde ist hier eine einfache Setzliste (Bester gegen Schwächsten, keine zwei Teams derselben
// Gruppe gegeneinander); Tauschen und das Füllen der Endrunde übernimmt die Turnierleitung.
import type { DrawMode, GroupStage, SlotRef, StageConfig, TournamentFormat } from '../../../domain/format';
import { crossoverGroups, evenGroupSizes, groupFixtures, groupSizesFor } from '../../../domain/groups';
import { buildFormatSkeleton, planTournamentDay, type DayPlan, type DayPlanConstraints, type StageMatchToPlan } from '../../../domain/schedule';
import type { ScheduleField } from '../../../domain/schedule';
import type { PlannedStageMatch } from '../../data/types';

/** Einstiegsplätze eines Abschnitts in Setzreihenfolge: erst alle Ersten, dann alle Zweiten …, dann die Besten. */
export function entrySeeds(stage: StageConfig, tableSizes: ReadonlyMap<string, number[]>): Array<{ slot: SlotRef; group: number | null }> {
  if (!stage.entry) return [];
  const { fromStageId, places, best } = stage.entry;
  const sizes = tableSizes.get(fromStageId) ?? [];
  const out: Array<{ slot: SlotRef; group: number | null }> = [];
  for (const place of [...places].sort((a, b) => a - b)) {
    sizes.forEach((size, group) => {
      if (place > size) return;
      out.push({
        slot: sizes.length === 1 ? { kind: 'table_place', stageId: fromStageId, place } : { kind: 'group_place', stageId: fromStageId, group, place },
        group: sizes.length === 1 ? null : group,
      });
    });
  }
  for (const b of best ?? []) {
    for (let rank = 1; rank <= b.count; rank++)
      out.push({
        slot: {
          kind: 'best_of_place',
          stageId: fromStageId,
          place: b.place,
          rank,
        },
        group: null,
      });
  }
  return out;
}

/**
 * Erste K.-o.-Runde: Setzplatz i gegen n-1-i. Treffen dabei zwei Teams derselben Gruppe aufeinander,
 * wird die B-Seite mit einem anderen Spiel getauscht, wenn das keinen neuen Konflikt schafft.
 */
export function firstRoundPairs<T extends { group: number | null }>(seeds: readonly T[]): Array<[T, T]> {
  const n = seeds.length;
  const pairs: Array<[T, T]> = [];
  for (let i = 0; i < n / 2; i++) pairs.push([seeds[i]!, seeds[n - 1 - i]!]);
  const clash = (a: T, b: T) => a.group !== null && a.group === b.group;
  for (let i = 0; i < pairs.length; i++) {
    if (!clash(pairs[i]![0], pairs[i]![1])) continue;
    for (let j = pairs.length - 1; j >= 0; j--) {
      if (j === i) continue;
      if (!clash(pairs[i]![0], pairs[j]![1]) && !clash(pairs[j]![0], pairs[i]![1])) {
        const b = pairs[i]![1];
        pairs[i]![1] = pairs[j]![1];
        pairs[j]![1] = b;
        break;
      }
    }
  }
  return pairs;
}

/** Ein Spiel des Gerüsts; `penaltyOnly` für reine Neunmeterspiele. */
export type BuiltMatch = StageMatchToPlan & { penaltyOnly?: boolean };

/**
 * Alle Spiele des Turniers ohne Zeiten. `prelimGroups` ist die Gruppeneinteilung der Vorrunde
 * (Team-IDs); ohne Einteilung (Vorschau) stehen Ersatz-Teams `team1`, `team2` … darin.
 */
export function buildStageMatches(format: TournamentFormat, teamCount: number, prelimGroups?: readonly (readonly string[])[]): BuiltMatch[] {
  const out: BuiltMatch[] = [];
  const tableSizes = new Map<string, number[]>();
  const skeleton = buildFormatSkeleton(format, teamCount).matches;
  const stageIds = new Set<string>();
  const add = (m: Omit<BuiltMatch, 'id'>) => {
    const n = out.filter((x) => x.stageId === m.stageId).length + 1;
    out.push({ id: `${m.stageId}#${n}`, ...m });
  };

  for (const stage of format.stages) {
    stageIds.add(stage.id);
    if (stage.kind === 'swiss') continue;
    if (stage.kind === 'groups') {
      const g = stage as GroupStage;
      let groups: string[][];
      let slotOf: Map<string, SlotRef> | null = null;
      if (!stage.entry) {
        groups = prelimGroups && prelimGroups.length === g.groupCount ? prelimGroups.map((x) => [...x]) : placeholderGroups(g, teamCount);
      } else {
        const prevSizes = tableSizes.get(stage.entry.fromStageId) ?? [];
        const slots = crossoverGroups(stage.entry, prevSizes.length, g.groupCount);
        slotOf = new Map();
        groups = slots.map((list) =>
          list.map((slot) => {
            const key = JSON.stringify(slot);
            slotOf!.set(key, slot);
            return key;
          }),
        );
      }
      tableSizes.set(
        stage.id,
        groups.map((x) => x.length),
      );
      groups.forEach((ids, groupIndex) => {
        for (const f of groupFixtures(groupIndex, ids, g.doubleRoundRobin)) {
          if (slotOf)
            add({
              stageId: stage.id,
              groupIndex,
              roundNumber: f.round,
              slotA: slotOf.get(f.teamAId),
              slotB: slotOf.get(f.teamBId),
            });
          else
            add({
              stageId: stage.id,
              groupIndex,
              roundNumber: f.round,
              teamAId: f.teamAId,
              teamBId: f.teamBId,
            });
        }
      });
      continue;
    }

    // Endrunden: Gerüst aus der Spielplan-Logik, dessen Platzhalter „n. Platz dieses Abschnitts“ durch die
    // Einstiegsplätze ersetzt werden.
    const seeds = entrySeeds(stage, tableSizes);
    const replace = new Map<number, SlotRef>();
    if (stage.kind === 'knockout') {
      firstRoundPairs(seeds).forEach(([a, b], i) => {
        replace.set(2 * i + 1, a.slot);
        replace.set(2 * i + 2, b.slot);
      });
    } else {
      seeds.forEach((s, i) => replace.set(i + 1, s.slot));
    }
    const map = (slot: SlotRef | undefined) => (slot && slot.kind === 'table_place' && slot.stageId === stage.id ? (replace.get(slot.place) ?? slot) : slot);
    const penaltyOnly = new Set(stage.kind === 'knockout' ? (stage.penaltyOnlyMatchKeys ?? []) : []);
    for (const m of skeleton.filter((x) => x.stageId === stage.id)) {
      const placementMatch = stage.kind === 'placement' ? stage.matches.find((pm) => pm.key === m.matchKey) : undefined;
      add({
        stageId: stage.id,
        matchKey: m.matchKey,
        roundNumber: m.roundNumber,
        place: m.place,
        slotA: map(m.slotA),
        slotB: map(m.slotB),
        ...(stage.kind === 'final_group' ? { groupIndex: 0 } : {}),
        ...(stage.kind === 'knockout' && m.matchKey === 'F' && stage.finalMatchMinutes ? { durationMinutes: stage.finalMatchMinutes } : {}),
        ...((m.matchKey && penaltyOnly.has(m.matchKey)) || placementMatch?.penaltyOnly ? { penaltyOnly: true } : {}),
      });
    }
    tableSizes.set(stage.id, [seeds.length]);
  }
  return out.filter((m) => stageIds.has(m.stageId));
}

function placeholderGroups(stage: GroupStage, teamCount: number): string[][] {
  const sizes = teamCount >= stage.groupCount ? groupSizesFor(teamCount, stage) : evenGroupSizes(teamCount, stage.groupCount);
  let next = 1;
  return sizes.map((n) => Array.from({ length: n }, () => `team${next++}`));
}

export interface CreationPlan {
  matches: BuiltMatch[];
  day: DayPlan;
}

/** Spiele bauen und auf Zeiten und Felder verteilen. */
export function planCreation(
  format: TournamentFormat,
  teamCount: number,
  fields: readonly ScheduleField[],
  constraints: DayPlanConstraints,
  prelimGroups?: readonly (readonly string[])[],
): CreationPlan {
  const matches = buildStageMatches(format, teamCount, prelimGroups);
  return {
    matches,
    day: planTournamentDay(format, matches, fields, constraints),
  };
}

/** In die Form bringen, die `saveStagePlan` speichert. */
export function toPlannedMatches(format: TournamentFormat, plan: CreationPlan, defaultMinutes: number): PlannedStageMatch[] {
  const slot = new Map(plan.day.matches.map((p) => [p.matchId, p]));
  const stage = new Map(format.stages.map((s) => [s.id, s]));
  return plan.matches.map((m) => {
    const p = slot.get(m.id);
    return {
      stageId: m.stageId,
      ...(m.groupIndex !== undefined ? { groupIndex: m.groupIndex } : {}),
      ...(m.matchKey ? { matchKey: m.matchKey } : {}),
      ...(m.teamAId ? { teamAId: m.teamAId } : m.slotA ? { slotA: m.slotA } : {}),
      ...(m.teamBId ? { teamBId: m.teamBId } : m.slotB ? { slotB: m.slotB } : {}),
      ...(m.penaltyOnly ? { penaltyOnly: true } : {}),
      ...(p ? { fieldId: p.fieldId, startISO: p.startISO, waveIndex: p.waveIndex } : {}),
      durationMinutes: m.durationMinutes ?? stage.get(m.stageId)?.matchMinutes ?? defaultMinutes,
    };
  });
}

/** Gruppenphase usw.: Abschnitts-Kennung, die für die Gruppeneinteilung gespeichert wird. */
export function prelimDraw(format: TournamentFormat, groups: string[][], mode: DrawMode, seed: number, pots?: string[][]) {
  const first = format.stages[0]!;
  return {
    stageId: first.id,
    groups,
    mode,
    seed,
    ...(mode === 'pots' && pots ? { pots } : {}),
  };
}
