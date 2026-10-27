/**
 * Reproduzierbarer Zufall für Auslosungen.
 *
 * Alle Zufallsentscheidungen des Pairers laufen über diesen Generator, damit
 * dieselbe Eingabe mit demselben `randomSeed` immer dieselbe Paarung ergibt
 * (Spezifikation §7.1). `Math.random` wird im Pairing nie verwendet.
 */

export type Rng = () => number;

/** FNV-1a-Hash eines Strings auf 32 Bit. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32: kleiner, schneller PRNG mit gleichverteilten Werten in [0, 1). */
export function createRng(seed: string | number): Rng {
  let state = typeof seed === 'number' ? seed >>> 0 : hashString(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Leitet aus einem Seed einen unabhängigen Unter-Seed ab (z. B. pro Runde). */
export function deriveSeed(seed: string, ...parts: Array<string | number>): string {
  return [seed, ...parts].join('::');
}

/** Fisher-Yates-Shuffle auf einer Kopie. */
export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}
