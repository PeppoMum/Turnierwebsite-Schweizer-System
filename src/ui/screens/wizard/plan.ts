// Spielgerüst und Spielplan beim Anlegen eines Baukasten-Turniers. Dieselbe Funktion liefert die
// Live-Skizze (mit Ersatz-Teams) und den Plan, der nach dem Anlegen gespeichert wird (mit der
// echten Gruppeneinteilung).
//
// Gruppenspiele kommen aus src/domain/groups, K.-o.-Baum und Platzierungsspiele aus src/domain/knockout,
// Zeiten und Felder aus src/domain/schedule. Die Endrunden-Spiele bekommen Platzhalter („1. Gruppe A“,
// „Sieger QF1“); das Füllen der Endrunde und Tauschen übernimmt die Turnierleitung.
import type { DrawMode, GroupStage, SlotRef, TournamentFormat } from '../../../domain/format';
import { crossoverGroups, evenGroupSizes, groupFixtures, groupSizesFor } from '../../../domain/groups';
import { buildBracket, entrySlots, placementMatches } from '../../../domain/knockout';
import { buildFormatSkeleton, planTournamentDay, type DayPlan, type DayPlanConstraints, type StageMatchToPlan } from '../../../domain/schedule';
import type { ScheduleField } from '../../../domain/schedule';
import type { PlannedStageMatch } from '../../data/types';

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

    // Endrunden: K.-o.-Baum und Platzierungsspiele aus der K.-o.-Logik, Finalgruppe aus dem Gerüst der
    // Spielplan-Logik mit den Einstiegsplätzen statt „n. Platz dieses Abschnitts“.
    const source = stage.entry ? format.stages.find((x) => x.id === stage.entry!.fromStageId) : undefined;
    const entrants = stage.entry && source ? entrySlots(stage.entry, source, tableSizes.get(source.id) ?? []) : [];
    if (stage.kind === 'final_group') {
      const map = (slot: SlotRef | undefined) => (slot?.kind === 'table_place' && slot.stageId === stage.id ? (entrants[slot.place - 1] ?? slot) : slot);
      for (const m of skeleton.filter((x) => x.stageId === stage.id)) {
        add({ stageId: stage.id, groupIndex: 0, roundNumber: m.roundNumber, slotA: map(m.slotA), slotB: map(m.slotB) });
      }
    } else {
      const bracket = stage.kind === 'knockout' ? buildBracket(stage, entrants) : placementMatches(stage);
      const offset = (stage.placeRange?.from ?? 1) - 1;
      for (const m of bracket) {
        add({
          stageId: stage.id,
          matchKey: m.key,
          roundNumber: m.round,
          ...(m.range.to - m.range.from === 1 ? { place: offset + m.range.from } : {}),
          slotA: m.slotA,
          slotB: m.slotB,
          ...(stage.kind === 'knockout' && m.key === 'F' && stage.finalMatchMinutes ? { durationMinutes: stage.finalMatchMinutes } : {}),
          ...(m.penaltyOnly ? { penaltyOnly: true } : {}),
        });
      }
    }
    tableSizes.set(stage.id, [entrants.length]);
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
