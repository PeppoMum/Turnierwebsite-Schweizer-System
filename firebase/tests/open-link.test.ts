// Optionaler Helferlink ohne Anmeldung: anonym beitreten, Ergebnisse eintragen, sofort sperrbar.
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  joinWithOpenHelperLink,
  newOpenHelperLinkId,
  paths,
  publishRound,
  recordResult,
  setMatchLive,
  updateTournamentConfig,
  type Actor,
} from '../../src/data';
import { HELPER, OUTSIDER, OWNER, anonymousDb, createEnv, currentRevision, dbFor, matchRevision, seedTournament, type Seeded } from './setup';

const ANON: Actor = { uid: 'anon1', email: null, anonymous: true };

let env: RulesTestEnvironment;
let s: Seeded;

async function setLink(linkId: string | null) {
  await updateTournamentConfig(dbFor(env, OWNER), OWNER, s.tid, await currentRevision(env, s.tid), { openHelperLinkId: linkId });
}

beforeAll(async () => {
  env = await createEnv('demo-open-link');
});

beforeEach(async () => {
  await env.clearFirestore();
  s = await seedTournament(env, 'full');
});

afterAll(async () => {
  await env.cleanup();
});

describe('Helferlink ohne Anmeldung', () => {
  it('anonym beitreten, anpfeifen und Ergebnis eintragen', async () => {
    const link = newOpenHelperLinkId();
    await setLink(link);
    const db = anonymousDb(env, ANON.uid);
    await joinWithOpenHelperLink(db, ANON, s.tid, link);

    await assertSucceeds(getDoc(paths.tournament(db, s.tid)));
    await setMatchLive(db, ANON, s.tid, s.matchF1, await matchRevision(env, s.tid, s.matchF1));
    await recordResult(db, ANON, s.tid, s.matchF2, 2, 1, await matchRevision(env, s.tid, s.matchF2), {
      finish: true,
      standingsAfter: () => ({ rows: [], throughRound: 1 }),
    });
    const grant = (await getDoc(paths.roleGrant(dbFor(env, OWNER), s.tid, ANON.uid))).data()!;
    expect(grant).toMatchObject({ role: 'results_helper', openLinkId: link, email: null });

    // Zweiter Aufruf mit demselben Link ändert nichts und scheitert nicht.
    await joinWithOpenHelperLink(db, ANON, s.tid, link);
  });

  it('falscher oder ausgeschalteter Link gibt keinen Zugang', async () => {
    const db = anonymousDb(env, ANON.uid);
    await expect(joinWithOpenHelperLink(db, ANON, s.tid, newOpenHelperLinkId())).rejects.toMatchObject({ code: 'invitation_unusable' });

    await setLink(newOpenHelperLinkId());
    await expect(joinWithOpenHelperLink(db, ANON, s.tid, newOpenHelperLinkId())).rejects.toMatchObject({ code: 'invitation_unusable' });
    await assertFails(getDoc(paths.tournament(db, s.tid)));
  });

  it('Ausschalten sperrt bisherige Helfer sofort', async () => {
    const link = newOpenHelperLinkId();
    await setLink(link);
    const db = anonymousDb(env, ANON.uid);
    await joinWithOpenHelperLink(db, ANON, s.tid, link);
    await setLink(null);

    await assertFails(getDoc(paths.tournament(db, s.tid)));
    await expect(setMatchLive(db, ANON, s.tid, s.matchF1, await matchRevision(env, s.tid, s.matchF1))).rejects.toMatchObject({
      code: 'permission_denied',
    });
    await expect(joinWithOpenHelperLink(db, ANON, s.tid, link)).rejects.toMatchObject({ code: 'invitation_unusable' });
    // Auch nicht durch Leeren des Links am eigenen Grant.
    await assertFails(updateDoc(paths.roleGrant(db, s.tid, ANON.uid), { openLinkId: null }));
  });

  it('neuer Link: alter gilt nicht mehr, mit dem neuen geht es weiter', async () => {
    const oldLink = newOpenHelperLinkId();
    await setLink(oldLink);
    const db = anonymousDb(env, ANON.uid);
    await joinWithOpenHelperLink(db, ANON, s.tid, oldLink);
    const newLink = newOpenHelperLinkId();
    await setLink(newLink);

    await assertFails(getDoc(paths.tournament(db, s.tid)));
    await expect(joinWithOpenHelperLink(db, ANON, s.tid, oldLink)).rejects.toMatchObject({ code: 'invitation_unusable' });
    await joinWithOpenHelperLink(db, ANON, s.tid, newLink);
    await assertSucceeds(getDoc(paths.tournament(db, s.tid)));
  });

  it('gibt nie mehr als Ergebnis-Helfer', async () => {
    const link = newOpenHelperLinkId();
    await setLink(link);
    const db = anonymousDb(env, ANON.uid);
    const base = { uid: ANON.uid, tournamentId: s.tid, openLinkId: link, email: null, createdAt: serverTimestamp(), createdBy: ANON.uid };
    await assertFails(setDoc(paths.roleGrant(db, s.tid, ANON.uid), { ...base, role: 'owner' } as never));
    await assertFails(setDoc(paths.roleGrant(db, s.tid, ANON.uid), { ...base, role: 'extended_helper', canPublishRounds: true } as never));
    await assertFails(setDoc(paths.roleGrant(db, s.tid, ANON.uid), { ...base, role: 'results_helper', allowedFieldIds: ['f1'], expiresAt: null } as never));

    await joinWithOpenHelperLink(db, ANON, s.tid, link);
    // Keine Owner-Aktionen: Konfiguration, Runden freigeben, Audit lesen.
    await assertFails(updateDoc(paths.tournament(db, s.tid), { title: 'Gekapert', updatedAt: serverTimestamp() }));
    await expect(publishRound(db, ANON, s.tid, s.roundId)).rejects.toBeTruthy();
    await assertFails(getDoc(paths.roleGrant(db, s.tid, OWNER.uid)));
  });

  it('nur der Owner schaltet den Link', async () => {
    for (const actor of [HELPER, OUTSIDER]) {
      await expect(
        updateTournamentConfig(dbFor(env, actor), actor, s.tid, await currentRevision(env, s.tid), { openHelperLinkId: newOpenHelperLinkId() }),
      ).rejects.toBeTruthy();
    }
    // Zu kurze IDs lehnen die Regeln ab.
    await expect(setLink('kurz')).rejects.toBeTruthy();
  });

  it('anonymer Login ohne Link bleibt ohne Rechte', async () => {
    const db = anonymousDb(env, 'anon2');
    await assertFails(getDoc(paths.tournament(db, s.tid)));
  });
});

describe('Helferlink mit Konto', () => {
  it('Turnierleitung behält ihre Rolle, fremde Konten bekommen keine Link-Rolle', async () => {
    const link = newOpenHelperLinkId();
    await setLink(link);
    await joinWithOpenHelperLink(dbFor(env, OWNER), OWNER, s.tid, link);
    await expect(joinWithOpenHelperLink(dbFor(env, OUTSIDER), OUTSIDER, s.tid, link)).rejects.toMatchObject({ code: 'invitation_unusable' });
    const db = dbFor(env, OUTSIDER);
    await assertFails(
      setDoc(paths.roleGrant(db, s.tid, OUTSIDER.uid), {
        uid: OUTSIDER.uid,
        tournamentId: s.tid,
        role: 'results_helper',
        openLinkId: link,
        email: null,
        createdAt: serverTimestamp(),
        createdBy: OUTSIDER.uid,
      } as never),
    );
  });
});
