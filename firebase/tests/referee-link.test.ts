// Optionaler Schiri-Link ohne Anmeldung: anonym beitreten, Namen eintragen, Spiele aufteilen und
// Ergebnisse melden. Schiris ändern nie Spiele, Tabelle oder Verlauf; Zuschauer sehen nichts davon.
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  joinWithOpenHelperLink,
  joinWithOpenRefereeLink,
  newOpenHelperLinkId,
  paths,
  recordResult,
  saveRefereeName,
  setMatchLive,
  setRefereeAssignments,
  setRefereeReport,
  updateTournamentConfig,
  writeAudit,
  type Actor,
  type ActorSource,
} from '../../src/data';
import { FirestoreTournamentStore } from '../../src/ui/data/firestoreStore';
import { HELPER, OUTSIDER, OWNER, anonymousDb, createEnv, currentRevision, dbFor, matchRevision, seedTournament, type Seeded } from './setup';

const REF: Actor = { uid: 'schiri1', email: null, anonymous: true };
const REF2: Actor = { uid: 'schiri2', email: null, anonymous: true };

let env: RulesTestEnvironment;
let s: Seeded;

async function setLinks(patch: { openRefereeLinkId?: string | null; openHelperLinkId?: string | null }) {
  await updateTournamentConfig(dbFor(env, OWNER), OWNER, s.tid, await currentRevision(env, s.tid), patch);
}

async function joinedReferee(actor: Actor = REF) {
  const link = newOpenHelperLinkId();
  await setLinks({ openRefereeLinkId: link });
  const db = anonymousDb(env, actor.uid);
  await joinWithOpenRefereeLink(db, actor, s.tid, link);
  return { db, link };
}

beforeAll(async () => {
  env = await createEnv('demo-referee-link');
});

beforeEach(async () => {
  await env.clearFirestore();
  s = await seedTournament(env, 'full');
});

afterAll(async () => {
  await env.cleanup();
});

describe('Schiri-Link ohne Anmeldung', () => {
  it('beitreten, Namen eintragen, Spiele aufteilen und Ergebnis melden', async () => {
    const { db, link } = await joinedReferee();
    await assertSucceeds(getDoc(paths.tournament(db, s.tid)));
    await assertSucceeds(getDoc(paths.match(db, s.tid, s.matchF1)));
    const grant = (await getDoc(paths.roleGrant(dbFor(env, OWNER), s.tid, REF.uid))).data()!;
    expect(grant).toMatchObject({ role: 'referee', openLinkId: link, email: null });

    await saveRefereeName(db, s.tid, REF.uid, 'Anna');
    await saveRefereeName(db, s.tid, REF.uid, 'Anna B.');
    await setRefereeAssignments(db, s.tid, [
      { matchId: s.matchF1, refereeId: REF.uid },
      { matchId: s.matchF2, refereeId: 'schiri2' },
    ]);
    await setRefereeReport(db, s.tid, s.matchF1, { refereeId: REF.uid, goalsA: 2, goalsB: 1 });
    await setRefereeReport(db, s.tid, s.matchF1, null);

    const owner = dbFor(env, OWNER);
    expect((await getDoc(paths.referee(owner, s.tid, REF.uid))).data()).toMatchObject({ name: 'Anna B.' });
    expect((await getDoc(paths.refereeingOf(owner, s.tid, s.matchF1))).data()).toMatchObject({ refereeId: REF.uid, report: null });

    // Zweiter Aufruf mit demselben Link ändert nichts und scheitert nicht.
    await joinWithOpenRefereeLink(db, REF, s.tid, link);
  });

  it('Schiris ändern nie Spiele, Tabelle, Turnier oder Verlauf', async () => {
    const { db } = await joinedReferee();
    await expect(setMatchLive(db, REF, s.tid, s.matchF1, await matchRevision(env, s.tid, s.matchF1))).rejects.toMatchObject({
      code: 'permission_denied',
    });
    await expect(
      recordResult(db, REF, s.tid, s.matchF2, 2, 1, await matchRevision(env, s.tid, s.matchF2), { finish: true }),
    ).rejects.toMatchObject({ code: 'permission_denied' });
    await assertFails(updateDoc(paths.tournament(db, s.tid), { resultsRevision: 99, updatedAt: serverTimestamp() }));
    await assertFails(setDoc(paths.publicStandings(db, s.tid), { rows: [], throughRound: 1, resultsRevision: 0, updatedAt: serverTimestamp() } as never));
    const batch = writeBatch(db);
    writeAudit(db, batch, s.tid, REF, { action: 'match.result.final', targetType: 'match', targetId: s.matchF1 });
    await assertFails(batch.commit());
    await assertFails(getDoc(paths.roleGrant(db, s.tid, OWNER.uid)));
  });

  it('nur den eigenen Namen, keine fremden Felder, keine ungültigen Meldungen', async () => {
    const { db } = await joinedReferee();
    await expect(saveRefereeName(db, s.tid, 'jemand-anders', 'Fake')).rejects.toBeTruthy();
    await assertFails(
      setDoc(paths.referee(db, s.tid, REF.uid), { name: 'x'.repeat(41), joinedAt: serverTimestamp(), updatedAt: serverTimestamp() } as never),
    );
    await assertFails(
      setDoc(paths.refereeingOf(db, s.tid, s.matchF1), { matchId: 'anderes', refereeId: null, updatedAt: serverTimestamp() } as never),
    );
    await assertFails(
      setDoc(paths.refereeingOf(db, s.tid, s.matchF1), { matchId: s.matchF1, refereeId: null, extra: 1, updatedAt: serverTimestamp() } as never),
    );
    await expect(setRefereeReport(db, s.tid, s.matchF1, { refereeId: REF.uid, goalsA: -1, goalsB: 1 })).rejects.toBeTruthy();
    // Austragen darf nur die Turnierleitung.
    await saveRefereeName(db, s.tid, REF.uid, 'Anna');
    const other = (await joinedReferee(REF2)).db;
    await assertFails(setDoc(paths.referee(other, s.tid, REF.uid), { name: 'Weg', joinedAt: serverTimestamp(), updatedAt: serverTimestamp() } as never));
  });

  it('Helfer und Fremde schreiben keine Schiri-Daten, die Turnierleitung schon', async () => {
    await setRefereeAssignments(dbFor(env, OWNER), s.tid, [{ matchId: s.matchF1, refereeId: 'x' }]);
    await saveRefereeName(dbFor(env, OWNER), s.tid, 'irgendwer', 'Ben');
    for (const actor of [HELPER, OUTSIDER]) {
      await expect(setRefereeAssignments(dbFor(env, actor), s.tid, [{ matchId: s.matchF1, refereeId: null }])).rejects.toBeTruthy();
    }
    await assertSucceeds(getDoc(paths.refereeingOf(dbFor(env, HELPER), s.tid, s.matchF1)));
    await assertFails(getDoc(paths.refereeingOf(dbFor(env, OUTSIDER), s.tid, s.matchF1)));
    await assertFails(getDoc(paths.refereeingOf(dbFor(env, null), s.tid, s.matchF1)));
  });

  it('Ausschalten oder neuer Link sperrt sofort; mit dem neuen geht es weiter', async () => {
    const { db, link } = await joinedReferee();
    await setLinks({ openRefereeLinkId: newOpenHelperLinkId() });
    await assertFails(getDoc(paths.tournament(db, s.tid)));
    await expect(joinWithOpenRefereeLink(db, REF, s.tid, link)).rejects.toMatchObject({ code: 'invitation_unusable' });
    await expect(setRefereeAssignments(db, s.tid, [{ matchId: s.matchF1, refereeId: REF.uid }])).rejects.toBeTruthy();

    const fresh = newOpenHelperLinkId();
    await setLinks({ openRefereeLinkId: fresh });
    await joinWithOpenRefereeLink(db, REF, s.tid, fresh);
    await assertSucceeds(getDoc(paths.tournament(db, s.tid)));

    await setLinks({ openRefereeLinkId: null });
    await assertFails(getDoc(paths.tournament(db, s.tid)));
  });

  it('Helfer- und Schiri-Link sind getrennt', async () => {
    const helperLink = newOpenHelperLinkId();
    const refereeLink = newOpenHelperLinkId();
    await setLinks({ openHelperLinkId: helperLink, openRefereeLinkId: refereeLink });
    const db = anonymousDb(env, REF.uid);
    const base = { uid: REF.uid, tournamentId: s.tid, email: null, createdAt: serverTimestamp(), createdBy: REF.uid };
    // Mit dem Schiri-Link keine Helferrolle, mit dem Helferlink keine Schiri-Rolle.
    await assertFails(setDoc(paths.roleGrant(db, s.tid, REF.uid), { ...base, role: 'results_helper', openLinkId: refereeLink } as never));
    await assertFails(setDoc(paths.roleGrant(db, s.tid, REF.uid), { ...base, role: 'referee', openLinkId: helperLink } as never));

    // Ausschalten des Helferlinks sperrt Schiris nicht.
    await joinWithOpenRefereeLink(db, REF, s.tid, refereeLink);
    await setLinks({ openHelperLinkId: null });
    await assertSucceeds(getDoc(paths.tournament(db, s.tid)));

    // Wer schon Helfer ist, wird nicht nebenbei Schiri.
    const helperDb = anonymousDb(env, 'helfer1');
    await setLinks({ openHelperLinkId: helperLink });
    await joinWithOpenHelperLink(helperDb, { uid: 'helfer1', anonymous: true }, s.tid, helperLink);
    await expect(joinWithOpenRefereeLink(helperDb, { uid: 'helfer1', anonymous: true }, s.tid, refereeLink)).rejects.toMatchObject({
      code: 'invitation_unusable',
    });
  });

  it('nur der Owner schaltet den Schiri-Link', async () => {
    for (const actor of [HELPER, OUTSIDER]) {
      await expect(
        updateTournamentConfig(dbFor(env, actor), actor, s.tid, await currentRevision(env, s.tid), { openRefereeLinkId: newOpenHelperLinkId() }),
      ).rejects.toBeTruthy();
    }
    await expect(setLinks({ openRefereeLinkId: 'kurz' })).rejects.toBeTruthy();
  });
});

describe('Schiris über FirestoreTournamentStore', () => {
  const fixed = (actor: Actor): ActorSource => ({ current: () => actor, onChange: () => () => undefined });

  async function waitFor<T>(fn: () => T | undefined | false, ms = 8000): Promise<T> {
    const until = Date.now() + ms;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() > until) throw new Error('Zeitüberschreitung beim Warten auf Daten');
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  it('Schiri meldet, Turnierleitung übernimmt mit einem Klick', async () => {
    const link = newOpenHelperLinkId();
    await setLinks({ openRefereeLinkId: link });
    const refDb = anonymousDb(env, REF.uid);
    await joinWithOpenRefereeLink(refDb, REF, s.tid, link);
    const referee = new FirestoreTournamentStore(refDb, fixed(REF));
    const owner = new FirestoreTournamentStore(dbFor(env, OWNER), fixed(OWNER));
    try {
      await waitFor(() => referee.get(s.tid));
      expect(await referee.saveReferee(s.tid, 'Anna')).toBe(REF.uid);
      await waitFor(() => referee.get(s.tid)?.referees?.length === 1);
      await referee.assignReferees(s.tid, [{ matchId: s.matchF2, refereeId: REF.uid }]);
      await referee.reportRefereeResult(s.tid, s.matchF2, { refereeId: REF.uid, goalsA: 3, goalsB: 1 });

      const seen = await waitFor(() => owner.get(s.tid)?.refereeing?.find((e) => e.matchId === s.matchF2 && e.report));
      expect(seen).toMatchObject({ refereeId: REF.uid, report: { refereeId: REF.uid, goalsA: 3, goalsB: 1 } });
      expect(owner.get(s.tid)!.matches.find((m) => m.id === s.matchF2)!.status).not.toBe('completed');

      await owner.acceptRefereeReport(s.tid, s.matchF2);
      const done = await waitFor(() => owner.get(s.tid)?.matches.find((m) => m.id === s.matchF2 && m.status === 'completed'));
      expect(done).toMatchObject({ goalsA: 3, goalsB: 1 });
      // Ein Schiri kann selbst nicht übernehmen.
      await expect(referee.acceptRefereeReport(s.tid, s.matchF2)).rejects.toBeTruthy();
    } finally {
      referee.dispose();
      owner.dispose();
    }
  });
});
