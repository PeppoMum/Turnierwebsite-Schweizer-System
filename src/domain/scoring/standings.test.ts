import type { TieBreaker } from '../types';
import { calculateStandings, compareQuotient, type StandingsInput, type TeamStanding } from './standings';
import { open, result, team, teams } from './testUtils';

function standings(input: Partial<StandingsInput> & Pick<StandingsInput, 'teams' | 'matches'>): TeamStanding[] {
  return calculateStandings({ lotSeed: 'test', ...input });
}

function order(rows: TeamStanding[], only?: string[]): string[] {
  const ids = rows.map((r) => r.teamId);
  return only ? ids.filter((id) => only.includes(id)) : ids;
}

function row(rows: TeamStanding[], id: string): TeamStanding {
  const found = rows.find((r) => r.teamId === id);
  if (!found) throw new Error(`Team ${id} fehlt in der Tabelle`);
  return found;
}

/** Erzeugt für jedes Spiel einen eigenen Füllgegner, damit Quotienten gezielt eingestellt werden können. */
function withFillers(spec: Array<[string, number, number]>): { fillerIds: string[]; matches: ReturnType<typeof result>[] } {
  const fillerIds: string[] = [];
  const matches = spec.map(([id, gf, ga], i) => {
    const filler = `F${i}`;
    fillerIds.push(filler);
    return result(id, gf, ga, filler);
  });
  return { fillerIds, matches };
}

describe('Punkte und Statistik', () => {
  it('wertet Sieg 3, Remis 1, Niederlage 0 und zählt Tore', () => {
    const rows = standings({
      teams: teams('A', 'B', 'C'),
      matches: [result('A', 2, 0, 'B'), result('B', 1, 1, 'C'), result('C', 3, 1, 'A')],
    });
    expect(row(rows, 'A')).toMatchObject({ played: 2, wins: 1, draws: 0, losses: 1, points: 3, goalsFor: 3, goalsAgainst: 3, goalDiff: 0 });
    expect(row(rows, 'B')).toMatchObject({ played: 2, wins: 0, draws: 1, losses: 1, points: 1, goalsFor: 1, goalsAgainst: 3, goalDiff: -2 });
    expect(row(rows, 'C')).toMatchObject({ played: 2, wins: 1, draws: 1, losses: 0, points: 4, goalsFor: 4, goalsAgainst: 2, goalDiff: 2 });
    expect(row(rows, 'C').quotient).toBe(2);
    expect(order(rows)).toEqual(['C', 'A', 'B']);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('zählt nur abgeschlossene Spiele mit gültigen Toren', () => {
    const rows = standings({
      teams: teams('A', 'B'),
      matches: [
        open('A', 'B', 'not_played'),
        open('A', 'B', 'cancelled'),
        open('A', 'B', 'draft'),
        open('A', 'B', 'scheduled'),
        { ...open('A', 'B', 'live'), goalsA: 1, goalsB: 0 },
        { ...open('A', 'B', 'not_played'), goalsA: 3, goalsB: 0 },
        { ...open('A', 'B', 'completed') },
        { ...open('A', 'B', 'completed'), goalsA: 1 },
        { ...open('A', 'B', 'completed'), goalsA: -1, goalsB: 0 },
        { ...open('A', 'B', 'completed'), goalsA: 1.5, goalsB: 0 },
        { ...open('A', 'B', 'completed'), goalsA: Number.NaN, goalsB: 0 },
        result('A', 1, 0, 'A'),
        result('A', 1, 0, 'Unbekannt'),
      ],
    });
    for (const r of rows) {
      expect(r).toMatchObject({ played: 0, points: 0, goalsFor: 0, goalsAgainst: 0, quotient: null });
    }
  });

  it('gibt Freilosen weder Spiel noch Punkte noch Tore', () => {
    const rows = standings({
      teams: teams('A', 'B', 'C'),
      matches: [result('A', 1, 0, 'B')],
      byes: [{ teamId: 'C', roundId: 'r1' }],
    });
    expect(row(rows, 'C')).toMatchObject({ played: 0, points: 0, goalsFor: 0, byes: 1, quotient: null });
  });

  it('berücksichtigt mit throughRound nur Spiele und Freilose bis zu dieser Runde', () => {
    const input = {
      teams: teams('A', 'B', 'C'),
      matches: [result('A', 1, 0, 'B', 1), result('B', 4, 0, 'A', 2), result('C', 1, 0, 'A', 3)],
      byes: [
        { teamId: 'C', roundId: 'r1' },
        { teamId: 'C', roundId: 'r2' },
      ],
      rounds: [
        { id: 'r1', number: 1 },
        { id: 'r2', number: 2 },
      ],
    };
    const r1 = standings({ ...input, throughRound: 1 });
    expect(row(r1, 'A')).toMatchObject({ played: 1, points: 3 });
    expect(row(r1, 'C')).toMatchObject({ played: 0, byes: 1 });
    const r2 = standings({ ...input, throughRound: 2 });
    expect(row(r2, 'B')).toMatchObject({ played: 2, points: 3, goalDiff: 3 });
    expect(row(r2, 'C')).toMatchObject({ played: 0, byes: 2 });
  });
});

describe('Quotient als Hauptkriterium', () => {
  it('setzt 17/7 vor 18/8 (Beispiel E der Spezifikation)', () => {
    const { fillerIds, matches } = withFillers([
      ...Array.from({ length: 5 }, () => ['X', 1, 0] as [string, number, number]),
      ['X', 0, 0],
      ['X', 0, 0],
      ...Array.from({ length: 6 }, () => ['Y', 1, 0] as [string, number, number]),
      ['Y', 0, 1],
      ['Y', 0, 1],
    ]);
    const rows = standings({ teams: teams('X', 'Y', ...fillerIds), matches });
    expect(row(rows, 'X')).toMatchObject({ points: 17, played: 7 });
    expect(row(rows, 'Y')).toMatchObject({ points: 18, played: 8 });
    expect(row(rows, 'X').quotient).toBeCloseTo(2.42857, 5);
    expect(row(rows, 'Y').quotient).toBe(2.25);
    expect(order(rows, ['X', 'Y'])).toEqual(['X', 'Y']);
    expect(row(rows, 'Y').decidedBy).toBe('quotient');
  });

  it('vergleicht exakt per Kreuzmultiplikation', () => {
    expect(compareQuotient({ points: 17, played: 7 }, { points: 18, played: 8 })).toBe(1);
    expect(compareQuotient({ points: 6, played: 3 }, { points: 4, played: 2 })).toBe(0);
    expect(compareQuotient({ points: 1, played: 3 }, { points: 2, played: 6 })).toBe(0);
    // 0,1 + 0,2 ≠ 0,3 in Fließkomma; hier gibt es keine Rundung.
    expect(compareQuotient({ points: 10, played: 30 }, { points: 1, played: 3 })).toBe(0);
  });

  it('setzt Teams ohne Spiel hinter alle Teams mit Quotient, auch hinter 0,000', () => {
    const rows = standings({
      teams: teams('Neu', 'A', 'B'),
      matches: [result('A', 1, 0, 'B')],
    });
    expect(order(rows)).toEqual(['A', 'B', 'Neu']);
    expect(row(rows, 'Neu').quotient).toBeNull();
    expect(row(rows, 'B').quotient).toBe(0);
  });

  it('behandelt gleiche Quoten aus verschiedenen Brüchen als Gleichstand', () => {
    // A: 6 Punkte aus 3 Spielen, B: 4 Punkte aus 2 Spielen -> beide 2,0; B hat die bessere Tordifferenz.
    const { fillerIds, matches } = withFillers([
      ['A', 1, 0],
      ['A', 1, 0],
      ['A', 0, 1],
      ['B', 3, 0],
      ['B', 0, 0],
    ]);
    const rows = standings({ teams: teams('A', 'B', ...fillerIds), matches, tieBreakers: ['goal_diff'] });
    expect(row(rows, 'A').quotient).toBe(row(rows, 'B').quotient);
    expect(order(rows, ['A', 'B'])).toEqual(['B', 'A']);
    expect(row(rows, 'A').decidedBy).toBe('goal_diff');
  });
});

describe('Feinwertung', () => {
  it('direkter Vergleich bei zwei Teams schlägt die Tordifferenz', () => {
    const { fillerIds, matches } = withFillers([
      ['A', 0, 5],
      ['B', 5, 0],
    ]);
    const rows = standings({ teams: teams('A', 'B', ...fillerIds), matches: [result('A', 1, 0, 'B'), ...matches] });
    expect(row(rows, 'A').quotient).toBe(row(rows, 'B').quotient);
    expect(order(rows, ['A', 'B'])).toEqual(['A', 'B']);
    expect(row(rows, 'B').decidedBy).toBe('head_to_head');
  });

  it('geht bei Remis im direkten Vergleich zur Tordifferenz', () => {
    const { fillerIds, matches } = withFillers([
      ['A', 1, 0],
      ['B', 4, 0],
    ]);
    const rows = standings({ teams: teams('A', 'B', ...fillerIds), matches: [result('A', 2, 2, 'B'), ...matches] });
    expect(order(rows, ['A', 'B'])).toEqual(['B', 'A']);
    expect(row(rows, 'A').decidedBy).toBe('goal_diff');
  });

  it('geht bei ausgeglichenen Hin- und Rückspielen zur Tordifferenz', () => {
    const rows = standings({
      teams: teams('A', 'B'),
      matches: [result('A', 1, 0, 'B'), result('B', 3, 0, 'A', 2)],
    });
    expect(order(rows)).toEqual(['B', 'A']);
    expect(row(rows, 'A').decidedBy).toBe('goal_diff');
  });

  it('überspringt den direkten Vergleich, wenn die Teams nicht gegeneinander gespielt haben', () => {
    const { fillerIds, matches } = withFillers([
      ['A', 1, 0],
      ['B', 2, 0],
    ]);
    const rows = standings({ teams: teams('A', 'B', ...fillerIds), matches });
    expect(order(rows, ['A', 'B'])).toEqual(['B', 'A']);
    expect(row(rows, 'A').decidedBy).toBe('goal_diff');
  });

  it('zählt ein nicht ausgetragenes direktes Duell nicht als direkten Vergleich', () => {
    const { fillerIds, matches } = withFillers([
      ['A', 1, 0],
      ['B', 2, 0],
    ]);
    const rows = standings({
      teams: teams('A', 'B', ...fillerIds),
      matches: [{ ...open('A', 'B', 'not_played'), goalsA: 5, goalsB: 0 }, ...matches],
    });
    expect(order(rows, ['A', 'B'])).toEqual(['B', 'A']);
  });

  it('wertet eine vollständige Mini-Liga aus drei Teams', () => {
    // Mini-Liga: A 6, B 3, C 0. Gesamt alle 6 Punkte aus 4 Spielen; C hat die beste Tordifferenz.
    const { fillerIds, matches } = withFillers([
      ['A', 0, 1],
      ['A', 0, 1],
      ['B', 1, 0],
      ['B', 0, 1],
      ['C', 5, 0],
      ['C', 5, 0],
    ]);
    const rows = standings({
      teams: teams('A', 'B', 'C', ...fillerIds),
      matches: [result('A', 1, 0, 'B'), result('B', 1, 0, 'C'), result('A', 1, 0, 'C'), ...matches],
    });
    expect(new Set(['A', 'B', 'C'].map((id) => row(rows, id).quotient)).size).toBe(1);
    expect(order(rows, ['A', 'B', 'C'])).toEqual(['A', 'B', 'C']);
    expect(row(rows, 'B').decidedBy).toBe('head_to_head');
    expect(row(rows, 'C').decidedBy).toBe('head_to_head');
  });

  it('überspringt den direkten Vergleich bei unvollständiger Mini-Liga komplett', () => {
    // A schlug B, aber C hat gegen keinen der beiden gespielt -> Tordifferenz entscheidet für alle drei.
    const { fillerIds, matches } = withFillers([
      ['A', 0, 1],
      ['B', 5, 0],
      ['C', 2, 0],
      ['C', 0, 1],
    ]);
    const rows = standings({
      teams: teams('A', 'B', 'C', ...fillerIds),
      matches: [result('A', 1, 0, 'B'), ...matches],
    });
    expect(new Set(['A', 'B', 'C'].map((id) => row(rows, id).quotient)).size).toBe(1);
    expect(order(rows, ['A', 'B', 'C'])).toEqual(['B', 'C', 'A']);
    expect(row(rows, 'A').decidedBy).toBe('goal_diff');
  });

  it('überspringt den direkten Vergleich, wenn Paare unterschiedlich oft gespielt haben', () => {
    // A-B zweimal, A-C und B-C je einmal, alles Remis: alle drei Quotient 1,0.
    // Als Mini-Liga gewertet hätte C nur 2 statt 3 Punkte – das wäre nicht vergleichbar.
    const rows = standings({
      teams: teams('A', 'B', 'C'),
      matches: [result('A', 0, 0, 'B'), result('B', 0, 0, 'A', 2), result('A', 0, 0, 'C'), result('B', 0, 0, 'C', 2)],
      tieBreakers: ['head_to_head'],
    });
    expect(new Set(rows.map((r) => r.quotient))).toEqual(new Set([1]));
    expect(rows.slice(1).map((r) => r.decidedBy)).toEqual(['lot', 'lot']);
  });

  it('wendet den direkten Vergleich erneut auf die verbleibenden Gleichstehenden an', () => {
    // Mini-Liga: D 7, A 4, B 3, C 3. B schlug C direkt, C hat aber die bessere Tordifferenz.
    const { fillerIds, matches } = withFillers([
      ['D', 0, 1],
      ['D', 0, 1],
      ['A', 1, 0],
      ['A', 0, 1],
      ['B', 1, 0],
      ['B', 0, 0],
      ['C', 5, 0],
      ['C', 0, 0],
    ]);
    const mini = [
      result('A', 1, 0, 'B'),
      result('C', 1, 0, 'A'),
      result('A', 1, 1, 'D'),
      result('B', 1, 0, 'C'),
      result('D', 1, 0, 'B'),
      result('D', 1, 0, 'C'),
    ];
    const rows = standings({ teams: teams('A', 'B', 'C', 'D', ...fillerIds), matches: [...mini, ...matches] });
    expect(new Set(['A', 'B', 'C', 'D'].map((id) => row(rows, id).quotient)).size).toBe(1);
    expect(row(rows, 'C').goalDiff).toBeGreaterThan(row(rows, 'B').goalDiff);
    expect(order(rows, ['A', 'B', 'C', 'D'])).toEqual(['D', 'A', 'B', 'C']);
    expect(row(rows, 'C').decidedBy).toBe('head_to_head');
  });

  it('nutzt erzielte Tore nach der Tordifferenz', () => {
    const { fillerIds, matches } = withFillers([
      ['A', 1, 0],
      ['B', 3, 2],
    ]);
    const rows = standings({ teams: teams('A', 'B', ...fillerIds), matches });
    expect(order(rows, ['A', 'B'])).toEqual(['B', 'A']);
    expect(row(rows, 'A').decidedBy).toBe('goals_for');
  });

  it('hält sich an eine frei gewählte Reihenfolge', () => {
    const { fillerIds, matches } = withFillers([
      ['A', 0, 5],
      ['B', 5, 0],
    ]);
    const input = { teams: teams('A', 'B', ...fillerIds), matches: [result('A', 1, 0, 'B'), ...matches] };
    const goalsFirst: TieBreaker[] = ['goal_diff', 'head_to_head'];
    expect(order(standings({ ...input, tieBreakers: goalsFirst }), ['A', 'B'])).toEqual(['B', 'A']);
    expect(order(standings({ ...input, tieBreakers: ['head_to_head', 'goal_diff'] }), ['A', 'B'])).toEqual(['A', 'B']);
  });
});

describe('Losentscheid', () => {
  const identical = {
    teams: teams('A', 'B', 'F1', 'F2'),
    matches: [result('A', 1, 0, 'F1'), result('B', 1, 0, 'F2')],
  };

  it('entscheidet vollständigen Gleichstand reproduzierbar per Seed', () => {
    const first = standings({ ...identical, lotSeed: 'turnier-1' });
    const again = standings({ ...identical, lotSeed: 'turnier-1' });
    expect(order(again)).toEqual(order(first));
    expect(row(first, order(first, ['A', 'B'])[1]!).decidedBy).toBe('lot');
  });

  it('hängt nicht von der Reihenfolge der Eingabedaten ab', () => {
    const forward = standings({ ...identical, lotSeed: 'x' });
    const reversed = standings({
      teams: [...identical.teams].reverse(),
      matches: [...identical.matches].reverse(),
      lotSeed: 'x',
    });
    expect(order(reversed)).toEqual(order(forward));
  });

  it('kann mit anderem Seed anders ausfallen', () => {
    const outcomes = new Set(
      Array.from({ length: 20 }, (_, i) => order(standings({ ...identical, lotSeed: `seed-${i}` }), ['A', 'B']).join()),
    );
    expect(outcomes).toEqual(new Set(['A,B', 'B,A']));
  });

  it('lost direkt, wenn keine Feinwertung eingestellt ist', () => {
    const { fillerIds, matches } = withFillers([
      ['A', 1, 0],
      ['B', 9, 0],
    ]);
    const rows = standings({ teams: teams('A', 'B', ...fillerIds), matches, tieBreakers: [] });
    expect(row(rows, order(rows, ['A', 'B'])[1]!).decidedBy).toBe('lot');
  });
});

describe('Buchholz', () => {
  const triangle = {
    teams: teams('A', 'B', 'C'),
    matches: [result('A', 2, 0, 'B'), result('A', 1, 0, 'C'), result('B', 1, 0, 'C')],
  };

  it('ist ohne Aktivierung nicht gesetzt', () => {
    expect(standings(triangle).every((r) => r.buchholz === null)).toBe(true);
  });

  it('berechnet die Standardvariante als Durchschnitt der Gegnerquotienten', () => {
    const rows = standings({ ...triangle, tieBreakers: ['buchholz'] });
    expect(row(rows, 'A').buchholz).toBe(0.75);
    expect(row(rows, 'B').buchholz).toBe(1.5);
    expect(row(rows, 'C').buchholz).toBe(2.25);
  });

  it('berechnet Summe der Gegnerquotienten und Summe der Gegnerpunkte', () => {
    const sumQ = standings({ ...triangle, tieBreakers: ['buchholz'], buchholzVariant: 'sum_opponent_quotient' });
    expect(order(sumQ)).toEqual(['A', 'B', 'C']);
    expect([row(sumQ, 'A').buchholz, row(sumQ, 'B').buchholz, row(sumQ, 'C').buchholz]).toEqual([1.5, 3, 4.5]);
    const sumP = standings({ ...triangle, tieBreakers: ['buchholz'], buchholzVariant: 'sum_opponent_points' });
    expect([row(sumP, 'A').buchholz, row(sumP, 'B').buchholz, row(sumP, 'C').buchholz]).toEqual([3, 6, 9]);
  });

  it('ignoriert Freilose und nicht ausgetragene Spiele', () => {
    const rows = standings({
      teams: teams('A', 'B', 'C'),
      matches: [result('A', 1, 0, 'B'), open('A', 'C', 'not_played')],
      byes: [{ teamId: 'A', roundId: 'r2' }],
      tieBreakers: ['buchholz'],
    });
    expect(row(rows, 'A').buchholz).toBe(0);
    expect(row(rows, 'C').buchholz).toBeNull();
  });

  it('entscheidet Gleichstand zugunsten des Teams mit stärkeren Gegnern', () => {
    const rows = standings({
      teams: teams('P', 'Q', 'S', 'W', 'X'),
      matches: [result('P', 1, 0, 'S'), result('Q', 1, 0, 'W'), result('S', 1, 0, 'W'), result('S', 1, 0, 'X')],
      tieBreakers: ['buchholz'],
    });
    expect(order(rows, ['P', 'Q'])).toEqual(['P', 'Q']);
    expect(row(rows, 'Q').decidedBy).toBe('buchholz');
  });
});

describe('Zurückgezogene Teams (verbindliche Regel)', () => {
  const base = {
    matches: [
      result('W', 3, 0, 'A', 1),
      result('B', 1, 1, 'C', 1),
      result('B', 1, 0, 'W', 2),
      result('A', 2, 0, 'C', 2),
    ],
  };

  it('löscht alle Spiele des Teams für alle Beteiligten aus der Wertung', () => {
    const rows = standings({ ...base, teams: [team('A'), team('B'), team('C'), team('W', 'withdrawn')] });
    // A verliert die Niederlage gegen W, B den Sieg gegen W.
    expect(row(rows, 'A')).toMatchObject({ played: 1, points: 3, goalsFor: 2, goalsAgainst: 0 });
    expect(row(rows, 'B')).toMatchObject({ played: 1, points: 1, goalsFor: 1, goalsAgainst: 1 });
    expect(row(rows, 'C')).toMatchObject({ played: 2, points: 1 });
  });

  it('führt das Team ohne Platz und ohne Wertung unter der Tabelle', () => {
    const rows = standings({ ...base, teams: [team('W', 'withdrawn'), team('A'), team('B'), team('C')] });
    const w = row(rows, 'W');
    expect(w).toMatchObject({ rank: null, eligible: false, played: 0, points: 0, quotient: null, decidedBy: null });
    expect(rows[rows.length - 1]!.teamId).toBe('W');
    expect(rows.filter((r) => r.eligible).map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('kann auch mit perfektem Quotienten nicht Erster werden', () => {
    const rows = standings({
      teams: [team('W', 'withdrawn'), team('A'), team('B')],
      matches: [result('W', 5, 0, 'A'), result('A', 1, 1, 'B', 2)],
    });
    expect(rows[0]!.teamId).not.toBe('W');
    expect(row(rows, 'W').rank).toBeNull();
    expect(row(rows, 'A')).toMatchObject({ played: 1, points: 1 });
  });

  it('gilt unabhängig vom Ergebnis und auch für Buchholz und direkten Vergleich', () => {
    const rows = standings({
      teams: [team('A'), team('B'), team('W', 'withdrawn')],
      matches: [result('A', 0, 0, 'B'), result('W', 0, 4, 'A', 2), result('W', 2, 2, 'B', 3)],
      tieBreakers: ['buchholz', 'head_to_head'],
    });
    expect(row(rows, 'A')).toMatchObject({ played: 1, points: 1, buchholz: 1 });
    expect(row(rows, 'B')).toMatchObject({ played: 1, points: 1, buchholz: 1 });
  });

  it('behandelt nicht angetretene und inaktive Teams genauso', () => {
    const rows = standings({
      teams: [team('A'), team('N', 'no_show', 'Nicht da'), team('I', 'inactive', 'Inaktiv')],
      matches: [result('N', 1, 0, 'A'), result('I', 1, 0, 'A')],
    });
    expect(row(rows, 'A')).toMatchObject({ rank: 1, played: 0 });
    expect(order(rows)).toEqual(['A', 'I', 'N']);
    expect(rows.slice(1).every((r) => r.rank === null && !r.eligible)).toBe(true);
  });
});
