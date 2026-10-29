// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { checkStageSchedule, moveMatch, shiftFrom, swapMatchTimes, swapOpponents, type EditableMatch } from './swap';

const T = (hhmm: string) => `2026-06-13T${hhmm}:00.000Z`;

const base = (): EditableMatch[] => [
  { id: 'qf1', stageId: 'ko', matchKey: 'QF1', teamAId: 'a', teamBId: 'b', fieldId: 'f1', startISO: T('10:00'), durationMinutes: 12 },
  { id: 'qf2', stageId: 'ko', matchKey: 'QF2', teamAId: 'c', teamBId: 'd', fieldId: 'f2', startISO: T('10:00'), durationMinutes: 12 },
  { id: 'qf3', stageId: 'ko', matchKey: 'QF3', teamAId: 'e', teamBId: 'f', fieldId: 'f1', startISO: T('10:15'), durationMinutes: 12 },
  {
    id: 'sf1',
    stageId: 'ko',
    matchKey: 'SF1',
    slotA: { kind: 'winner', stageId: 'ko', matchKey: 'QF1' },
    slotB: { kind: 'winner', stageId: 'ko', matchKey: 'QF2' },
    fieldId: 'f1',
    startISO: T('10:30'),
    durationMinutes: 12,
  },
];

describe('Handänderungen am Spielplan', () => {
  it('zwei Spiele tauschen Uhrzeit und Feld und werden als Handänderung markiert', () => {
    const r = swapMatchTimes(base(), 'qf2', 'qf3');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const qf2 = r.matches.find((m) => m.id === 'qf2')!;
    const qf3 = r.matches.find((m) => m.id === 'qf3')!;
    expect([qf2.startISO, qf2.fieldId, qf2.manual]).toEqual([T('10:15'), 'f1', true]);
    expect([qf3.startISO, qf3.fieldId, qf3.manual]).toEqual([T('10:00'), 'f2', true]);
    expect(r.changedIds.sort()).toEqual(['qf2', 'qf3']);
    // QF2 endet jetzt 10:27, SF1 beginnt 10:30: nur 3 Minuten Pause für den Sieger.
    const r2 = swapMatchTimes(base(), 'qf2', 'qf3', { desiredRestMinutes: 10 });
    expect(r2.ok && r2.issues.map((i) => i.message)).toEqual(['Sieger QF2 hat vor SF1 nur 3 Minuten Pause (gewünscht: 10).']);
  });

  it('laufende und beendete Spiele sind gesperrt', () => {
    const ms = base();
    ms[0] = { ...ms[0]!, status: 'live' };
    const r = swapMatchTimes(ms, 'qf1', 'qf3');
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/läuft schon oder ist vorbei/) });
    expect(moveMatch(ms, 'qf1', { fieldId: 'f3' }).ok).toBe(false);
    expect(swapOpponents(ms, { matchId: 'qf1', side: 'A' }, { matchId: 'qf2', side: 'A' }).ok).toBe(false);
  });

  it('Gegner tauschen: bekannte Teams werden fest gesetzt, Platzhalter wandern mit', () => {
    const r = swapOpponents(base(), { matchId: 'qf1', side: 'B' }, { matchId: 'sf1', side: 'A' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const qf1 = r.matches.find((m) => m.id === 'qf1')!;
    const sf1 = r.matches.find((m) => m.id === 'sf1')!;
    expect([qf1.teamBId, qf1.slotB]).toEqual([undefined, { kind: 'winner', stageId: 'ko', matchKey: 'QF1' }]);
    expect([sf1.teamAId, sf1.slotA]).toEqual(['b', { kind: 'team', teamId: 'b' }]);
    expect(swapOpponents(base(), { matchId: 'qf1', side: 'A' }, { matchId: 'qf1', side: 'B' }).ok).toBe(false);
  });

  it('kein Team gegen sich selbst', () => {
    const ms = base();
    ms[1] = { ...ms[1]!, teamAId: 'b' }; // b spielt dann in qf1 und qf2
    expect(swapOpponents(ms, { matchId: 'qf1', side: 'A' }, { matchId: 'qf2', side: 'A' })).toEqual({
      ok: false,
      error: 'Ein Team kann nicht gegen sich selbst spielen.',
    });
  });

  it('warnt statt zu verbieten: Feld doppelt, Team gleichzeitig, K.-o.-Spiel vor seinem Vorgänger', () => {
    const names = new Map([
      ['a', 'Adler'],
      ['e', 'Eulen'],
    ]);
    const r = moveMatch(base(), 'qf3', { startISO: T('10:00'), fieldId: 'f2' }, { teamNames: names, fieldNames: new Map([['f2', 'Platz B']]) });
    expect(r.ok && r.issues.map((i) => i.kind)).toEqual(['field']);
    const r2 = moveMatch(base(), 'sf1', { startISO: T('10:05') }, { turnoverMinutes: 3 });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.issues.map((i) => i.kind)).toContain('order');
    expect(r2.issues.find((i) => i.kind === 'order')!.message).toBe('SF1 beginnt, bevor QF1 vorbei ist.');
    const ms = base();
    ms[2] = { ...ms[2]!, teamAId: 'a', startISO: T('10:05'), fieldId: 'f3' };
    expect(checkStageSchedule(ms, { teamNames: names }).map((i) => i.message)).toEqual(['Adler wäre gleichzeitig in zwei Spielen eingeplant.']);
  });

  it('ab Zeitpunkt verschieben lässt frühere und gesperrte Spiele stehen', () => {
    const ms = base();
    ms[2] = { ...ms[2]!, status: 'completed' };
    const r = shiftFrom(ms, 20, T('10:15'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.matches.map((m) => m.startISO)).toEqual([T('10:00'), T('10:00'), T('10:15'), T('10:50')]);
    expect(r.changedIds).toEqual(['sf1']);
    expect(r.matches[3]!.manual).toBe(true);
  });
});
