// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { checkRoundConfiguration, maxRoundsWithoutRepeat, previewDrawRounds } from './draw';
import { MeetingCounter } from './meetings';
import { teamId } from './testing/simulate';
import type { PairingPlan } from './types';

const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: teamId(i) }));

function countRepeats(plans: PairingPlan[], fixed: MeetingCounter = new MeetingCounter()): number {
  const c = fixed.clone();
  let repeats = 0;
  for (const p of plans) {
    for (const m of p.pairings) {
      if (c.count(m.teamAId, m.teamBId) > 0) repeats++;
      c.add(m.teamAId, m.teamBId);
    }
  }
  return repeats;
}

describe('Losrunden (vorab ausgelost)', () => {
  it('erzeugt bis zur theoretischen Grenze Runden ganz ohne Wiederholung', () => {
    for (let n = 2; n <= 20; n++) {
      const count = maxRoundsWithoutRepeat(n);
      const { plans, warnings } = previewDrawRounds({ teams: ids(n), count, seed: `max-${n}` });
      expect(plans).toHaveLength(count);
      expect(warnings).toEqual([]);
      expect(countRepeats(plans)).toBe(0);
      for (const p of plans) {
        expect(p.kind).toBe('draw');
        expect(p.pairings).toHaveLength(Math.floor(n / 2));
        const seen = new Set(p.pairings.flatMap((m) => [m.teamAId, m.teamBId]));
        if (p.byeTeamId) seen.add(p.byeTeamId);
        expect(seen.size).toBe(n);
      }
      if (n % 2 === 1) {
        // Jedes Team genau ein Freilos über n Runden
        expect(new Set(plans.map((p) => p.byeTeamId)).size).toBe(n);
      }
    }
  });

  it('nummeriert Runden fortlaufend und ist per Seed reproduzierbar', () => {
    const a = previewDrawRounds({ teams: ids(16), count: 2, seed: 'turnier-1', firstRoundNumber: 1 });
    const b = previewDrawRounds({ teams: ids(16), count: 2, seed: 'turnier-1', firstRoundNumber: 1 });
    expect(a).toEqual(b);
    expect(a.plans.map((p) => p.roundNumber)).toEqual([1, 2]);
    const c = previewDrawRounds({ teams: ids(16), count: 2, seed: 'turnier-2' });
    expect(c.plans[0]!.pairings).not.toEqual(a.plans[0]!.pairings);
  });

  it('Neuauslosung respektiert bereits veröffentlichte Runden (keine Wiederholung)', () => {
    for (let s = 0; s < 30; s++) {
      const n = 6 + (s % 11);
      const first = previewDrawRounds({ teams: ids(n), count: 1, seed: `fix-${s}` }).plans[0]!;
      const fixed = first.pairings.map((p) => ({ teamAId: p.teamAId, teamBId: p.teamBId, roundNumber: 1 }));
      const byes = new Map<string, number>();
      if (first.byeTeamId) byes.set(first.byeTeamId, 1);
      const count = Math.min(3, maxRoundsWithoutRepeat(n) - 1);
      const redraw = previewDrawRounds({
        teams: ids(n).map((t) => ({ ...t, byes: byes.get(t.id) ?? 0 })),
        count,
        firstRoundNumber: 2,
        seed: `redraw-${s}`,
        meetings: fixed,
      });
      expect(redraw.plans.map((p) => p.roundNumber)).toEqual(Array.from({ length: count }, (_, i) => i + 2));
      expect(countRepeats(redraw.plans, new MeetingCounter(fixed))).toBe(0);
      if (first.byeTeamId) {
        expect(redraw.plans.map((p) => p.byeTeamId)).not.toContain(first.byeTeamId);
      }
    }
  });

  it('warnt bei zu vielen Losrunden und verteilt Wiederholungen gleichmäßig', () => {
    const { plans, warnings } = previewDrawRounds({ teams: ids(4), count: 5, seed: 'zu-viele' });
    expect(warnings[0]).toMatch(/höchstens 3 Losrunden/);
    expect(plans).toHaveLength(5);
    const counter = new MeetingCounter();
    for (const p of plans) for (const m of p.pairings) counter.add(m.teamAId, m.teamBId);
    // 5 Runden bei 4 Teams: keine Paarung öfter als zweimal
    for (const a of ids(4)) for (const b of ids(4)) if (a.id < b.id) expect(counter.count(a.id, b.id)).toBeLessThanOrEqual(2);
    expect(plans.slice(3).every((p) => p.diagnostics.repeats === 2)).toBe(true);
  });

  it('liefert für 0 Runden oder < 2 Teams nichts', () => {
    expect(previewDrawRounds({ teams: ids(10), count: 0, seed: 's' }).plans).toEqual([]);
    expect(previewDrawRounds({ teams: ids(1), count: 2, seed: 's' }).plans).toEqual([]);
  });
});

describe('checkRoundConfiguration', () => {
  it('meldet unmögliche und auffällige Einstellungen', () => {
    expect(checkRoundConfiguration(16, 8, 2)).toEqual([]);
    expect(checkRoundConfiguration(16, 8, 9)[0]).toMatch(/mehr Losrunden/);
    expect(checkRoundConfiguration(6, 8, 6).join(' ')).toMatch(/höchstens 5 Runden/);
    expect(checkRoundConfiguration(6, 8, 2).join(' ')).toMatch(/Wiederholungen sind im Turnierverlauf unvermeidbar/);
    expect(checkRoundConfiguration(16, 3, 3).join(' ')).toMatch(/Alle Runden werden ausgelost/);
  });
});
