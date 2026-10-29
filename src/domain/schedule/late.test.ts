// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { laterSwapOptions } from './late';
import type { EditableMatch } from './swap';

const T = (hhmm: string) => `2026-06-13T${hhmm}:00.000Z`;
const g = (id: string, a: string, b: string, field: string, hhmm: string, groupIndex = 0, extra: Partial<EditableMatch> = {}): EditableMatch => ({
  id,
  stageId: 'vr',
  groupIndex,
  teamAId: a,
  teamBId: b,
  fieldId: field,
  startISO: T(hhmm),
  durationMinutes: 10,
  ...extra,
});

// Gruppe A (a,b,c,d) auf Feld 1, Gruppe B (e,f,g,h) auf Feld 2, alle 12 Minuten.
const plan = (): EditableMatch[] => [
  g('a1', 'a', 'b', 'f1', '10:00'),
  g('a2', 'c', 'd', 'f1', '10:12'),
  g('a3', 'a', 'c', 'f1', '10:24'),
  g('a4', 'b', 'd', 'f1', '10:36'),
  g('a5', 'a', 'd', 'f1', '10:48'),
  g('a6', 'b', 'c', 'f1', '11:00'),
  g('b1', 'e', 'f', 'f2', '10:00', 1),
  g('b2', 'g', 'h', 'f2', '10:12', 1),
];

describe('Team kommt zu spät: Spiel nach hinten tauschen', () => {
  it('schlägt spätere Spiele derselben Gruppe ohne das späte Team vor, das früheste zuerst', () => {
    const r = laterSwapOptions(plan(), 'a1', 'a');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // a4 (b–d) und a6 (b–c): nur ein Team rückt vor sein bisher erstes Spiel (10:12), bei a2 (c–d) beide.
    expect(r.options.map((o) => o.matchId)).toEqual(['a4', 'a6', 'a2']);
    expect(r.options[0]).toMatchObject({ startISO: T('10:36'), fieldId: 'f1', delayMinutes: 36, earlyTeamIds: ['d'] });
    expect(r.options[2]).toMatchObject({ startISO: T('10:12'), delayMinutes: 12, earlyTeamIds: ['c', 'd'] });
  });

  it('nie Spiele anderer Gruppen, mit dem späten Team, schon angepfiffene oder frühere', () => {
    const ms = plan();
    ms[1] = { ...ms[1]!, status: 'live' };
    const r = laterSwapOptions(ms, 'a3', 'a');
    expect(r.ok && r.options.map((o) => o.matchId)).toEqual(['a4', 'a6']);
  });

  it('keine Tausche, durch die ein Team zwei Spiele gleichzeitig hätte', () => {
    // Zusätzliches Spiel b–x um 11:00 auf Feld 2, gleichzeitig mit a6 (b–c): a1 (a–b) auf 11:00 gäbe b zwei Spiele gleichzeitig.
    const ms = [...plan(), g('a7', 'b', 'x', 'f2', '11:00')];
    const r = laterSwapOptions(ms, 'a1', 'a');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.options.map((o) => o.matchId)).toEqual(['a4', 'a2']);
    for (const o of r.options) expect(o.issues.every((i) => i.kind === 'rest')).toBe(true);
  });

  it('meldet verständliche Fehler', () => {
    expect(laterSwapOptions(plan(), 'x', 'a')).toEqual({ ok: false, error: 'Das Spiel gibt es nicht (mehr).' });
    expect(laterSwapOptions(plan(), 'a1', 'e')).toEqual({ ok: false, error: 'Das Team spielt nicht in diesem Spiel.' });
    const ms = plan();
    ms[0] = { ...ms[0]!, status: 'completed' };
    expect(laterSwapOptions(ms, 'a1', 'a').ok).toBe(false);
  });

  it('ohne Hinweis „vielleicht noch nicht da“ geht vor', () => {
    // c fehlt um 10:12: a4 (b–d) und a5 (a–d) rücken vor, a und b haben dort schon gespielt, d sowieso.
    const r = laterSwapOptions(plan(), 'a2', 'c');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.options.every((o) => o.earlyTeamIds.length === 0)).toBe(true);
  });
});
