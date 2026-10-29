// Zwischenrunde: neue Gruppen „über Kreuz“ aus den Plätzen der Vorrunde bilden.
// Beispiel 4 Gruppen, Platz 1 und 2, 2 neue Gruppen:
//   E: 1. A, 2. B, 1. C, 2. D    F: 1. B, 2. A, 1. D, 2. C
// Teams aus derselben Vorrunden-Gruppe kommen nicht zusammen, solange es genug neue Gruppen gibt.
// Die Platzhalter löst die Weiterkommens-Logik (src/domain/format/resolve.ts) auf.

import type { EntryRule, SlotRef } from '../format/types';
import { evenGroupSizes } from './sizes';

interface Entrant {
  slot: SlotRef;
  /** Vorrunden-Gruppe, `null` bei „die besten N“ (Gruppe steht noch nicht fest). */
  fromGroup: number | null;
  place: number;
}

/**
 * Verteilt die Plätze aus `entry` auf `newGroupCount` gleich große Gruppen. Reihum nach Platz und
 * Gruppe; jedes Team geht in eine Gruppe ohne Team aus seiner Vorrunden-Gruppe und mit den wenigsten
 * Teams, bevorzugt in die Gruppe (Vorrunden-Gruppe + Platzindex) mod Anzahl, was das klassische
 * Über-Kreuz-Muster ergibt. „Die besten N eines Platzes“ werden danach aufgefüllt.
 */
export function crossoverGroups(entry: EntryRule, previousGroupCount: number, newGroupCount: number): SlotRef[][] {
  const stageId = entry.fromStageId;
  const fixed: Entrant[] = [];
  entry.places.forEach((place) => {
    for (let g = 0; g < previousGroupCount; g++) {
      fixed.push({ slot: { kind: 'group_place', stageId, group: g, place }, fromGroup: g, place });
    }
  });
  const best: Entrant[] = (entry.best ?? []).flatMap(({ place, count }) =>
    Array.from({ length: count }, (_, i): Entrant => ({ slot: { kind: 'best_of_place', stageId, place, rank: i + 1 }, fromGroup: null, place })),
  );
  const capacity = evenGroupSizes(fixed.length + best.length, newGroupCount);
  const groups: Entrant[][] = Array.from({ length: newGroupCount }, () => []);

  const placeIndex = new Map(entry.places.map((p, k) => [p, k]));
  // Höchstens so viele Teams einer Vorrunden-Gruppe pro neuer Gruppe (1, wenn genug neue Gruppen da sind).
  const limit = Math.ceil(entry.places.length / newGroupCount);
  const picks = [...fixed, ...best];

  /** Kandidaten-Gruppen für einen Platz, beste zuerst: wenigste Teams aus derselben Vorrunden-Gruppe, wenigste Teams, Über-Kreuz-Muster. */
  const candidates = (pick: Entrant): number[] => {
    const preferred = pick.fromGroup === null ? -1 : (pick.fromGroup + placeIndex.get(pick.place)!) % newGroupCount;
    const keyed = groups.map((group, i) => ({
      i,
      clash: pick.fromGroup === null ? 0 : group.filter((p) => p.fromGroup === pick.fromGroup).length,
      size: group.length,
      pref: i === preferred ? 0 : 1,
    }));
    return keyed
      .filter((k) => k.size < capacity[k.i]!)
      .sort((a, b) => a.clash - b.clash || a.size - b.size || a.pref - b.pref || a.i - b.i)
      .map((k) => k.i);
  };

  // Suche mit Zurückgehen, damit die Obergrenze auch bei knappen Gruppengrößen hält.
  let budget = 50_000;
  const place = (index: number): boolean => {
    if (index === picks.length) return true;
    if (--budget < 0) return false;
    const pick = picks[index]!;
    for (const g of candidates(pick)) {
      const group = groups[g]!;
      if (pick.fromGroup !== null && group.filter((p) => p.fromGroup === pick.fromGroup).length >= limit) continue;
      group.push(pick);
      if (place(index + 1)) return true;
      group.pop();
    }
    return false;
  };
  if (!place(0)) {
    // Kommt praktisch nicht vor: dann einfach der Reihe nach die beste freie Gruppe.
    groups.forEach((g) => (g.length = 0));
    for (const pick of picks) groups[candidates(pick)[0]!]!.push(pick);
  }

  // Anzeige-Reihenfolge wie im Beispiel: nach Vorrunden-Gruppe, dann Platz; „die Besten“ zum Schluss.
  return groups.map((group) =>
    [...group]
      .sort((a, b) => (a.fromGroup ?? Infinity) - (b.fromGroup ?? Infinity) || a.place - b.place)
      .map((p) => p.slot),
  );
}
