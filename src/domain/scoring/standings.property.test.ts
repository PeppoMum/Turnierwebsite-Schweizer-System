// @vitest-environment node
import fc from 'fast-check';
import type { MatchStatus, TeamStatus, TieBreaker } from '../types';
import { calculateStandings, compareQuotient, countedMatches, type StandingsInput, type StandingsMatch, type TeamStanding } from './standings';

const NON_COUNTING: MatchStatus[] = ['draft', 'scheduled', 'live', 'not_played', 'cancelled'];
const ALL_TIE_BREAKERS: TieBreaker[] = ['head_to_head', 'goal_diff', 'goals_for', 'buchholz'];

interface Scenario {
  input: StandingsInput;
}

/**
 * Zufällige Turniere mit 3–40 Teams und 1–12 Runden. Pro Runde werden Teams paarweise zugeordnet
 * (höchstens ein Spiel pro Team und Runde), ein Teil der Spiele fällt aus oder ist noch offen, manche
 * Teams sind zurückgezogen. Tore sind klein, damit Gleichstände häufig vorkommen.
 */
const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    teamCount: fc.integer({ min: 3, max: 40 }),
    roundCount: fc.integer({ min: 1, max: 12 }),
    lotSeed: fc.string({ maxLength: 8 }),
    tieBreakers: fc.shuffledSubarray(ALL_TIE_BREAKERS),
    buchholzVariant: fc.constantFrom('avg_opponent_quotient', 'sum_opponent_quotient', 'sum_opponent_points') as fc.Arbitrary<
      NonNullable<StandingsInput['buchholzVariant']>
    >,
  })
  .chain(({ teamCount, roundCount, lotSeed, tieBreakers, buchholzVariant }) =>
    fc
      .record({
        statuses: fc.array(fc.constantFrom<TeamStatus>('active', 'active', 'active', 'active', 'active', 'withdrawn', 'no_show', 'inactive'), {
          minLength: teamCount,
          maxLength: teamCount,
        }),
        rounds: fc.array(
          fc.record({
            order: fc.shuffledSubarray(
              Array.from({ length: teamCount }, (_, i) => i),
              { minLength: teamCount, maxLength: teamCount },
            ),
            results: fc.array(
              fc.record({
                kind: fc.constantFrom('completed', 'completed', 'completed', 'completed', 'other'),
                status: fc.constantFrom(...NON_COUNTING),
                goalsA: fc.integer({ min: 0, max: 4 }),
                goalsB: fc.integer({ min: 0, max: 4 }),
              }),
              { minLength: Math.floor(teamCount / 2), maxLength: Math.floor(teamCount / 2) },
            ),
          }),
          { minLength: roundCount, maxLength: roundCount },
        ),
      })
      .map(({ statuses, rounds }) => {
        const teams = statuses.map((status, i) => ({ id: `t${i}`, name: `Team ${i}`, status }));
        const matches: StandingsMatch[] = [];
        const byes: { teamId: string; roundId: string }[] = [];
        rounds.forEach((round, r) => {
          const roundNumber = r + 1;
          round.results.forEach((res, k) => {
            const a = `t${round.order[2 * k]}`;
            const b = `t${round.order[2 * k + 1]}`;
            matches.push(
              res.kind === 'completed'
                ? { teamAId: a, teamBId: b, status: 'completed', goalsA: res.goalsA, goalsB: res.goalsB, roundNumber }
                : { teamAId: a, teamBId: b, status: res.status, roundNumber },
            );
          });
          if (teamCount % 2 === 1) byes.push({ teamId: `t${round.order[teamCount - 1]}`, roundId: `r${roundNumber}` });
        });
        return {
          input: {
            teams,
            matches,
            byes,
            rounds: rounds.map((_, r) => ({ id: `r${r + 1}`, number: r + 1 })),
            tieBreakers,
            buchholzVariant,
            lotSeed,
          },
        };
      }),
  );

const runs = { numRuns: 400 };

function shuffle<T>(items: readonly T[], rnd: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function byId(rows: TeamStanding[]): Map<string, TeamStanding> {
  return new Map(rows.map((r) => [r.teamId, r]));
}

describe('Wertung – Invarianten über zufällige Turniere', () => {
  it('erfindet keine Punkte, Spiele oder Tore', () => {
    fc.assert(
      fc.property(scenarioArb, ({ input }) => {
        const rows = calculateStandings(input);
        const counted = countedMatches(input);
        const decisive = counted.filter((m) => m.goalsA !== m.goalsB).length;
        const draws = counted.length - decisive;
        const sum = (f: (r: TeamStanding) => number) => rows.reduce((acc, r) => acc + f(r), 0);
        expect(sum((r) => r.played)).toBe(2 * counted.length);
        expect(sum((r) => r.points)).toBe(3 * decisive + 2 * draws);
        expect(sum((r) => r.goalsFor)).toBe(sum((r) => r.goalsAgainst));
        expect(sum((r) => r.goalDiff)).toBe(0);
        expect(sum((r) => r.wins)).toBe(sum((r) => r.losses));
        for (const r of rows) {
          expect(r.wins + r.draws + r.losses).toBe(r.played);
          expect(r.points).toBe(3 * r.wins + r.draws);
          expect(r.quotient).toBe(r.played === 0 ? null : r.points / r.played);
        }
      }),
      runs,
    );
  });

  it('listet jedes Team genau einmal, mit eindeutigen Plätzen 1..n für wertungsberechtigte Teams', () => {
    fc.assert(
      fc.property(scenarioArb, ({ input }) => {
        const rows = calculateStandings(input);
        expect(new Set(rows.map((r) => r.teamId)).size).toBe(input.teams.length);
        const ranked = rows.filter((r) => r.eligible);
        expect(ranked.map((r) => r.rank)).toEqual(ranked.map((_, i) => i + 1));
        expect(rows.slice(0, ranked.length).every((r) => r.eligible)).toBe(true);
        for (const r of rows) expect(r.eligible).toBe(r.status === 'active');
      }),
      runs,
    );
  });

  it('sortiert nach exaktem Quotienten, Teams ohne Spiel zuletzt', () => {
    fc.assert(
      fc.property(scenarioArb, ({ input }) => {
        const ranked = calculateStandings(input).filter((r) => r.eligible);
        for (let i = 1; i < ranked.length; i++) {
          const prev = ranked[i - 1]!;
          const cur = ranked[i]!;
          const cmp = compareQuotient(prev, cur);
          expect(cmp).toBeGreaterThanOrEqual(0);
          if (cur.decidedBy === 'quotient') expect(cmp).toBeGreaterThan(0);
          else expect(cmp).toBe(0);
        }
      }),
      runs,
    );
  });

  it('lost nur bei Gleichstand in allen tabellenweiten Kriterien', () => {
    fc.assert(
      fc.property(scenarioArb, ({ input }) => {
        const ranked = calculateStandings(input).filter((r) => r.eligible);
        for (let i = 1; i < ranked.length; i++) {
          const prev = ranked[i - 1]!;
          const cur = ranked[i]!;
          if (cur.decidedBy !== 'lot') continue;
          expect(compareQuotient(prev, cur)).toBe(0);
          for (const tb of input.tieBreakers ?? []) {
            if (tb === 'goal_diff') expect(cur.goalDiff).toBe(prev.goalDiff);
            if (tb === 'goals_for') expect(cur.goalsFor).toBe(prev.goalsFor);
            if (tb === 'buchholz') expect(cur.buchholz).toBe(prev.buchholz);
          }
        }
      }),
      runs,
    );
  });

  it('ist unabhängig von der Reihenfolge der Eingabedaten', () => {
    fc.assert(
      fc.property(scenarioArb, fc.integer(), ({ input }, shuffleSeed) => {
        const rnd = mulberry32(shuffleSeed);
        const shuffled: StandingsInput = {
          ...input,
          teams: shuffle(input.teams, rnd),
          matches: shuffle(input.matches, rnd),
          byes: shuffle(input.byes ?? [], rnd),
        };
        expect(calculateStandings(shuffled)).toEqual(calculateStandings(input));
      }),
      runs,
    );
  });

  it('ändert sich nicht durch nicht gewertete Spiele oder Freilose', () => {
    fc.assert(
      fc.property(scenarioArb, ({ input }) => {
        const nonCounting = input.matches.filter((m) => m.status !== 'completed');
        const onlyCompleted = { ...input, matches: input.matches.filter((m) => m.status === 'completed'), byes: [] };
        const strip = (rows: TeamStanding[]) => rows.map((r) => ({ ...r, byes: 0 }));
        expect(strip(calculateStandings({ ...onlyCompleted, matches: [...onlyCompleted.matches, ...nonCounting] }))).toEqual(
          strip(calculateStandings(onlyCompleted)),
        );
        expect(strip(calculateStandings(input))).toEqual(strip(calculateStandings(onlyCompleted)));
      }),
      runs,
    );
  });

  it('wertet ein zurückgezogenes Team so, als hätte es nie gespielt', () => {
    fc.assert(
      fc.property(scenarioArb, fc.nat(), ({ input }, pick) => {
        const target = input.teams[pick % input.teams.length]!;
        const withdrawn: StandingsInput = {
          ...input,
          teams: input.teams.map((t) => (t.id === target.id ? { ...t, status: 'withdrawn' } : t)),
        };
        const neverThere: StandingsInput = {
          ...input,
          teams: input.teams.filter((t) => t.id !== target.id),
          matches: input.matches.filter((m) => m.teamAId !== target.id && m.teamBId !== target.id),
        };
        const a = calculateStandings(withdrawn);
        const b = byId(calculateStandings(neverThere));
        for (const r of a) {
          if (r.teamId === target.id) {
            expect(r).toMatchObject({ rank: null, eligible: false, played: 0, points: 0, goalsFor: 0, goalsAgainst: 0 });
            continue;
          }
          expect(r).toEqual(b.get(r.teamId));
        }
      }),
      runs,
    );
  });

  it('lässt ein zurückgezogenes Team nie gewinnen', () => {
    fc.assert(
      fc.property(scenarioArb, ({ input }) => {
        const rows = calculateStandings(input);
        const winner = rows[0]!;
        if (winner.rank === 1) expect(winner.status).toBe('active');
        for (const r of rows) if (r.status === 'withdrawn') expect(r.rank).toBeNull();
      }),
      runs,
    );
  });

  it('hängt bei throughRound nur von Spielen bis zu dieser Runde ab', () => {
    fc.assert(
      fc.property(scenarioArb, fc.nat(), ({ input }, pick) => {
        const lastRound = Math.max(...(input.rounds ?? []).map((r) => r.number));
        const through = (pick % lastRound) + 1;
        const cut: StandingsInput = {
          ...input,
          matches: input.matches.filter((m) => m.roundNumber <= through),
          byes: (input.byes ?? []).filter((b) => Number(b.roundId.slice(1)) <= through),
        };
        expect(calculateStandings({ ...input, throughRound: through })).toEqual(calculateStandings(cut));
      }),
      runs,
    );
  });

  it('berechnet 40 Teams mit 12 Runden schnell', () => {
    const sample = fc.sample(
      scenarioArb.filter(({ input }) => input.teams.length >= 36),
      { numRuns: 20, seed: 42 },
    );
    const start = performance.now();
    for (const { input } of sample) calculateStandings({ ...input, tieBreakers: ALL_TIE_BREAKERS });
    const perCall = (performance.now() - start) / sample.length;
    // Budget: deutlich unter einem Frame, damit die Tabelle bei jedem Live-Update neu gerechnet werden kann.
    expect(perCall).toBeLessThan(15);
  });
});

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
