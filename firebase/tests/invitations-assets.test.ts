// Helfer-Einladungen (§2.3 Punkt 6, §3) und Bildgrenzen (§10.2).
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_ASSET_BYTES,
  createHelperInvitation,
  getInvitation,
  paths,
  recordResult,
  redeemInvitation,
  revokeHelper,
  revokeInvitation,
  saveAsset,
  setMatchLive,
  validateAsset,
  type Actor,
} from '../../src/data';
import { OWNER, createEnv, dbFor, forceSet, matchRevision, seedTournament, type Seeded } from './setup';

const NEW_HELPER: Actor = { uid: 'nina', email: 'nina@example.org' };
const SECOND: Actor = { uid: 'paul', email: 'paul@example.org' };

let env: RulesTestEnvironment;
let s: Seeded;

beforeAll(async () => {
  env = await createEnv('demo-invites');
});

beforeEach(async () => {
  await env.clearFirestore();
  s = await seedTournament(env, 'full');
});

afterAll(async () => {
  await env.cleanup();
});

describe('Helfer-Einladung', () => {
  it('Einlösen mit eigenem Konto gibt genau die eingeladene Rolle', async () => {
    const inviteId = await createHelperInvitation(dbFor(env, OWNER), OWNER, s.tid, {
      role: 'results_helper',
      allowedFieldIds: ['f2'],
    });
    const db = dbFor(env, NEW_HELPER);
    const inv = await getInvitation(db, s.tid, inviteId);
    expect(inv.tournamentTitle).toBe('Herbstcup');
    expect(await redeemInvitation(db, NEW_HELPER, s.tid, inviteId)).toBe('results_helper');

    // Jetzt darf Nina auf Feld f2 eintragen, auf f1 nicht.
    await setMatchLive(db, NEW_HELPER, s.tid, s.matchF2, await matchRevision(env, s.tid, s.matchF2));
    await expect(
      setMatchLive(db, NEW_HELPER, s.tid, s.matchF1, await matchRevision(env, s.tid, s.matchF1)),
    ).rejects.toMatchObject({ code: 'permission_denied' });

    // Der Owner sieht, wer eingelöst hat.
    const grant = (await getDoc(paths.roleGrant(dbFor(env, OWNER), s.tid, NEW_HELPER.uid))).data()!;
    expect(grant).toMatchObject({ role: 'results_helper', email: 'nina@example.org', inviteId });
  });

  it('ein Link kann nur einmal eingelöst werden', async () => {
    const inviteId = await createHelperInvitation(dbFor(env, OWNER), OWNER, s.tid, { role: 'results_helper' });
    await redeemInvitation(dbFor(env, NEW_HELPER), NEW_HELPER, s.tid, inviteId);
    await expect(redeemInvitation(dbFor(env, SECOND), SECOND, s.tid, inviteId)).rejects.toMatchObject({
      code: 'invitation_unusable',
    });
  });

  it('zurückgezogene und abgelaufene Einladungen sind wertlos', async () => {
    const owner = dbFor(env, OWNER);
    const revoked = await createHelperInvitation(owner, OWNER, s.tid, { role: 'results_helper' });
    await revokeInvitation(owner, OWNER, s.tid, revoked);
    await expect(redeemInvitation(dbFor(env, NEW_HELPER), NEW_HELPER, s.tid, revoked)).rejects.toMatchObject({
      code: 'invitation_unusable',
    });

    await forceSet(env, `tournaments/${s.tid}/invitations/alt`, {
      tournamentId: s.tid,
      tournamentTitle: 'Herbstcup',
      role: 'results_helper',
      expiresAt: Timestamp.fromMillis(Date.now() - 60_000),
      createdAt: Timestamp.now(),
      createdBy: OWNER.uid,
      usedBy: null,
    });
    // Auch am Client vorbei direkt geschrieben: Regeln lehnen ab.
    const db = dbFor(env, NEW_HELPER);
    const batch = writeBatch(db);
    batch.set(paths.roleGrant(db, s.tid, NEW_HELPER.uid), {
      uid: NEW_HELPER.uid,
      tournamentId: s.tid,
      role: 'results_helper',
      revokedAt: null,
      expiresAt: null,
      inviteId: 'alt',
      email: NEW_HELPER.email,
      createdAt: serverTimestamp(),
      createdBy: NEW_HELPER.uid,
    } as never);
    batch.update(paths.invitation(db, s.tid, 'alt'), { usedBy: NEW_HELPER.uid, usedAt: serverTimestamp() });
    await assertFails(batch.commit());
  });

  it('beim Einlösen lässt sich keine höhere Rolle erschleichen', async () => {
    const inviteId = await createHelperInvitation(dbFor(env, OWNER), OWNER, s.tid, {
      role: 'results_helper',
      allowedFieldIds: ['f1'],
    });
    const db = dbFor(env, NEW_HELPER);
    for (const tamper of [{ role: 'owner' }, { role: 'extended_helper' }, { allowedFieldIds: null }]) {
      const batch = writeBatch(db);
      batch.set(paths.roleGrant(db, s.tid, NEW_HELPER.uid), {
        uid: NEW_HELPER.uid,
        tournamentId: s.tid,
        role: 'results_helper',
        allowedFieldIds: ['f1'],
        canPublishRounds: false,
        expiresAt: null,
        revokedAt: null,
        inviteId,
        email: NEW_HELPER.email,
        createdAt: serverTimestamp(),
        createdBy: NEW_HELPER.uid,
        ...tamper,
      } as never);
      batch.update(paths.invitation(db, s.tid, inviteId), { usedBy: NEW_HELPER.uid, usedAt: serverTimestamp() });
      await assertFails(batch.commit());
    }
  });

  it('nach dem Entziehen sind keine Eingaben mehr möglich', async () => {
    const owner = dbFor(env, OWNER);
    const inviteId = await createHelperInvitation(owner, OWNER, s.tid, { role: 'extended_helper' });
    const db = dbFor(env, NEW_HELPER);
    await redeemInvitation(db, NEW_HELPER, s.tid, inviteId);
    await revokeHelper(owner, OWNER, s.tid, NEW_HELPER.uid);
    await assertFails(getDoc(paths.tournament(db, s.tid)));
    await expect(
      recordResult(db, NEW_HELPER, s.tid, s.matchF1, 1, 0, await matchRevision(env, s.tid, s.matchF1)),
    ).rejects.toMatchObject({ code: 'permission_denied' });
  });

  it('abgelaufene Berechtigung wirkt wie entzogen', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore() as never, `tournaments/${s.tid}/roleGrants/${NEW_HELPER.uid}`), {
        uid: NEW_HELPER.uid,
        tournamentId: s.tid,
        role: 'results_helper',
        expiresAt: Timestamp.fromMillis(Date.now() - 1000),
        createdAt: Timestamp.now(),
        createdBy: OWNER.uid,
      });
    });
    await assertFails(getDoc(paths.tournament(dbFor(env, NEW_HELPER), s.tid)));
  });

  it('nur der Owner kann Einladungen anlegen', async () => {
    await expect(
      createHelperInvitation(dbFor(env, NEW_HELPER), NEW_HELPER, s.tid, { role: 'results_helper' }),
    ).rejects.toMatchObject({ code: 'permission_denied' });
  });

  it('Einladung kann nicht nachträglich verändert werden', async () => {
    const inviteId = await createHelperInvitation(dbFor(env, OWNER), OWNER, s.tid, { role: 'results_helper' });
    await assertFails(
      updateDoc(paths.invitation(dbFor(env, NEW_HELPER), s.tid, inviteId), { role: 'owner' }),
    );
  });
});

// Kleines gültiges PNG (1×1, transparent).
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('Bilder', () => {
  it('kleine Bilder werden privat und öffentlich gespeichert, Gäste sehen die öffentliche Kopie', async () => {
    const id = await saveAsset(
      dbFor(env, OWNER),
      s.tid,
      { dataUrl: PNG_1PX, mimeType: 'image/png', width: 1, height: 1 },
      'organizer',
      { isPublic: true },
    );
    const guest = dbFor(env, null);
    await assertSucceeds(getDoc(paths.publicAsset(guest, s.tid, id)));
    await assertFails(getDoc(paths.asset(guest, s.tid, id)));
  });

  it('zu große Bilder werden schon im Client und zusätzlich von den Regeln abgelehnt', async () => {
    const big = `data:image/png;base64,${'A'.repeat(60_000)}`;
    expect(() => validateAsset({ dataUrl: big, mimeType: 'image/png', width: 10, height: 10 })).toThrow();
    const db = dbFor(env, OWNER);
    await assertFails(
      setDoc(paths.asset(db, s.tid, 'gross'), {
        dataUrl: big,
        mimeType: 'image/png',
        bytes: MAX_ASSET_BYTES,
        width: 10,
        height: 10,
        kind: 'team',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      } as never),
    );
  });

  it('SVG und falsche Typangaben werden abgelehnt', async () => {
    const db = dbFor(env, OWNER);
    const base = { bytes: 100, width: 10, height: 10, kind: 'team', createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    await assertFails(
      setDoc(paths.asset(db, s.tid, 'svg'), {
        ...base,
        dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
        mimeType: 'image/svg+xml',
      } as never),
    );
    await assertFails(
      setDoc(paths.asset(db, s.tid, 'mismatch'), { ...base, dataUrl: PNG_1PX, mimeType: 'image/jpeg' } as never),
    );
  });

  it('Helfer können keine Bilder ablegen', async () => {
    const inviteId = await createHelperInvitation(dbFor(env, OWNER), OWNER, s.tid, { role: 'extended_helper' });
    const db = dbFor(env, NEW_HELPER);
    await redeemInvitation(db, NEW_HELPER, s.tid, inviteId);
    await expect(
      saveAsset(db, s.tid, { dataUrl: PNG_1PX, mimeType: 'image/png', width: 1, height: 1 }, 'team', { isPublic: false }),
    ).rejects.toMatchObject({ code: 'permission_denied' });
  });
});
