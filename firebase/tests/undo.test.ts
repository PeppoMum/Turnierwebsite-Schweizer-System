// „Rückgängig“ im Verlauf über die Firestore-Implementierung, gegen die echten Schutzregeln:
// jeder Rückgängig-Schritt muss mit den bestehenden Regeln durchgehen (keine Regeländerung nötig).
import { type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { getDoc } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { paths, type Actor, type ActorSource } from '../../src/data';
import { FirestoreTournamentStore } from '../../src/ui/data/firestoreStore';
import { describeHistory } from '../../src/ui/data/history';
import type { HistoryEntry, WizardDraft } from '../../src/ui/data/types';
import { undoChecks } from '../../src/ui/data/undo';
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

const draft: WizardDraft = {
  id: 'undo-cup',
  title: 'Undo-Cup',
  organizerName: 'SV Test',
  venue: 'Platzanlage',
  localDate: '2026-11-07',
  timeZone: 'Europe/Berlin',
  sponsors: [],
  teams: ['Adler', 'Bären', 'Dachse', 'Elche', 'Füchse', 'Geier'].map((name, i) => ({ id: `x${i}`, name, active: true })),
  roundsTotal: 3,
  preDrawRounds: 1,
  pairingMode: 'balanced',
  tieBreakers: ['head_to_head', 'goal_diff', 'goals_for'],
  buchholzEnabled: false,
  fields: [{ id: 'a', name: 'Platz 1' }, { id: 'b', name: 'Platz 2' }],
  startTime: '10:00',
  matchMinutes: 12,
  turnoverMinutes: 3,
  roundBreakMinutes: 5,
  restOptimization: false,
  hardRestMinutes: null,
  allocation: 'max_capacity',
  visibility: 'full',
};

let env: RulesTestEnvironment;
let owner: FirestoreTournamentStore;
let tid: string;

beforeAll(async () => {
  env = await createEnv('demo-undo');
  await env.clearFirestore();
  owner = new FirestoreTournamentStore(dbFor(env, OWNER), fixed(OWNER));
  tid = await owner.createTournament(draft, true);
  await waitFor(() => owner.get(tid)?.rounds[0]?.status === 'published' && owner.get(tid)!.matches.length === 3);
});

afterAll(async () => {
  owner.dispose();
  await env.cleanup();
});

/** Neuester Verlaufseintrag, sobald er den Server-Zeitstempel hat. */
async function newest(action: string): Promise<HistoryEntry> {
  for (let i = 0; i < 40; i++) {
    const e = (await owner.loadHistory(tid))[0];
    if (e?.action === action && e.atISO) return e;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Kein Eintrag ${action}`);
}

async function undo(action: string): Promise<HistoryEntry> {
  const entry = await newest(action);
  const check = undoChecks(await owner.loadHistory(tid), owner.get(tid)!).get(entry.id);
  expect(check).toMatchObject({ ok: true });
  await owner.undoHistory(tid, entry);
  return entry;
}

describe('Rückgängig im Verlauf (Firestore)', () => {
  it('Endstand zurücknehmen und wiederherstellen, öffentliche Tore ziehen mit', async () => {
    const m = owner.get(tid)!.matches[0]!;
    await owner.recordScore(tid, m.id, 2, 1);
    await waitFor(() => owner.get(tid)?.matches.find((x) => x.id === m.id)?.goalsA === 2);
    await owner.setMatchStatus(tid, m.id, 'completed');
    await waitFor(() => owner.get(tid)?.matches.find((x) => x.id === m.id)?.status === 'completed');

    const final = await undo('match.result.final');
    await waitFor(() => owner.get(tid)?.matches.find((x) => x.id === m.id)?.status === 'live');
    expect(owner.get(tid)!.matches.find((x) => x.id === m.id)).toMatchObject({ goalsA: 2, goalsB: 1 });
    const pub = (await getDoc(paths.publicMatch(dbFor(env, null), tid, m.id))).data()!;
    expect(pub.status).toBe('live');

    const entries = await owner.loadHistory(tid);
    expect(entries[0]!.after).toMatchObject({ undoOf: final.id });
    const lines = describeHistory(entries, owner.get(tid)!);
    expect(lines[0]!.text).toMatch(/^Rückgängig gemacht: Endstand/);
    expect(lines.find((l) => l.id === final.id)!.undone).toBe(true);

    // Den Rückgängig-Schritt selbst zurücknehmen: wieder beendet.
    await undo('match.undo');
    await waitFor(() => owner.get(tid)?.matches.find((x) => x.id === m.id)?.status === 'completed');
    const result = (await getDoc(paths.publicResult(dbFor(env, null), tid, m.id))).data()!;
    expect(result).toMatchObject({ goalsA: 2, goalsB: 1 });
  });

  it('Abmeldung zurücknehmen plant die ausgefallenen Spiele wieder', async () => {
    const m = owner.get(tid)!.matches.find((x) => x.status === 'scheduled')!;
    await owner.withdrawTeam(tid, m.teamAId);
    await waitFor(() => owner.get(tid)?.matches.find((x) => x.id === m.id)?.status === 'not_played');
    const entry = await newest('team.no_show');
    expect(entry.after).toMatchObject({ matchIds: [m.id] });

    await undo('team.no_show');
    await waitFor(() => owner.get(tid)?.teams.find((t) => t.id === m.teamAId)?.status === 'active');
    await waitFor(() => owner.get(tid)?.matches.find((x) => x.id === m.id)?.status === 'scheduled');
    const pub = (await getDoc(paths.publicMatch(dbFor(env, null), tid, m.id))).data()!;
    expect(pub.status).toBe('scheduled');
  });

  it('Zeitverschiebung, Sichtbarkeit, Turnierdaten und Umbenennung zurücknehmen', async () => {
    const m = owner.get(tid)!.matches.find((x) => x.status === 'scheduled')!;
    await owner.shiftFutureMatches(tid, 15);
    await waitFor(() => owner.get(tid)?.matches.find((x) => x.id === m.id)?.startISO !== m.startISO);
    await undo('schedule.shift');
    await waitFor(() => owner.get(tid)?.matches.find((x) => x.id === m.id)?.startISO === m.startISO);

    await owner.setVisibility(tid, 'no_standings');
    await waitFor(() => owner.get(tid)?.tournament.visibility === 'no_standings');
    await undo('tournament.visibility');
    await waitFor(() => owner.get(tid)?.tournament.visibility === 'full');

    const d = owner.get(tid)!;
    await owner.updateDetails(tid, { title: 'Anders', organizerName: 'SV Test', venue: '', localDate: d.tournament.localDate, sponsors: [] });
    await waitFor(() => owner.get(tid)?.tournament.title === 'Anders');
    await undo('tournament.update');
    await waitFor(() => owner.get(tid)?.tournament.title === 'Undo-Cup' && owner.get(tid)?.tournament.venue === 'Platzanlage');

    const team = owner.get(tid)!.teams[0]!;
    await owner.saveTeam(tid, team.id, { name: 'Neu' });
    await waitFor(() => owner.get(tid)?.teams.find((t) => t.id === team.id)?.name === 'Neu');
    await undo('team.update');
    await waitFor(() => owner.get(tid)?.teams.find((t) => t.id === team.id)?.name === team.name);
  });

  it('Runde abschließen und Turnierende zurücknehmen', async () => {
    for (const m of owner.get(tid)!.matches.filter((x) => x.status !== 'completed')) {
      await owner.setMatchStatus(tid, m.id, 'completed');
    }
    await waitFor(() => owner.get(tid)?.matches.every((x) => x.status === 'completed'));
    await owner.closeCurrentRound(tid);
    await waitFor(() => owner.get(tid)?.rounds[0]?.status === 'closed');
    await undo('round.close');
    await waitFor(() => owner.get(tid)?.rounds[0]?.status === 'active');
    const pubRound = (await getDoc(paths.publicRound(dbFor(env, null), tid, owner.get(tid)!.rounds[0]!.id))).data()!;
    expect(pubRound.status).toBe('active');

    await owner.finishTournament(tid);
    await waitFor(() => owner.get(tid)?.tournament.status === 'finished');
    await undo('tournament.status.finished');
    await waitFor(() => owner.get(tid)?.tournament.status === 'running');
  });
});
