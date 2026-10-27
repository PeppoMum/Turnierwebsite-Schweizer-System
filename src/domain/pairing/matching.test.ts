// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { maxWeightMatching } from './blossom';
import { minCostPerfectMatching } from './matching';
import { createRng } from './random';

/** Exaktes Referenzverfahren: Bitmasken-DP über alle perfekten Matchings. */
function bruteForceMinCost(n: number, cost: (i: number, j: number) => number | null): number | null {
  const memo = new Map<number, number | null>();
  const full = (1 << n) - 1;
  const go = (mask: number): number | null => {
    if (mask === full) return 0;
    if (memo.has(mask)) return memo.get(mask)!;
    let i = 0;
    while (mask & (1 << i)) i++;
    let best: number | null = null;
    for (let j = i + 1; j < n; j++) {
      if (mask & (1 << j)) continue;
      const c = cost(i, j);
      if (c === null) continue;
      const rest = go(mask | (1 << i) | (1 << j));
      if (rest === null) continue;
      if (best === null || c + rest < best) best = c + rest;
    }
    memo.set(mask, best);
    return best;
  };
  return go(0);
}

function bruteForceMaxWeight(n: number, w: (i: number, j: number) => number | null): number {
  const memo = new Map<number, number>();
  const go = (mask: number): number => {
    let i = 0;
    while (i < n && mask & (1 << i)) i++;
    if (i >= n) return 0;
    if (memo.has(mask)) return memo.get(mask)!;
    let best = go(mask | (1 << i)); // i bleibt ungepaart
    for (let j = i + 1; j < n; j++) {
      if (mask & (1 << j)) continue;
      const c = w(i, j);
      if (c === null) continue;
      best = Math.max(best, c + go(mask | (1 << i) | (1 << j)));
    }
    memo.set(mask, best);
    return best;
  };
  return go(0);
}

describe('maxWeightMatching (Blossom)', () => {
  it('löst bekannte Fälle aus der Referenzimplementierung', () => {
    expect(maxWeightMatching(0, [], false)).toEqual([]);
    expect(maxWeightMatching(2, [{ i: 0, j: 1, weight: 1 }], false)).toEqual([1, 0]);
    expect(
      maxWeightMatching(
        4,
        [
          { i: 1, j: 2, weight: 10 },
          { i: 2, j: 3, weight: 11 },
        ],
        false,
      ),
    ).toEqual([-1, -1, 3, 2]);
    // maxCardinality erzwingt zwei Kanten statt der schwersten Einzelkante (mwmatching test14)
    expect(
      maxWeightMatching(
        5,
        [
          { i: 1, j: 2, weight: 5 },
          { i: 2, j: 3, weight: 11 },
          { i: 3, j: 4, weight: 5 },
        ],
        true,
      ),
    ).toEqual([-1, 2, 1, 4, 3]);
    // Blüte mit anschließender Expansion (Testfall 'S-blossom' aus mwmatching)
    expect(
      maxWeightMatching(
        7,
        [
          { i: 1, j: 2, weight: 8 },
          { i: 1, j: 3, weight: 9 },
          { i: 2, j: 3, weight: 10 },
          { i: 3, j: 4, weight: 7 },
          { i: 1, j: 6, weight: 5 },
          { i: 4, j: 5, weight: 6 },
        ],
        false,
      ),
    ).toEqual([-1, 6, 3, 2, 5, 4, 1]);
  });

  it('stimmt auf Tausenden Zufallsgraphen mit dem exakten DP überein', () => {
    const rng = createRng('blossom-vs-dp');
    for (let trial = 0; trial < 3000; trial++) {
      const n = 1 + Math.floor(rng() * 12);
      const density = 0.3 + rng() * 0.7;
      const smallWeights = rng() < 0.5;
      const w: Array<number | null> = new Array(n * n).fill(null);
      const edges = [];
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          if (rng() > density) continue;
          const weight = smallWeights ? 1 + Math.floor(rng() * 4) : 1 + Math.floor(rng() * 1000);
          w[i * n + j] = weight;
          edges.push({ i, j, weight });
        }
      }
      const mate = maxWeightMatching(n, edges, false);
      let total = 0;
      for (let v = 0; v < n; v++) {
        const m = mate[v]!;
        if (m === -1) continue;
        expect(mate[m]).toBe(v);
        if (v < m) {
          expect(w[v * n + m]).not.toBeNull();
          total += w[v * n + m]!;
        }
      }
      expect(total).toBe(bruteForceMaxWeight(n, (i, j) => w[i * n + j]!));
    }
  });
});

describe('minCostPerfectMatching', () => {
  it('findet auf Zufallsinstanzen exakt das Kostenminimum', () => {
    const rng = createRng('mcpm-vs-dp');
    for (let trial = 0; trial < 2000; trial++) {
      const n = 2 * (1 + Math.floor(rng() * 7)); // 2..14
      const forbid = rng() < 0.3 ? 0.4 : 0;
      const c: Array<number | null> = new Array(n * n).fill(null);
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          c[i * n + j] = rng() < forbid ? null : Math.round(rng() * 10000) / 100;
        }
      }
      const cost = (i: number, j: number) => c[Math.min(i, j) * n + Math.max(i, j)]!;
      const expected = bruteForceMinCost(n, cost);
      const result = minCostPerfectMatching(n, cost);
      if (expected === null) {
        expect(result).toBeNull();
        continue;
      }
      expect(result).not.toBeNull();
      expect(result!.cost).toBeCloseTo(expected, 6);
      const used = new Set<number>();
      for (const [a, b] of result!.pairs) {
        expect(used.has(a) || used.has(b)).toBe(false);
        used.add(a);
        used.add(b);
      }
      expect(used.size).toBe(n);
    }
  });

  it('meldet ungerade Knotenzahl und unmögliche Graphen', () => {
    expect(minCostPerfectMatching(3, () => 1)).toBeNull();
    // 4 Knoten, Knoten 0 darf mit niemandem
    expect(minCostPerfectMatching(4, (i) => (i === 0 ? null : 1))).toBeNull();
  });
});
