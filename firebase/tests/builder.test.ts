// Turnier-Baukasten gegen den Emulator: Ablage, Schutzregeln und öffentliche Projektion
// (docs/turnier-baukasten.md). Läuft über die echte FirestoreTournamentStore-Implementierung.
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { paths, type Actor, type ActorSource } from '../../src/data';
import { FORMAT_TEMPLATES } from '../../src/domain/format';
import { FirestoreTournamentStore } from '../../src/ui/data/firestoreStore';
import type { TournamentData, WizardDraft } from '../../src/ui/data/types';
import { HELPER, OWNER, createEnv, dbFor, forceSet } from './setup';

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

const TEAMS = ['Adler', 'Bären', 'Dachse', 'Elche', 'Füchse', 'Gämsen', 'Hasen', 'Igel'];

const draft: WizardDraft = {
  id: 'gruppen-cup',
  title: 'Gruppen-Cup',
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
  fields: [{ id: 'a', name: 'Platz 1' }, { id: 'b', name: 'Platz 2' }],
  startTime: '10:00',
  matchMinutes: 10,
  turnoverMinutes: 2,
  roundBreakMinutes: 0,
  restOptimization: true,
  hardRestMinutes: null,
  allocation: 'max_capacity',
  visibility: 'full',
  format: FORMAT_TEMPLATES[0]!.build(),
  groupDraws: [{ stageId: 'vorrunde', mode: 'random', seed: 7, groups: [['x0', 'x1', 'x2', 'x3'], ['x4', 'x5', 'x6', 'x7']] }],
};

let env: RulesTestEnvironment;
let owner: FirestoreTournamentStore;
let helper: FirestoreTournamentStore;
let guest: FirestoreTournamentStore;
const TID = 'gruppen-cup';

const t = (i: number) => `${TID}-t${i + 1}`;
const at = (min: number) => new Date(Date.parse('2026-11-07T09:00:00.000Z') + min * 60000).toISOString();
const byKey = (d: TournamentData, key: string) => d.matches.find((m) => m.matchKey === key)!;

beforeAll(async () => {
  env = await createEnv('demo-builder');
  await env.clearFirestore();
  owner = new FirestoreTournamentStore(dbFor(env, OWNER), fixed(OWNER));
  helper = new FirestoreTournamentStore(dbFor(env, HELPER), fixed(HELPER));
  guest = new FirestoreTournamentStore(dbFor(env, null), fixed(null));
});

afterAll(async () => {
  owner.dispose();
  helper.dispose();
  guest.dispose();
  await env.cleanup();
});

describe('Turnier-Baukasten in Firestore', () => {
  it('legt ein Turnier mit Ablauf und Gruppen an, ohne Schweizer-System-Runde und noch nicht öffentlich', async () => {
    expect(await owner.createTournament(draft, false)).toBe(TID);
    const d = await waitFor(() => !!owner.get(TID)?.groupDraws?.length && owner.get(TID));
    expect(d.tournament.format).toEqual(draft.format);
    expect(d.rounds).toHaveLength(0);
    expect(d.groupDraws![0]!.groups).toEqual([[0, 1, 2, 3].map(t), [4, 5, 6, 7].map(t)]);
    await assertFails(getDoc(paths.publicStage(dbFor(env, null), TID, 'vorrunde')));
  });

  it('speichert den Spielplan mit Platzhaltern und veröffentlicht ihn', async () => {
    const ids = await owner.saveStagePlan(TID, [
      { stageId: 'vorrunde', groupIndex: 0, teamAId: t(0), teamBId: t(1), fieldId: `${TID}-f1`, startISO: at(0), durationMinutes: 10 },
      { stageId: 'vorrunde', groupIndex: 1, teamAId: t(4), teamBId: t(5), fieldId: `${TID}-f2`, startISO: at(0), durationMinutes: 10 },
      {
        stageId: 'endrunde',
        matchKey: 'SF1',
        slotA: { kind: 'group_place', stageId: 'vorrunde', group: 0, place: 1 },
        slotB: { kind: 'group_place', stageId: 'vorrunde', group: 1, place: 2 },
        fieldId: `${TID}-f1`,
        startISO: at(60),
        durationMinutes: 10,
      },
      {
        stageId: 'endrunde',
        matchKey: 'F',
        slotA: { kind: 'winner', stageId: 'endrunde', matchKey: 'SF1' },
        slotB: { kind: 'winner', stageId: 'endrunde', matchKey: 'SF2' },
        fieldId: `${TID}-f2`,
        startISO: at(90),
        durationMinutes: 10,
      },
    ]);
    expect(ids).toHaveLength(4);
    const d = await waitFor(() => owner.get(TID)?.matches.length === 4 && owner.get(TID));
    expect(byKey(d, 'SF1')).toMatchObject({ teamAId: '', teamBId: '', status: 'scheduled', roundId: `${TID}-endrunde` });

    await owner.publishTournament(TID);
    const view = await waitFor(() => guest.getPublic(TID)?.matches.length === 4 && guest.getPublic(TID));
    expect(view.format).toEqual(draft.format);
    expect(view.groupDraws).toEqual([{ stageId: 'vorrunde', groups: d.groupDraws![0]!.groups }]);
    expect(view.matches.find((m) => m.matchKey === 'F')).toMatchObject({ slotA: { kind: 'winner', matchKey: 'SF1' }, teamAId: '' });
    expect(view.standings).toBeUndefined();
  });

  it('nach dem Anpfiff in der Vorrunde lassen sich die Gruppen nicht mehr ändern', async () => {
    const d = owner.get(TID)!;
    const g = d.matches.find((m) => m.groupIndex === 0)!;
    await owner.setMatchStatus(TID, g.id, 'live');
    await waitFor(() => owner.get(TID)?.matches.find((m) => m.id === g.id)?.status === 'live');
    await expect(owner.saveGroupDraw(TID, { stageId: 'vorrunde', mode: 'manual', groups: [...d.groupDraws![0]!.groups].reverse() })).rejects.toThrow(
      /schon gespielt/,
    );
  });

  it('Team kommt zu spät: Gruppenspiel kampflos 2:0, öffentlich sichtbar, rückgängig machbar', async () => {
    const g = owner.get(TID)!.matches.find((m) => m.groupIndex === 1)!;
    await owner.recordWalkover(TID, g.id, 'A');
    const done = await waitFor(() => owner.get(TID)?.matches.find((m) => m.id === g.id && m.status === 'completed'));
    expect(done).toMatchObject({ goalsA: 2, goalsB: 0, decidedBy: 'walkover', walkoverWinner: 'A' });
    const pub = await waitFor(() => guest.getPublic(TID)?.matches.find((m) => m.id === g.id && m.status === 'completed'));
    expect(pub).toMatchObject({ decidedBy: 'walkover', walkoverWinner: 'A' });
    expect(owner.get(TID)!.teams.find((x) => x.id === g.teamBId)!.status).toBe('active');

    const history = await owner.loadHistory(TID);
    expect(history[0]).toMatchObject({ action: 'match.walkover', targetId: g.id });
    await owner.undoHistory(TID, history[0]!);
    const back = await waitFor(() => owner.get(TID)?.matches.find((m) => m.id === g.id && m.status === 'scheduled'));
    expect(back.goalsA).toBeUndefined();
    expect(back.decidedBy).toBeUndefined();
    expect(back.walkoverWinner).toBeUndefined();
  });

  it('Turnierleitung füllt die Endrunde und tauscht; Helfer dürfen das nicht', async () => {
    await forceSet(env, `tournaments/${TID}/roleGrants/${HELPER.uid}`, {
      uid: HELPER.uid,
      tournamentId: TID,
      role: 'results_helper',
      createdAt: new Date(),
      createdBy: OWNER.uid,
    });
    const sf1 = byKey(owner.get(TID)!, 'SF1');
    // Ohne Teams kein Ergebnis, auch nicht für Helfer.
    await waitFor(() => helper.get(TID));
    await expect(helper.recordScore(TID, sf1.id, 1, 0)).rejects.toThrow(/stehen noch nicht fest/);
    await assertFails(
      updateDoc(doc(dbFor(env, HELPER), `tournaments/${TID}/matches/${sf1.id}`), { status: 'live', revision: sf1.revision + 1, updatedAt: serverTimestamp() }),
    );

    await owner.confirmSlotFills(TID, [
      { matchId: sf1.id, side: 'A', teamId: t(0) },
      { matchId: sf1.id, side: 'B', teamId: t(5) },
    ]);
    let d = await waitFor(() => byKey(owner.get(TID)!, 'SF1').teamAId === t(0) && owner.get(TID));
    expect(byKey(d, 'SF1').slotA).toEqual({ kind: 'group_place', stageId: 'vorrunde', group: 0, place: 1 });

    const f = byKey(d, 'F');
    await owner.swapMatches(TID, sf1.id, f.id);
    d = await waitFor(() => byKey(owner.get(TID)!, 'SF1').startISO === at(90) && owner.get(TID));
    expect(byKey(d, 'SF1')).toMatchObject({ fieldId: `${TID}-f2`, manual: true });

    await waitFor(() => byKey(helper.get(TID)!, 'SF1').startISO === at(90));
    await expect(helper.swapMatches(TID, sf1.id, f.id)).rejects.toThrow();

    // Rückgängig über den Verlauf.
    const entries = await owner.loadHistory(TID);
    const swap = entries.find((e) => e.action === 'match.swap')!;
    await owner.undoHistory(TID, swap);
    d = await waitFor(() => byKey(owner.get(TID)!, 'SF1').startISO === at(60) && owner.get(TID));
    expect(byKey(d, 'SF1').manual).toBeUndefined();
    const pub = await waitFor(() => guest.getPublic(TID)?.matches.find((m) => m.matchKey === 'SF1' && m.startISO === at(60)));
    expect(pub.teamAId).toBe(t(0));
  });

  it('Helfer tragen Neunmeterschießen ein, Zuschauer sehen „n. N.“', async () => {
    const sf1 = byKey(helper.get(TID)!, 'SF1');
    await helper.recordScore(TID, sf1.id, 1, 1);
    await waitFor(() => byKey(helper.get(TID)!, 'SF1').goalsA === 1);
    await expect(helper.setMatchStatus(TID, sf1.id, 'completed')).rejects.toThrow(/Sieger/);
    await helper.finishKnockoutMatch(TID, sf1.id, { goalsA: 1, goalsB: 1, decidedBy: 'penalties', penaltiesA: 5, penaltiesB: 4 });
    const d = await waitFor(() => byKey(owner.get(TID)!, 'SF1').status === 'completed' && owner.get(TID));
    expect(byKey(d, 'SF1')).toMatchObject({ decidedBy: 'penalties', penaltiesA: 5, penaltiesB: 4 });
    const pub = await waitFor(() => guest.getPublic(TID)?.matches.find((m) => m.matchKey === 'SF1' && m.penaltiesA === 5));
    expect(pub).toMatchObject({ decidedBy: 'penalties', goalsA: 1, goalsB: 1, penaltiesB: 4 });

    // Ungültige Neunmeter lehnen die Regeln ab, auch am Programm vorbei.
    const raw = await getDoc(doc(dbFor(env, OWNER), `tournaments/${TID}/matches/${sf1.id}`));
    await assertFails(
      updateDoc(raw.ref, { penaltiesA: 4, revision: (raw.data() as { revision: number }).revision + 1, updatedAt: serverTimestamp() }),
    );

    // Rückgängig nimmt auch die Neunmeter zurück.
    const entry = (await owner.loadHistory(TID)).find((e) => e.action === 'match.result.final')!;
    await owner.undoHistory(TID, entry);
    const back = await waitFor(() => byKey(owner.get(TID)!, 'SF1').status === 'live' && byKey(owner.get(TID)!, 'SF1'));
    expect(back.decidedBy).toBeUndefined();
    expect(back.penaltiesA).toBeUndefined();
  });

  it('Lose stehen öffentlich nur, solange die Tabelle öffentlich ist', async () => {
    await owner.saveLot(TID, { stageId: 'vorrunde', groupIndex: 0, order: [t(1), t(0)] });
    const view = await waitFor(() => !!guest.getPublic(TID)?.lots?.length && guest.getPublic(TID));
    expect(view.lots![0]).toMatchObject({ stageId: 'vorrunde', groupIndex: 0, order: [t(1), t(0)] });
    expect(await waitFor(() => owner.get(TID)?.lots?.length === 1 && owner.get(TID)!.lots)).toHaveLength(1);

    const rev = owner.get(TID)!.tournament.revision;
    await owner.setVisibility(TID, 'no_standings');
    await waitFor(() => owner.get(TID)!.tournament.revision > rev);
    const snap = await getDocs(paths.publicStages(dbFor(env, null), TID));
    expect(snap.docs[0]!.data().lots).toBeUndefined();
    await assertFails(
      updateDoc(doc(dbFor(env, OWNER), `publicTournaments/${TID}/publicStages/vorrunde`), { lots: [], updatedAt: serverTimestamp() }),
    );
    await owner.setVisibility(TID, 'full');
  });

  it('Rückzug eines qualifizierten Teams: Gegner kampflos weiter', async () => {
    const d = await waitFor(() => owner.get(TID)?.tournament.visibility === 'full' && owner.get(TID));
    // Spiel um Platz 3 wie eine zweite Endrunden-Paarung mit festen Teams.
    await owner.saveStagePlan(TID, [
      ...d.matches
        .filter((m) => m.status === 'scheduled')
        .map((m) => ({
          id: m.id,
          stageId: m.stageId!,
          groupIndex: m.groupIndex,
          matchKey: m.matchKey,
          slotA: m.slotA,
          slotB: m.slotB,
          teamAId: m.teamAId || undefined,
          teamBId: m.teamBId || undefined,
          fieldId: m.fieldId,
          startISO: m.startISO,
          durationMinutes: m.durationMinutes,
        })),
      { stageId: 'endrunde', matchKey: 'SF2', teamAId: t(4), teamBId: t(1), durationMinutes: 10, startISO: at(60), fieldId: `${TID}-f2` },
    ]);
    await waitFor(() => owner.get(TID)?.matches.some((m) => m.matchKey === 'SF2'));
    await owner.withdrawQualifiedTeam(TID, t(4), { kind: 'walkover' });
    const after = await waitFor(() => byKey(owner.get(TID)!, 'SF2').status === 'not_played' && owner.get(TID));
    expect(byKey(after, 'SF2')).toMatchObject({ decidedBy: 'walkover', walkoverWinner: 'B', notPlayedReason: 'withdrawal' });
    await waitFor(() => owner.get(TID)!.teams.find((x) => x.id === t(4))!.status === 'withdrawn');
    const pub = await waitFor(() => guest.getPublic(TID)?.matches.find((m) => m.matchKey === 'SF2' && m.status === 'not_played'));
    expect(pub).toMatchObject({ decidedBy: 'walkover', walkoverWinner: 'B' });
  });

  it('Turnierleitung darf angepfiffene Spiele nicht löschen, offene Baukasten-Spiele schon', async () => {
    const d = owner.get(TID)!;
    const live = d.matches.find((m) => m.status === 'live')!;
    const open = d.matches.find((m) => m.status === 'scheduled' && m.stageId)!;
    const db = dbFor(env, OWNER);
    await assertFails(deleteDoc(doc(db, `tournaments/${TID}/matches/${live.id}`)));
    await assertSucceeds(deleteDoc(doc(db, `tournaments/${TID}/matches/${open.id}`)));
  });
});
