// „Turnier umstellen“ gegen den Emulator: eine Transaktion für Format, Gruppen, Teamstatus und Spiele,
// öffentliche Projektion und Rückgängig. Läuft über die echte FirestoreTournamentStore-Implementierung.
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { getDoc } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { paths, type Actor, type ActorSource } from '../../src/data';
import { FORMAT_TEMPLATES } from '../../src/domain/format';
import { FirestoreTournamentStore } from '../../src/ui/data/firestoreStore';
import type { TournamentData, WizardDraft } from '../../src/ui/data/types';
import { undoChecks } from '../../src/ui/data/undo';
import { reshapeOptions } from '../../src/ui/screens/admin/stages/reshape';
import { planCreation, toPlannedMatches } from '../../src/ui/screens/wizard/plan';
import { OWNER, createEnv, dbFor } from './setup';

const fixed = (actor: Actor | null): ActorSource => ({ current: () => actor, onChange: () => () => undefined });

async function waitFor<T>(fn: () => T | undefined | false, ms = 8000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > until) throw new Error('Zeitüberschreitung beim Warten auf Daten');
    await new Promise((r) => setTimeout(r, 50));
  }
}

const TID = 'umstell-cup';
const TEAMS = ['Adler', 'Bären', 'Dachse', 'Elche', 'Füchse', 'Gämsen', 'Hasen', 'Igel'];
const format = FORMAT_TEMPLATES.find((x) => x.id === 't8')!.build();
const draft: WizardDraft = {
  id: TID,
  title: 'Umstell-Cup',
  organizerName: 'SV Test',
  venue: '',
  localDate: '2026-11-07',
  timeZone: 'Europe/Berlin',
  sponsors: [],
  teams: TEAMS.map((name, i) => ({ id: `x${i}`, name, active: true })),
  roundsTotal: 0,
  preDrawRounds: 0,
  pairingMode: 'balanced',
  tieBreakers: [],
  buchholzEnabled: false,
  fields: [
    { id: 'a', name: 'Platz 1' },
    { id: 'b', name: 'Platz 2' },
  ],
  startTime: '10:00',
  matchMinutes: 10,
  turnoverMinutes: 2,
  roundBreakMinutes: 0,
  restOptimization: true,
  hardRestMinutes: null,
  allocation: 'max_capacity',
  visibility: 'full',
  format,
  groupDraws: [{ stageId: 'vorrunde', mode: 'random', seed: 7, groups: [['x0', 'x1', 'x2', 'x3'], ['x4', 'x5', 'x6', 'x7']] }],
};

let env: RulesTestEnvironment;
let owner: FirestoreTournamentStore;
let guest: FirestoreTournamentStore;

beforeAll(async () => {
  env = await createEnv('demo-reshape');
  await env.clearFirestore();
  owner = new FirestoreTournamentStore(dbFor(env, OWNER), fixed(OWNER));
  guest = new FirestoreTournamentStore(dbFor(env, null), fixed(null));
});

afterAll(async () => {
  owner.dispose();
  guest.dispose();
  await env.cleanup();
});

const layout = (d: TournamentData) =>
  d.matches.map((m) => [m.id, m.teamAId, m.teamBId, m.startISO, m.fieldId, m.matchKey ?? '']).sort((a, b) => String(a[0]).localeCompare(String(b[0])));

describe('Turnier umstellen in Firestore', () => {
  it('stellt mit einem fehlenden Team um, zeigt es öffentlich und nimmt es wieder zurück', async () => {
    await owner.createTournament(draft, false);
    const d = await waitFor(() => !!owner.get(TID)?.groupDraws?.length && owner.get(TID));
    const sched = d.tournament.schedule;
    const plan = planCreation(
      format,
      8,
      d.fields.map((f) => ({ id: f.id, name: f.name, order: f.order, active: f.active })),
      { tournamentStartISO: sched.tournamentStartISO, matchMinutes: sched.matchMinutes, turnoverMinutes: sched.turnoverMinutes, roundBreakMinutes: sched.roundBreakMinutes },
      d.groupDraws![0]!.groups,
    );
    await owner.saveStagePlan(TID, toPlannedMatches(format, plan, sched.matchMinutes));
    await owner.publishTournament(TID);
    const ready = await waitFor(() => owner.get(TID)?.matches.length === 18 && owner.get(TID)?.tournament.status === 'published' && owner.get(TID));
    const before = structuredClone(ready);
    const missing = ready.groupDraws![0]!.groups[1]![3]!;

    const [gap] = reshapeOptions(ready, [missing]);
    expect(gap?.suggestion.kind).toBe('gap');
    await owner.reshapeTournament(TID, {
      title: gap!.suggestion.title,
      format: gap!.suggestion.format,
      groups: gap!.suggestion.groups,
      missingTeamIds: [missing],
      plan: gap!.plan,
    });
    const after = await waitFor(() => owner.get(TID)?.teams.find((t) => t.id === missing)?.status === 'no_show' && owner.get(TID)?.matches.length === 14 && owner.get(TID));
    expect(after.groupDraws![0]!.groups[1]).toHaveLength(3);
    expect(after.tournament.format).toEqual(gap!.suggestion.format);
    expect(after.matches.some((m) => m.matchKey === 'P7')).toBe(false);
    const pubStage = await getDoc(paths.publicStage(dbFor(env, null), TID, 'vorrunde'));
    expect(pubStage.data()?.groups[1]?.teamIds).toHaveLength(3);
    const view = await waitFor(() => guest.getPublic(TID)?.matches.length === 14 && guest.getPublic(TID));
    expect(view.format).toEqual(gap!.suggestion.format);

    const history = await owner.loadHistory(TID);
    expect(history[0]!.action).toBe('tournament.reshape');
    expect(undoChecks(history, after).get(history[0]!.id)?.ok).toBe(true);
    await owner.undoHistory(TID, history[0]!);
    const back = await waitFor(() => owner.get(TID)?.teams.find((t) => t.id === missing)?.status === 'active' && owner.get(TID)?.matches.length === 18 && owner.get(TID));
    expect(back.tournament.format).toEqual(before.tournament.format);
    expect(back.groupDraws![0]!.groups).toEqual(before.groupDraws![0]!.groups);
    expect(layout(back)).toEqual(layout(before));
  });
});
