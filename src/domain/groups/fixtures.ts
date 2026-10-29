// Spielpaarungen „jeder gegen jeden“ innerhalb einer Gruppe, optional mit Rückspiel.
// Rundenbildung nach dem Kreisverfahren (jedes Team höchstens einmal pro Runde). Die Reihenfolge
// der Spiele wird so gewählt, dass kein Team zwei Spiele direkt hintereinander hat, wenn es sich
// vermeiden lässt. Uhrzeit und Feld verteilt der Spielplan (src/domain/schedule).

export interface GroupFixture {
  groupIndex: number;
  /** 1-basiert innerhalb der Gruppe; bei Rückspiel laufen die Runden weiter. */
  round: number;
  /** 0-basierte Position in der Spielfolge der Gruppe. */
  order: number;
  /** 1 = Hinspiel, 2 = Rückspiel (Seiten getauscht). */
  leg: 1 | 2;
  teamAId: string;
  teamBId: string;
}

type Pair = [string, string];

/** Runden nach dem Kreisverfahren; bei ungerader Zahl hat pro Runde ein Team frei. */
export function roundRobinRounds(teamIds: readonly string[]): Pair[][] {
  const slots: (string | null)[] = [...teamIds];
  if (slots.length < 2) return [];
  if (slots.length % 2 === 1) slots.push(null);
  const n = slots.length;
  const rounds: Pair[][] = [];
  for (let r = 0; r < n - 1; r++) {
    const round: Pair[] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = slots[i];
      const b = slots[n - 1 - i];
      if (a == null || b == null) continue;
      // Das feste Team wechselt die Seite jede Runde, damit A- und B-Seite verteilt sind.
      round.push(i === 0 && r % 2 === 1 ? [b, a] : [a, b]);
    }
    rounds.push(round);
    slots.splice(1, 0, slots.pop()!);
  }
  return rounds;
}

const shares = (x: Pair, y: Pair) => x[0] === y[0] || x[0] === y[1] || x[1] === y[0] || x[1] === y[1];

/**
 * Ordnet die Spiele jeder Runde so, dass das letzte Spiel einer Runde und das erste der nächsten
 * kein gemeinsames Team haben. Innerhalb einer Runde spielt ohnehin jedes Team höchstens einmal,
 * also zählen nur die Übergänge. Dynamische Programmierung über (Runde, letztes Spiel).
 */
function orderRounds(rounds: readonly Pair[][]): { rounds: Pair[][]; cost: number } {
  if (rounds.length === 0) return { rounds: [], cost: 0 };
  // cost[r][l] = minimale Anzahl „direkt hintereinander“ bis Runde r, wenn Runde r mit Spiel l endet.
  const cost: number[][] = [];
  const choice: { first: number; prevLast: number }[][] = [];
  rounds.forEach((round, r) => {
    cost.push(round.map(() => Infinity));
    choice.push(round.map(() => ({ first: 0, prevLast: -1 })));
    for (let last = 0; last < round.length; last++) {
      for (let first = 0; first < round.length; first++) {
        if (round.length > 1 && first === last) continue;
        if (round.length === 1 && first !== last) continue;
        if (r === 0) {
          if (cost[0]![last]! > 0) {
            cost[0]![last] = 0;
            choice[0]![last] = { first, prevLast: -1 };
          }
          continue;
        }
        const prev = rounds[r - 1]!;
        for (let p = 0; p < prev.length; p++) {
          const c = cost[r - 1]![p]! + (shares(prev[p]!, round[first]!) ? 1 : 0);
          if (c < cost[r]![last]!) {
            cost[r]![last] = c;
            choice[r]![last] = { first, prevLast: p };
          }
        }
      }
    }
  });
  const result: Pair[][] = new Array<Pair[]>(rounds.length);
  const lastCosts = cost[rounds.length - 1]!;
  const best = Math.min(...lastCosts);
  let last = lastCosts.indexOf(best);
  for (let r = rounds.length - 1; r >= 0; r--) {
    const round = rounds[r]!;
    const { first, prevLast } = choice[r]![last]!;
    const middle = round.filter((_, i) => i !== first && i !== last);
    result[r] = round.length === 1 ? [round[0]!] : [round[first]!, ...middle, round[last]!];
    last = prevLast;
  }
  return { rounds: result, cost: best };
}

/** Alle Reihenfolgen von 0 … n-1 (nur für kleine n). */
function permutations(n: number): number[][] {
  if (n <= 1) return [[...Array(n).keys()]];
  return permutations(n - 1).flatMap((p) => Array.from({ length: n }, (_, i) => [...p.slice(0, i), n - 1, ...p.slice(i)]));
}

/** Rückrunden mit höchstens so vielen Runden dürfen umgestellt werden (5 Runden = 120 Varianten). */
const MAX_PERMUTED_ROUNDS = 5;

/** Alle Spiele einer Gruppe in Spielfolge. */
export function groupFixtures(groupIndex: number, teamIds: readonly string[], doubleRoundRobin = false): GroupFixture[] {
  const first = roundRobinRounds(teamIds);
  const second = first.map((pairs) => pairs.map(([a, b]): Pair => [b, a]));
  let best = orderRounds(first);
  if (doubleRoundRobin) {
    // Bei kleinen Gruppen hilft eine andere Reihenfolge der Rückrunde gegen „direkt hintereinander“.
    const orders = second.length <= MAX_PERMUTED_ROUNDS ? permutations(second.length) : [[...second.keys()]];
    best = { rounds: [], cost: Infinity };
    for (const order of orders) {
      const candidate = orderRounds([...first, ...order.map((i) => second[i]!)]);
      if (candidate.cost < best.cost) best = candidate;
      if (best.cost === 0) break;
    }
  }
  const fixtures: GroupFixture[] = [];
  best.rounds.forEach((pairs, r) => {
    const leg = r < first.length ? 1 : 2;
    for (const [teamAId, teamBId] of pairs) {
      fixtures.push({ groupIndex, round: r + 1, order: fixtures.length, leg, teamAId, teamBId });
    }
  });
  return fixtures;
}

/** Spiele aller Gruppen eines Abschnitts. */
export function stageFixtures(groups: readonly (readonly string[])[], doubleRoundRobin = false): GroupFixture[] {
  return groups.flatMap((teamIds, g) => groupFixtures(g, teamIds, doubleRoundRobin));
}

/** Anzahl „direkt hintereinander“ in einer Spielfolge (für Tests und Hinweise). */
export function backToBackCount(fixtures: readonly Pick<GroupFixture, 'teamAId' | 'teamBId'>[]): number {
  let count = 0;
  for (let i = 1; i < fixtures.length; i++) {
    const a = fixtures[i - 1]!;
    const b = fixtures[i]!;
    if (shares([a.teamAId, a.teamBId], [b.teamAId, b.teamBId])) count++;
  }
  return count;
}
