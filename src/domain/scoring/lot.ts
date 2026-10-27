// Deterministischer Losentscheid (Spezifikation §6.2, Punkt 5).
// Jedes Team erhält aus Seed und Team-ID eine feste Losnummer. Dieselben Daten ergeben
// immer dieselbe Reihenfolge, unabhängig davon, in welcher Reihenfolge Teams oder Spiele vorliegen.

/** cyrb53: schneller, gut streuender 53-Bit-String-Hash (kein Kryptografie-Ersatz). */
function cyrb53(input: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function lotNumber(seed: string, teamId: string): number {
  return cyrb53(`${seed}\u0000${teamId}`);
}

/** Kleinere Losnummer steht weiter oben; bei (praktisch ausgeschlossener) Kollision entscheidet die ID. */
export function compareByLot(seed: string, aId: string, bId: string): number {
  const diff = lotNumber(seed, aId) - lotNumber(seed, bId);
  if (diff !== 0) return diff < 0 ? -1 : 1;
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}
