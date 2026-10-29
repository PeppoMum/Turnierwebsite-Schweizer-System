// Gruppen auslosen im Assistenten: Zufall, Lostöpfe oder von Hand. Die Auslosung selbst kommt aus
// src/domain/groups; hier steht nur, wie der Assistent sie sich merkt und an geänderte Teams anpasst.
import type { DrawMode } from '../../../domain/format';
import { drawRandom, drawWithPots, groupSizesFor } from '../../../domain/groups';

export interface DrawState {
  mode: DrawMode;
  seed: number;
  /** Lostopf je Team (1-basiert); fehlt = kein Topf. */
  pots: Record<string, number>;
  /** Von Hand gezogene oder geänderte Einteilung; null = aus Zufall/Lostöpfen berechnen. */
  manual: string[][] | null;
}

export function initialDraw(): DrawState {
  return {
    mode: 'random',
    seed: Math.floor(Math.random() * 1_000_000),
    pots: {},
    manual: null,
  };
}

export interface GroupShape {
  groupCount: number;
  groupSizes: number[] | null;
}

/** Lostöpfe als Listen, Topf 1 zuerst; leere Töpfe fallen weg. */
export function potLists(state: DrawState, teamIds: readonly string[]): string[][] {
  const max = Math.max(0, ...teamIds.map((id) => state.pots[id] ?? 0));
  return Array.from({ length: max }, (_, i) => teamIds.filter((id) => state.pots[id] === i + 1)).filter((p) => p.length > 0);
}

/** Die aktuelle Einteilung für diese Teams. */
export function currentGroups(state: DrawState, teamIds: readonly string[], shape: GroupShape): string[][] {
  const input = {
    teamIds,
    groupCount: shape.groupCount,
    groupSizes: shape.groupSizes ?? undefined,
    seed: `wizard-${state.seed}`,
  };
  if (state.manual) return reconcile(state.manual, teamIds, shape);
  if (state.mode === 'pots') return drawWithPots({ ...input, pots: potLists(state, teamIds) });
  return drawRandom(input);
}

/**
 * Eine von Hand gezogene Einteilung an geänderte Teams oder Gruppenzahl anpassen: Abgemeldete fallen
 * heraus, neue Teams kommen in die Gruppe mit dem meisten freien Platz.
 */
export function reconcile(groups: readonly (readonly string[])[], teamIds: readonly string[], shape: GroupShape): string[][] {
  const known = new Set(teamIds);
  const sizes = groupSizesFor(teamIds.length, {
    groupCount: shape.groupCount,
    groupSizes: shape.groupSizes ?? undefined,
  });
  const out: string[][] = Array.from({ length: shape.groupCount }, (_, g) => (groups[g] ?? []).filter((id) => known.has(id)));
  // Gruppen, die es nicht mehr gibt, auflösen.
  const placed = new Set(out.flat());
  const missing = teamIds.filter((id) => !placed.has(id));
  for (const id of missing) {
    let best = 0;
    out.forEach((g, i) => {
      if ((sizes[i] ?? 0) - g.length > (sizes[best] ?? 0) - out[best]!.length) best = i;
    });
    out[best]!.push(id);
  }
  return out;
}

/** Team in eine andere Gruppe schieben (ans Ende). */
export function moveTeam(groups: readonly (readonly string[])[], teamId: string, toGroup: number): string[][] {
  const out = groups.map((g) => g.filter((id) => id !== teamId));
  out[toGroup]?.push(teamId);
  return out;
}

/** Zwei Teams die Plätze tauschen lassen. */
export function swapTeams(groups: readonly (readonly string[])[], a: string, b: string): string[][] {
  return groups.map((g) => g.map((id) => (id === a ? b : id === b ? a : id)));
}

/** Spiele einer Gruppe dieser Größe (jeder gegen jeden). */
export function groupMatchCount(size: number, double: boolean): number {
  return ((size * (size - 1)) / 2) * (double ? 2 : 1);
}
