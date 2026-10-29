import { describe, expect, it } from 'vitest';
import { planReferees, refereeClash, usualDuration, type RefMatch } from './plan';

const at = (hhmm: string) => `2026-11-01T${hhmm}:00.000Z`;
const m = (id: string, hhmm: string, minutes = 10): RefMatch => ({ id, startISO: at(hhmm), durationMinutes: minutes });

describe('planReferees', () => {
  it('verteilt gleichzeitige Spiele auf verschiedene Schiris', () => {
    const matches = [m('a', '10:00'), m('b', '10:00'), m('c', '10:15'), m('d', '10:15')];
    const plan = planReferees({ matches, refereeIds: ['r1', 'r2'], existing: new Map(), scope: ['a', 'b', 'c', 'd'], keepExisting: true });
    const by = new Map(plan.assignments.map((x) => [x.matchId, x.refereeId]));
    expect(by.get('a')).not.toBe(by.get('b'));
    expect(by.get('c')).not.toBe(by.get('d'));
    expect(plan.unassigned).toEqual([]);
    expect(plan.counts).toEqual({ r1: 2, r2: 2 });
  });

  it('gibt Pausen, wenn mehr Schiris als Felder da sind', () => {
    const matches = [m('a', '10:00'), m('b', '10:00'), m('c', '10:15'), m('d', '10:15'), m('e', '10:30'), m('f', '10:30')];
    const plan = planReferees({ matches, refereeIds: ['r1', 'r2', 'r3'], existing: new Map(), scope: matches.map((x) => x.id), keepExisting: true });
    const by = new Map(plan.assignments.map((x) => [x.matchId, x.refereeId]));
    // Wer um 10:00 frei hatte, ist um 10:15 dran.
    expect([by.get('c'), by.get('d')]).toContain('r3');
    expect(Object.values(plan.counts)).toEqual([2, 2, 2]);
  });

  it('lässt Spiele frei, wenn zu der Zeit kein Schiri mehr frei ist', () => {
    const matches = [m('a', '10:00'), m('b', '10:00'), m('c', '10:00')];
    const plan = planReferees({ matches, refereeIds: ['r1', 'r2'], existing: new Map(), scope: ['a', 'b', 'c'], keepExisting: true });
    expect(plan.assignments).toHaveLength(2);
    expect(plan.unassigned).toEqual(['c']);
  });

  it('behält vorhandene Einteilungen und zählt sie mit', () => {
    const matches = [m('a', '10:00'), m('b', '10:15'), m('c', '10:30')];
    const existing = new Map([['a', 'r1']]);
    const plan = planReferees({ matches, refereeIds: ['r1', 'r2'], existing, scope: ['a', 'b', 'c'], keepExisting: true });
    expect(plan.assignments.map((x) => x.matchId)).toEqual(['b', 'c']);
    expect(plan.assignments[0]!.refereeId).toBe('r2');
    expect(plan.counts).toEqual({ r1: 2, r2: 1 });
  });

  it('teilt neu ein, wenn vorhandene nicht behalten werden sollen, achtet aber auf Spiele außerhalb', () => {
    const matches = [m('a', '10:00'), m('b', '10:00'), m('c', '10:20')];
    const existing = new Map([
      ['a', 'r1'],
      ['b', 'r1'],
    ]);
    const plan = planReferees({ matches, refereeIds: ['r1', 'r2'], existing, scope: ['b', 'c'], keepExisting: false });
    const by = new Map(plan.assignments.map((x) => [x.matchId, x.refereeId]));
    expect(by.get('b')).toBe('r2');
    expect(plan.counts.r1! + plan.counts.r2!).toBe(3);
  });

  it('achtet auf längere Spiele', () => {
    const matches = [m('a', '10:00', 30), m('b', '10:15'), m('c', '10:15')];
    const plan = planReferees({ matches, refereeIds: ['r1', 'r2', 'r3'], existing: new Map(), scope: ['a', 'b', 'c'], keepExisting: true });
    const by = new Map(plan.assignments.map((x) => [x.matchId, x.refereeId]));
    expect(by.get('b')).not.toBe(by.get('a'));
    expect(by.get('c')).not.toBe(by.get('a'));
  });

  it('macht ohne Uhrzeit keinen Vorschlag und ignoriert unbekannte Schiris', () => {
    const matches = [{ id: 'x', durationMinutes: 10 }, m('a', '10:00')];
    const plan = planReferees({ matches, refereeIds: ['r1'], existing: new Map([['a', 'weg']]), scope: ['x', 'a'], keepExisting: true });
    expect(plan.unassigned).toEqual(['x']);
    expect(plan.assignments).toEqual([{ matchId: 'a', refereeId: 'r1' }]);
  });
});

describe('refereeClash', () => {
  it('findet ein gleichzeitiges Spiel desselben Schiris', () => {
    const matches = [m('a', '10:00'), m('b', '10:05'), m('c', '10:10')];
    const assigned = new Map([['a', 'r1']]);
    expect(refereeClash(matches, assigned, 'r1', 'b')).toBe('a');
    expect(refereeClash(matches, assigned, 'r1', 'c')).toBeNull();
    expect(refereeClash(matches, assigned, 'r2', 'b')).toBeNull();
  });
});

describe('usualDuration', () => {
  it('nimmt die häufigste Dauer', () => {
    expect(usualDuration([{ durationMinutes: 10 }, { durationMinutes: 15 }, { durationMinutes: 10 }])).toBe(10);
    expect(usualDuration([])).toBeNull();
  });
});
