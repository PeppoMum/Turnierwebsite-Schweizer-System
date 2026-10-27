// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { collectMeetings, MeetingCounter } from './meetings';
import { createRng, shuffled } from './random';
import { pairSwissRound, type SwissRoundInput } from './swiss';
import {
  meetingsOf,
  rankByQuotient,
  simulateTournament,
  teamId,
  toPairingTeams,
} from './testing/simulate';
import type { PairingPlan, PairingTeam } from './types';
import { validatePairingPlan } from './validate';
import type { Match } from '../types';

function team(id: string, points: number, played: number, byes = 0): PairingTeam {
  return { id, points, played, byes };
}

function pairKeys(plan: PairingPlan): string[] {
  return plan.pairings.map((p) => [p.teamAId, p.teamBId].sort().join('-')).sort();
}

function expectValidRound(plan: PairingPlan, activeIds: readonly string[]): void {
  const seen = new Set<string>();
  for (const p of plan.pairings) {
    expect(p.teamAId).not.toBe(p.teamBId);
    for (const id of [p.teamAId, p.teamBId]) {
      expect(seen.has(id), `${id} doppelt in Runde ${plan.roundNumber}`).toBe(false);
      seen.add(id);
    }
  }
  if (plan.byeTeamId) {
    expect(seen.has(plan.byeTeamId)).toBe(false);
    seen.add(plan.byeTeamId);
  }
  expect([...seen].sort()).toEqual([...activeIds].sort());
  expect(plan.byeTeamId !== undefined).toBe(activeIds.length % 2 === 1);
}

describe('Schweizer Runde – Grundverhalten', () => {
  it('paart nach Quotient, nicht nach Rohpunkten', () => {
    // A: 6 Punkte aus 2 Spielen (3,0), B: 9 aus 6 (1,5), C: 3 aus 1 (3,0), D: 9 aus 6 (1,5)
    const plan = pairSwissRound({
      roundNumber: 7,
      teams: [team('A', 6, 2), team('B', 9, 6), team('C', 3, 1), team('D', 9, 6)],
      seed: 's',
    });
    expect(pairKeys(plan)).toEqual(['A-C', 'B-D']);
  });

  it('gleiche Quoten aus unterschiedlichen Brüchen gelten als gleich (4/2 = 6/3)', () => {
    const plan = pairSwissRound({
      roundNumber: 4,
      teams: [team('A', 4, 2), team('B', 6, 3), team('C', 0, 3), team('D', 0, 2)],
      seed: 's',
    });
    expect(pairKeys(plan)).toEqual(['A-B', 'C-D']);
    expect(plan.diagnostics.maxQuotientGap).toBe(0);
  });

  it('bevorzugt bei gleicher Quote Teams mit ähnlicher Spielzahl', () => {
    // Alle Quote 1,0; zwei Teams mit 1 Spiel, zwei mit 4 Spielen.
    const plan = pairSwissRound({
      roundNumber: 5,
      teams: [team('A', 1, 1), team('B', 4, 4), team('C', 1, 1), team('D', 4, 4)],
      seed: 's',
    });
    expect(pairKeys(plan)).toEqual(['A-C', 'B-D']);
  });

  it('kommt mit 0 gespielten Spielen zurecht (Kaltstart, Prior nur intern)', () => {
    const teams = Array.from({ length: 10 }, (_, i) => team(teamId(i), 0, 0));
    const plan = pairSwissRound({ roundNumber: 1, teams, seed: 'kalt' });
    expectValidRound(
      plan,
      teams.map((t) => t.id),
    );
    expect(plan.diagnostics.maxQuotientGap).toBe(0);
    // Nicht-gespielte Teams in laufendem Turnier werden mit dem Mittelwert eingestuft
    const mixed = pairSwissRound({
      roundNumber: 3,
      teams: [team('A', 6, 2), team('B', 0, 2), team('N', 0, 0), team('M', 3, 2)],
      seed: 's',
    });
    expect(mixed.diagnostics.explanations.join(' ')).toContain('intern');
  });

  it('erkennt Gleichstand der Quoten und löst ihn reproduzierbar per Seed auf', () => {
    const teams = Array.from({ length: 12 }, (_, i) => team(teamId(i), 3, 2));
    const a = pairSwissRound({ roundNumber: 3, teams, seed: 'eins' });
    const b = pairSwissRound({ roundNumber: 3, teams, seed: 'eins' });
    expect(a).toEqual(b);
    const variants = new Set(
      ['eins', 'zwei', 'drei', 'vier', 'fünf'].map((seed) => pairKeys(pairSwissRound({ roundNumber: 3, teams, seed })).join()),
    );
    expect(variants.size).toBeGreaterThan(1);
  });

  it('ist unabhängig von der Reihenfolge der Eingabe', () => {
    const rng = createRng('order');
    const teams = Array.from({ length: 15 }, (_, i) =>
      team(teamId(i), Math.floor(rng() * 12), 4 + Math.floor(rng() * 2), i % 2),
    );
    const meetings = [
      { teamAId: 'T01', teamBId: 'T02' },
      { teamAId: 'T03', teamBId: 'T04' },
    ];
    const base = pairSwissRound({ roundNumber: 6, teams, meetings, seed: 'x' });
    const reordered = pairSwissRound({
      roundNumber: 6,
      teams: shuffled(teams, rng),
      meetings: shuffled(meetings, rng),
      seed: 'x',
    });
    expect(reordered).toEqual(base);
  });

  it('wirft bei doppelt angegebenen Teams', () => {
    expect(() => pairSwissRound({ roundNumber: 1, teams: [team('A', 0, 0), team('A', 0, 0)], seed: 's' })).toThrow(
      /mehrfach/,
    );
  });
});

describe('Wiederholungen gegen Spielstärke (Akzeptanzkriterium G)', () => {
  // A und B (oben) sowie C und D (unten) haben schon gegeneinander gespielt.
  const teams = [team('A', 21, 7), team('B', 20, 7), team('C', 1, 7), team('D', 0, 7)];
  const meetings = [
    { teamAId: 'A', teamBId: 'B' },
    { teamAId: 'C', teamBId: 'D' },
  ];

  it('balanced nimmt lieber eine Wiederholung als Erster gegen Letzter', () => {
    const plan = pairSwissRound({ roundNumber: 8, teams, meetings, seed: 's' });
    expect(pairKeys(plan)).toEqual(['A-B', 'C-D']);
    expect(plan.status).toBe('ok');
    expect(plan.diagnostics.repeats).toBe(2);
    expect(plan.diagnostics.noRematchFeasible).toBe(true);
    expect(plan.diagnostics.alternatives[0]!.repeats).toBe(0);
    expect(plan.diagnostics.explanations[0]).toMatch(/Wiederholung bewusst gewählt/);
  });

  it('strict_no_rematch zeigt die wiederholungsfreie Zuordnung mit Hinweis auf die Quotenlücke', () => {
    const plan = pairSwissRound({ roundNumber: 8, teams, meetings, seed: 's', mode: 'strict_no_rematch' });
    expect(plan.diagnostics.repeats).toBe(0);
    expect(plan.status).toBe('ok');
    expect(plan.diagnostics.warnings.some((w) => w.includes('Große Quotenlücke'))).toBe(true);
  });

  it('performance_first gewichtet Quotennähe noch stärker', () => {
    const plan = pairSwissRound({ roundNumber: 8, teams, meetings, seed: 's', mode: 'performance_first' });
    expect(pairKeys(plan)).toEqual(['A-B', 'C-D']);
  });

  it('balanced vermeidet eine Wiederholung, wenn der Preis klein ist', () => {
    const close = [team('A', 14, 7), team('B', 13, 7), team('C', 12, 7), team('D', 11, 7)];
    const plan = pairSwissRound({
      roundNumber: 8,
      teams: close,
      meetings: [{ teamAId: 'C', teamBId: 'D' }],
      seed: 's',
    });
    expect(plan.diagnostics.repeats).toBe(0);
  });
});

describe('Nahe Jeder-gegen-jeden: Unmöglichkeit erkennen', () => {
  it('4 Teams nach 3 Runden: keine Runde ohne Wiederholung möglich', () => {
    const ids = ['A', 'B', 'C', 'D'];
    const meetings = [];
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) meetings.push({ teamAId: ids[i]!, teamBId: ids[j]! });
    const teams = ids.map((id, i) => team(id, 9 - 3 * i, 3));
    const balanced = pairSwissRound({ roundNumber: 4, teams, meetings, seed: 's' });
    expect(balanced.diagnostics.noRematchFeasible).toBe(false);
    expect(balanced.diagnostics.repeats).toBe(2);
    expect(balanced.diagnostics.explanations).toContain(
      'Eine Runde ganz ohne Wiederholung ist mit den aktiven Teams nicht möglich.',
    );
    const strict = pairSwissRound({ roundNumber: 4, teams, meetings, seed: 's', mode: 'strict_no_rematch' });
    expect(strict.status).toBe('needs_confirmation');
    expect(strict.diagnostics.warnings[0]).toMatch(/bitte ausdrücklich bestätigen/);
    expectValidRound(strict, ids);
  });

  it('erkennt Unmöglichkeit auch, wenn nur ein Rest-Teilgraph blockiert ist', () => {
    // 6 Teams: A hat gegen alle außer B gespielt, C..F haben alle untereinander gespielt.
    const others = ['C', 'D', 'E', 'F'];
    const meetings = [
      ...others.map((o) => ({ teamAId: 'A', teamBId: o })),
      { teamAId: 'C', teamBId: 'D' },
      { teamAId: 'E', teamBId: 'F' },
      { teamAId: 'C', teamBId: 'E' },
      { teamAId: 'D', teamBId: 'F' },
      { teamAId: 'C', teamBId: 'F' },
      { teamAId: 'D', teamBId: 'E' },
    ];
    const teams = ['A', 'B', ...others].map((id) => team(id, 6, 4));
    const plan = pairSwissRound({ roundNumber: 6, teams, meetings, seed: 's', mode: 'strict_no_rematch' });
    // A muss gegen B; dann bleiben C-F, die alle schon gegeneinander gespielt haben.
    expect(plan.status).toBe('needs_confirmation');
    expect(plan.diagnostics.repeats).toBe(2);
    expect(pairKeys(plan)).toContain('A-B');
  });

  it('simuliertes 8er-Turnier über 7 Runden bleibt gültig und ohne Dreifachbegegnungen', () => {
    for (let s = 0; s < 20; s++) {
      const r = simulateTournament({ teams: 8, rounds: 7, preDrawRounds: 1, seed: `rr${s}` });
      for (const p of r.plans) expect(p.diagnostics.tripleEncounters).toBe(0);
    }
  });
});

describe('16 Teams, 8 Runden (Kernszenario)', () => {
  const runs = Array.from({ length: 40 }, (_, s) =>
    simulateTournament({ teams: 16, rounds: 8, preDrawRounds: 2, seed: `sechzehn-${s}` }),
  );

  it('alle Runden sind gültige Perfect Matchings ohne doppelte Teams', () => {
    for (const r of runs) {
      for (const p of r.plans) {
        expectValidRound(
          p,
          r.teams.map((t) => t.id),
        );
      }
    }
  });

  it('keine unnötigen Mehrfachbegegnungen', () => {
    let repeats = 0;
    for (const r of runs) {
      for (const p of r.plans) {
        expect(p.diagnostics.tripleEncounters).toBe(0);
        repeats += p.diagnostics.repeats;
        if (p.diagnostics.repeats > 0 && p.diagnostics.noRematchFeasible) {
          // Wiederholung nur, wenn die wiederholungsfreie Alternative nachweislich schlechter ist
          const alt = p.diagnostics.alternatives[0]!;
          expect(alt.objectiveCost).toBeGreaterThan(p.diagnostics.objectiveCost);
          expect(alt.maxQuotientGap).toBeGreaterThan(p.diagnostics.maxQuotientGap);
        }
      }
    }
    // Im Mittel weniger als eine Wiederholung pro komplettem Turnier
    expect(repeats / runs.length).toBeLessThan(1);
  });

  it('keine Paarung Tabellenerster gegen Tabellenletzten in den Schweizer Runden', () => {
    for (const s of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const opts = { teams: 16, rounds: 8, preDrawRounds: 2, seed: `sechzehn-${s}` };
      // Tabelle vor jeder Runde nachbauen: Runde r beruht auf Runden < r
      for (let r = 3; r <= 8; r++) {
        const before = simulateTournament({ ...opts, rounds: r - 1 });
        const ranking = rankByQuotient(toPairingTeams(before.teams));
        const plan = simulateTournament({ ...opts, rounds: r }).plans.at(-1)!;
        const first = ranking[0]!;
        const last = ranking.at(-1)!;
        expect(pairKeys(plan)).not.toContain([first, last].sort().join('-'));
      }
    }
  });
});

describe('Ungerade Teamzahlen und Freilose', () => {
  for (const n of [3, 5, 15, 17]) {
    it(`${n} Teams: Freilose gleichmäßig verteilt`, () => {
      for (let s = 0; s < 10; s++) {
        const rounds = Math.min(10, n + 2);
        const r = simulateTournament({ teams: n, rounds, preDrawRounds: s % 3, seed: `odd-${n}-${s}` });
        const byes = r.teams.map((t) => t.byes);
        expect(Math.max(...byes) - Math.min(...byes)).toBeLessThanOrEqual(1);
        expect(byes.reduce((a, b) => a + b, 0)).toBe(rounds);
        for (const p of r.plans) {
          expectValidRound(
            p,
            r.teams.map((t) => t.id),
          );
        }
      }
    });
  }

  it('Freilos nur an Teams mit minimaler Freiloszahl, mehrere Kandidaten bewertet', () => {
    const teams = [team('A', 6, 3, 1), team('B', 4, 3, 0), team('C', 3, 3, 0), team('D', 1, 3, 1), team('E', 0, 3, 0)];
    const plan = pairSwissRound({ roundNumber: 5, teams, seed: 's' });
    expect(['B', 'C', 'E']).toContain(plan.byeTeamId);
    expect(plan.diagnostics.byeCandidates.map((c) => c.teamId).sort()).toEqual(['B', 'C', 'E']);
    expect(plan.diagnostics.byeCandidates.filter((c) => c.chosen)).toHaveLength(1);
    expect(plan.diagnostics.byeTeamId).toBe(plan.byeTeamId);
  });

  it('Freilos bevorzugt Teams mit mehr gespielten Spielen', () => {
    // C hat wegen eines ausgefallenen Spiels eins weniger gespielt und soll nicht auch noch pausieren.
    const teams = [team('A', 3, 2), team('B', 3, 2), team('C', 3, 1)];
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      expect(pairSwissRound({ roundNumber: 3, teams, seed }).byeTeamId).not.toBe('C');
    }
  });

  it('erklärt ein zweites Freilos, wenn alle schon eines hatten', () => {
    const plan = pairSwissRound({
      roundNumber: 4,
      teams: [team('A', 3, 2, 1), team('B', 3, 2, 1), team('C', 3, 2, 1)],
      seed: 's',
    });
    expect(plan.diagnostics.explanations.join(' ')).toMatch(/2\. Freilos/);
  });
});

describe('Rückzug eines Teams', () => {
  it('zurückgezogenes Team wird nicht mehr gepaart und seine Spiele zählen nicht als Begegnung', () => {
    const r = simulateTournament({ teams: 10, rounds: 8, preDrawRounds: 2, seed: 'rueckzug', withdrawTeam: 3, withdrawAfterRound: 4 });
    const withdrawn = teamId(3);
    for (const p of r.plans.filter((x) => x.roundNumber > 4)) {
      expect(pairKeys(p).join()).not.toContain(withdrawn);
      expect(p.byeTeamId).not.toBe(withdrawn);
    }
    // 9 aktive Teams → ab Runde 5 je ein Freilos
    expect(r.plans.filter((x) => x.roundNumber > 4).every((p) => p.byeTeamId !== undefined)).toBe(true);
    expect(meetingsOf(r).some((m) => m.teamAId === withdrawn || m.teamBId === withdrawn)).toBe(false);
  });

  it('collectMeetings löscht Spiele zurückgezogener Teams und ignoriert nicht ausgetragene', () => {
    const base = { roundId: 'r', durationMinutes: 12, revision: 1, createdAt: '', updatedAt: '' };
    const matches: Match[] = [
      { ...base, id: '1', roundNumber: 1, teamAId: 'A', teamBId: 'B', status: 'completed', goalsA: 1, goalsB: 0 },
      { ...base, id: '2', roundNumber: 1, teamAId: 'C', teamBId: 'W', status: 'completed', goalsA: 0, goalsB: 0 },
      { ...base, id: '3', roundNumber: 2, teamAId: 'A', teamBId: 'C', status: 'not_played', notPlayedReason: 'no_show' },
      { ...base, id: '4', roundNumber: 2, teamAId: 'B', teamBId: 'D', status: 'scheduled' },
      { ...base, id: '5', roundNumber: 3, teamAId: 'C', teamBId: 'D', status: 'draft' },
    ];
    const meetings = new MeetingCounter(collectMeetings(matches, { excludedTeamIds: ['W'] }));
    expect(meetings.count('A', 'B')).toBe(1);
    expect(meetings.count('C', 'W')).toBe(0);
    expect(meetings.count('A', 'C')).toBe(0);
    expect(meetings.count('B', 'D')).toBe(1);
    expect(meetings.count('C', 'D')).toBe(0);
    expect(collectMeetings(matches, { excludeRoundNumbers: [1] })).toHaveLength(1);
  });

  it('Begegnungen mit nicht aktiven Teams werden ignoriert', () => {
    const plan = pairSwissRound({
      roundNumber: 3,
      teams: [team('A', 3, 1), team('B', 3, 1)],
      meetings: [{ teamAId: 'A', teamBId: 'W' }],
      seed: 's',
    });
    expect(plan.diagnostics.repeats).toBe(0);
  });
});

describe('Diagnose ist präzise', () => {
  it('Kennzahlen stimmen mit unabhängiger Nachrechnung überein', () => {
    for (let s = 0; s < 15; s++) {
      const r = simulateTournament({ teams: 11 + s, rounds: 6, preDrawRounds: 1, seed: `diag-${s}` });
      const plan = r.plans.at(-1)!;
      // Zustand vor der letzten Runde rekonstruieren
      const before = simulateTournament({ teams: 11 + s, rounds: 5, preDrawRounds: 1, seed: `diag-${s}` });
      const teams = toPairingTeams(before.teams);
      const counter = new MeetingCounter(meetingsOf(before));
      const q = new Map(teams.map((t) => [t.id, t.points / t.played]));
      let repeats = 0;
      let maxGap = 0;
      let sumGap = 0;
      for (const p of plan.pairings) {
        const prev = counter.count(p.teamAId, p.teamBId);
        expect(p.previousMeetings).toBe(prev);
        if (prev > 0) repeats++;
        const gap = Math.abs(q.get(p.teamAId)! - q.get(p.teamBId)!);
        expect(p.quotientGap).toBeCloseTo(gap, 12);
        maxGap = Math.max(maxGap, gap);
        sumGap += gap;
      }
      expect(plan.diagnostics.repeats).toBe(repeats);
      expect(plan.diagnostics.maxQuotientGap).toBeCloseTo(maxGap, 12);
      expect(plan.diagnostics.meanQuotientGap).toBeCloseTo(sumGap / plan.pairings.length, 12);
      const report = validatePairingPlan({ teams, plan, meetings: meetingsOf(before), seed: plan.seed });
      expect(report.valid).toBe(true);
      const pairCost = plan.pairings.reduce((sum, p) => sum + p.cost, 0);
      expect(report.objectiveCost).toBeCloseTo(pairCost, 9);
      expect(plan.diagnostics.objectiveCost).toBeGreaterThanOrEqual(pairCost - 1e-9);
    }
  });
});

describe('Performance (Budget: 40 Teams < 500 ms je Runde)', () => {
  for (const n of [40, 41]) {
    it(`${n} Teams, späte Runde`, () => {
      const before = simulateTournament({ teams: n, rounds: 9, preDrawRounds: 2, seed: `perf-${n}` });
      const input: SwissRoundInput = {
        roundNumber: 10,
        teams: toPairingTeams(before.teams),
        meetings: meetingsOf(before),
        seed: 'perf',
      };
      pairSwissRound(input); // Aufwärmen (JIT)
      const t0 = performance.now();
      for (let i = 0; i < 3; i++) pairSwissRound(input);
      const ms = (performance.now() - t0) / 3;
      expect(ms).toBeLessThan(500);
      const strictT0 = performance.now();
      pairSwissRound({ ...input, mode: 'strict_no_rematch' });
      expect(performance.now() - strictT0).toBeLessThan(500);
    });
  }
});
