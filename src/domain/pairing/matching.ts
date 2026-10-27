import { maxWeightMatching, type WeightedEdge } from './blossom';

/** Kosten einer möglichen Paarung; `null` = Kante ist verboten. */
export type EdgeCostFn = (i: number, j: number) => number | null;

export interface MatchingResult {
  pairs: Array<[number, number]>;
  cost: number;
}

/**
 * Kosten werden für den Blossom-Algorithmus auf ganze Zahlen skaliert, damit er exakt
 * rechnet. 1e-5 Auflösung reicht weit unter jede fachlich relevante Kostendifferenz.
 */
const COST_SCALE = 100_000;

/**
 * Minimum-Cost-Perfect-Matching im allgemeinen Graphen (exakt, kein Greedy).
 *
 * Umsetzung: Gewicht = BIG − Kosten, dann Maximum-Weight-Matching mit maximaler
 * Kardinalität. Da jede Kante positives Gewicht hat und nur perfekte Matchings die
 * volle Kardinalität erreichen, ist das Ergebnis unter allen perfekten Matchings
 * das kostenminimale. Gibt `null` zurück, wenn kein perfektes Matching existiert
 * (ungerade Knotenzahl oder zu viele verbotene Kanten).
 */
export function minCostPerfectMatching(vertexCount: number, cost: EdgeCostFn): MatchingResult | null {
  if (vertexCount === 0) return { pairs: [], cost: 0 };
  if (vertexCount % 2 === 1) return null;

  const raw: Array<{ i: number; j: number; cost: number; scaled: number }> = [];
  let maxScaled = 0;
  for (let i = 0; i < vertexCount; i++) {
    for (let j = i + 1; j < vertexCount; j++) {
      const c = cost(i, j);
      if (c === null) continue;
      if (!Number.isFinite(c) || c < 0) throw new Error(`Ungültige Kantenkosten ${c} für ${i}-${j}`);
      const scaled = Math.round(c * COST_SCALE);
      if (scaled > maxScaled) maxScaled = scaled;
      raw.push({ i, j, cost: c, scaled });
    }
  }
  const big = maxScaled + 1;
  const edges: WeightedEdge[] = raw.map((e) => ({ i: e.i, j: e.j, weight: big - e.scaled }));
  const mate = maxWeightMatching(vertexCount, edges, true);

  const pairs: Array<[number, number]> = [];
  for (let v = 0; v < vertexCount; v++) {
    const m = mate[v]!;
    if (m === -1) return null;
    if (v < m) pairs.push([v, m]);
  }
  let total = 0;
  const costOf = new Map<number, number>();
  for (const e of raw) costOf.set(e.i * vertexCount + e.j, e.cost);
  for (const [a, b] of pairs) total += costOf.get(a * vertexCount + b)!;
  return { pairs, cost: total };
}
