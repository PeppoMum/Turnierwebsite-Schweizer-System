// Gruppen auslosen: Zufall, Lostöpfe oder von Hand (dann nur Prüfung).
// Zufall läuft über einen Seed, dieselbe Eingabe ergibt immer dieselbe Einteilung.

import { createRng, shuffled, type Rng } from '../pairing/random';
import { groupLetter, groupSizesFor } from './sizes';

/** Pro Gruppe die Team-IDs, Gruppe 0 = A. */
export type GroupAssignment = string[][];

export interface DrawInput {
  teamIds: readonly string[];
  groupCount: number;
  /** Eigene Gruppengrößen; fehlt = gleichmäßig. */
  groupSizes?: readonly number[];
  /** Gespeicherter Seed, z. B. Turnier-ID plus Zeitpunkt der Auslosung. */
  seed: string;
}

export interface PotDrawInput extends DrawInput {
  /** Lostöpfe, stärkster zuerst. Teams ohne Topf kommen in einen letzten, gemeinsamen Topf. */
  pots: readonly (readonly string[])[];
}

export interface DrawCheck {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** Reine Zufallsauslosung in die vorgegebenen Gruppengrößen. */
export function drawRandom(input: DrawInput): GroupAssignment {
  const sizes = groupSizesFor(input.teamIds.length, input);
  const order = shuffled(uniqueSorted(input.teamIds), createRng(input.seed));
  const groups: GroupAssignment = [];
  let next = 0;
  for (const size of sizes) {
    groups.push(order.slice(next, next + size));
    next += size;
  }
  return groups;
}

/**
 * Auslosung mit Lostöpfen: Aus jedem Topf kommt reihum je ein Team in jede Gruppe, so weit es
 * geht. Ein Topf mit mehr Teams als Gruppen verteilt den Rest auf Gruppen mit wenigsten Teams
 * aus diesem Topf. Volle Gruppen werden übersprungen.
 */
export function drawWithPots(input: PotDrawInput): GroupAssignment {
  const teams = uniqueSorted(input.teamIds);
  const sizes = groupSizesFor(teams.length, input);
  const rng = createRng(input.seed);
  const known = new Set(teams);
  const placed = new Set<string>();
  const pots: string[][] = [];
  for (const pot of input.pots) {
    const clean = uniqueSorted(pot).filter((id) => known.has(id) && !placed.has(id));
    clean.forEach((id) => placed.add(id));
    if (clean.length > 0) pots.push(clean);
  }
  const rest = teams.filter((id) => !placed.has(id));
  if (rest.length > 0) pots.push(rest);

  const groups: GroupAssignment = sizes.map(() => []);
  for (const pot of pots) {
    const fromPot = sizes.map(() => 0);
    for (const teamId of shuffled(pot, rng)) {
      const g = pickGroup(groups, sizes, fromPot, rng);
      groups[g]!.push(teamId);
      fromPot[g]!++;
    }
  }
  return groups;
}

/**
 * Freie Gruppe mit den wenigsten Teams aus dem aktuellen Topf, dann mit den meisten freien Plätzen
 * (damit kleine Gruppen für spätere Töpfe Platz behalten), sonst Zufall.
 */
function pickGroup(groups: GroupAssignment, sizes: readonly number[], fromPot: readonly number[], rng: Rng): number {
  let best: number[] = [];
  let bestKey: [number, number] | null = null;
  groups.forEach((group, g) => {
    const free = sizes[g]! - group.length;
    if (free <= 0) return;
    const key: [number, number] = [fromPot[g]!, -free];
    if (bestKey === null || key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
      best = [g];
      bestKey = key;
    } else if (key[0] === bestKey[0] && key[1] === bestKey[1]) {
      best.push(g);
    }
  });
  return best[Math.floor(rng() * best.length)]!;
}

/**
 * Prüft eine Einteilung (von Hand gezogen oder nachträglich getauscht).
 * Fehler: Team fehlt, doppelt, unbekannt, falsche Gruppenzahl, Gruppe mit weniger als 2 Teams.
 * Warnungen: Größen weichen von der Vorgabe ab, Lostopf-Teams in derselben Gruppe.
 */
export function checkGroupAssignment(
  assignment: GroupAssignment,
  input: Omit<DrawInput, 'seed'> & { pots?: readonly (readonly string[])[]; teamNames?: ReadonlyMap<string, string> },
): DrawCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const label = (id: string) => input.teamNames?.get(id) ?? id;
  const known = new Set(input.teamIds);
  const seen = new Map<string, number>();

  if (assignment.length !== input.groupCount) errors.push(`Es gibt ${assignment.length} Gruppen statt ${input.groupCount}.`);
  assignment.forEach((group, g) => {
    if (group.length < 2) errors.push(`Gruppe ${groupLetter(g)} braucht mindestens 2 Teams.`);
    for (const id of group) {
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
  });
  for (const [id, n] of seen) {
    if (!known.has(id)) errors.push(`${label(id)} ist nicht angemeldet.`);
    else if (n > 1) errors.push(`${label(id)} steht in mehreren Gruppen.`);
  }
  for (const id of uniqueSorted(input.teamIds)) {
    if (!seen.has(id)) errors.push(`${label(id)} ist noch keiner Gruppe zugeteilt.`);
  }

  if (errors.length === 0) {
    const wanted = groupSizesFor(known.size, input);
    const actual = assignment.map((g) => g.length);
    if (input.groupSizes) {
      if (actual.some((n, g) => n !== wanted[g])) {
        warnings.push(`Die Gruppengrößen (${actual.join('-')}) weichen von der Vorgabe (${wanted.join('-')}) ab.`);
      }
    } else if (Math.max(...actual) - Math.min(...actual) > 1) {
      warnings.push(`Die Gruppen sind ungleich groß (${actual.join('-')}).`);
    }
    for (const [p, pot] of (input.pots ?? []).entries()) {
      assignment.forEach((group, g) => {
        const same = group.filter((id) => pot.includes(id));
        const allowed = Math.ceil(pot.length / assignment.length);
        if (same.length > allowed) {
          warnings.push(`In Gruppe ${groupLetter(g)} sind ${same.length} Teams aus Topf ${p + 1}: ${same.map(label).join(', ')}.`);
        }
      });
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

/** Sortiert und entfernt Doppelte, damit die Reihenfolge der Eingabe das Los nicht beeinflusst. */
function uniqueSorted(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}
