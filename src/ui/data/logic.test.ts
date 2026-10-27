import type { Match } from '../../domain';
import { createFixtures } from './fixtures';
import { computeStandings, toPublicView } from './logic';

function match(id: string, a: string, b: string, ga: number, gb: number): Match {
  return {
    id,
    roundId: 'r',
    roundNumber: 1,
    teamAId: a,
    teamBId: b,
    durationMinutes: 10,
    status: 'completed',
    goalsA: ga,
    goalsB: gb,
    revision: 1,
    createdAt: '',
    updatedAt: '',
  };
}

describe('öffentliche Projektion', () => {
  it('enthält im Kinderfußballmodus weder Tore noch Tabelle', () => {
    const kids = createFixtures().find((d) => d.tournament.id === 'minicup')!;
    kids.matches[0]!.status = 'completed';
    kids.matches[0]!.goalsA = 3;
    kids.matches[0]!.goalsB = 1;
    const view = toPublicView(kids);
    expect(view.standings).toBeUndefined();
    const json = JSON.stringify(view);
    expect(json).not.toContain('goalsA');
    expect(json).not.toContain('goalsB');
  });

  it('enthält ohne Tabelle Tore, aber keine Tabelle', () => {
    const d = createFixtures().find((x) => x.tournament.id === 'herbstcup')!;
    d.tournament.visibility = 'no_standings';
    const view = toPublicView(d);
    expect(view.standings).toBeUndefined();
    expect(view.matches.some((m) => m.goalsA !== undefined)).toBe(true);
  });
});

describe('Tabelle (Stellvertreter)', () => {
  it('sortiert nach Quotient und lässt Spiele zurückgezogener Teams weg', () => {
    const d = createFixtures().find((x) => x.tournament.id === 'wintercup')!;
    const [a, b, c] = d.teams;
    d.matches = [match('m1', a!.id, b!.id, 2, 0), match('m2', c!.id, b!.id, 1, 1), match('m3', a!.id, c!.id, 0, 1)];
    let rows = computeStandings(d);
    expect(rows[0]!.teamId).toBe(c!.id); // 4 Punkte aus 2 Spielen
    c!.status = 'withdrawn';
    rows = computeStandings(d);
    const rowA = rows.find((r) => r.teamId === a!.id)!;
    expect(rowA.played).toBe(1);
    expect(rows[rows.length - 1]!.teamId).toBe(c!.id);
    expect(rows.find((r) => r.teamId === c!.id)!.eligible).toBe(false);
  });
});
