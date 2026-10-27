// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { pairSwissRound } from './swiss';
import type { PairingTeam } from './types';
import { swapTeams, validatePairingPlan } from './validate';

const t = (id: string, points: number, played: number, byes = 0): PairingTeam => ({ id, name: `Team ${id}`, points, played, byes });

describe('validatePairingPlan / swapTeams', () => {
  const teams = [t('A', 9, 3), t('B', 7, 3), t('C', 4, 3, 1), t('D', 3, 3), t('E', 0, 3)];
  const meetings = [{ teamAId: 'A', teamBId: 'B' }];

  it('akzeptiert den berechneten Vorschlag', () => {
    const plan = pairSwissRound({ roundNumber: 4, teams, meetings, seed: 's' });
    const report = validatePairingPlan({ teams, plan, meetings, seed: 's', optimalCost: plan.diagnostics.objectiveCost });
    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it('erkennt doppelte, fehlende, unbekannte Teams und Freilosfehler', () => {
    const report = validatePairingPlan({
      teams,
      plan: {
        pairings: [
          { teamAId: 'A', teamBId: 'A' },
          { teamAId: 'B', teamBId: 'X' },
        ],
      },
    });
    expect(report.valid).toBe(false);
    const text = report.errors.join('\n');
    expect(text).toMatch(/Team A kann nicht gegen sich selbst/);
    expect(text).toMatch(/Team A ist in dieser Runde 2-mal/);
    expect(text).toMatch(/X ist nicht aktiv/);
    expect(text).toMatch(/Team C hat weder Gegner noch Freilos/);
    expect(text).toMatch(/ungerader Teamzahl/);

    const even = validatePairingPlan({
      teams: teams.slice(0, 4),
      plan: { pairings: [{ teamAId: 'A', teamBId: 'B' }], byeTeamId: 'C' },
    });
    expect(even.errors.join()).toMatch(/gerader Teamzahl gibt es kein Freilos/);
  });

  it('Tausch: warnt bei Wiederholung und unfairem Freilos, Strict-Modus blockiert', () => {
    const plan = { pairings: [{ teamAId: 'A', teamBId: 'C' }, { teamAId: 'B', teamBId: 'D' }], byeTeamId: 'E' };
    const swapped = swapTeams(plan, 'C', 'B'); // A–B (Wiederholung), C–D
    expect(swapped.pairings).toEqual([
      { teamAId: 'A', teamBId: 'B' },
      { teamAId: 'C', teamBId: 'D' },
    ]);
    const report = validatePairingPlan({ teams, plan: swapped, meetings });
    expect(report.valid).toBe(true);
    expect(report.repeats).toBe(1);
    expect(report.warnings.join()).toMatch(/2\. Begegnung/);
    const strict = validatePairingPlan({ teams, plan: swapped, meetings, mode: 'strict_no_rematch' });
    expect(strict.valid).toBe(false);

    const byeSwap = swapTeams(plan, 'E', 'C'); // C (hatte schon ein Freilos) bekäme das Freilos
    expect(byeSwap.byeTeamId).toBe('C');
    expect(validatePairingPlan({ teams, plan: byeSwap }).warnings.join()).toMatch(/bereits 1 Freilos/);
    expect(plan.byeTeamId).toBe('E'); // Original unverändert
  });

  it('weist Mehrkosten gegenüber dem Optimum aus', () => {
    const even = teams.slice(0, 4);
    const best = pairSwissRound({ roundNumber: 4, teams: even, seed: 's' });
    const worse = swapTeams(best, best.pairings[0]!.teamAId, best.pairings[1]!.teamAId);
    const report = validatePairingPlan({ teams: even, plan: worse, seed: 's', optimalCost: best.diagnostics.objectiveCost });
    expect(report.costDelta!).toBeGreaterThan(0);
    expect(report.warnings.join()).toMatch(/Kostenpunkte schlechter/);
  });

  it('Tausch von Gegnern oder identischen Teams wird abgelehnt', () => {
    const plan = { pairings: [{ teamAId: 'A', teamBId: 'B' }] };
    expect(() => swapTeams(plan, 'A', 'B')).toThrow(/bereits gegeneinander/);
    expect(() => swapTeams(plan, 'A', 'A')).toThrow(/zwei verschiedene/);
  });
});
