// Rollen: Owner, Ergebnis-Helfer, erweiterter Helfer. Spezifikation §3, §10.3, §12 F.
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  RevisionConflictError,
  closeRound,
  markMatchNotPlayed,
  paths,
  publishRound,
  recordResult,
  reopenMatchForCorrection,
  saveRoundPreview,
  setMatchLive,
  updateTournamentConfig,
  writeAudit,
} from '../../src/data';
import {
  EXTENDED,
  HELPER,
  OUTSIDER,
  OWNER,
  createEnv,
  currentRevision,
  dbFor,
  matchRevision,
  seedTournament,
  type Seeded,
} from './setup';

let env: RulesTestEnvironment;
let s: Seeded;

beforeAll(async () => {
  env = await createEnv('demo-roles');
});

beforeEach(async () => {
  await env.clearFirestore();
  s = await seedTournament(env, 'full');
});

afterAll(async () => {
  await env.cleanup();
});

describe('Owner', () => {
  it('liest alles intern, inkl. Audit und Rollen', async () => {
    const db = dbFor(env, OWNER);
    await assertSucceeds(getDoc(paths.tournament(db, s.tid)));
    await assertSucceeds(getDocs(paths.audit(db, s.tid)));
    await assertSucceeds(getDocs(paths.roleGrants(db, s.tid)));
  });

  it('ändert die Konfiguration nur mit aktueller Revision', async () => {
    const db = dbFor(env, OWNER);
    const rev = await currentRevision(env, s.tid);
    await updateTournamentConfig(db, OWNER, s.tid, rev, { title: 'Wintercup' });
    await expect(
      updateTournamentConfig(db, OWNER, s.tid, rev, { title: 'Veraltet' }),
    ).rejects.toBeInstanceOf(RevisionConflictError);
  });

  it('kann ein Turnier nicht hart löschen und den Ersteller nicht entfernen', async () => {
    const db = dbFor(env, OWNER);
    await assertFails(deleteDoc(paths.tournament(db, s.tid)));
    await assertFails(deleteDoc(paths.roleGrant(db, s.tid, OWNER.uid)));
  });

  it('kann eine freigegebene Runde nicht neu auslosen', async () => {
    const db = dbFor(env, OWNER);
    await expect(
      saveRoundPreview(db, OWNER, s.tid, {
        number: 1,
        mode: 'draw',
        plannedStartISO: '2026-11-07T09:00:00.000Z',
        generatedFromRevision: 0,
        matches: [{ teamAId: 't1', teamBId: 't3', durationMinutes: 12 }],
        byeTeamIds: [],
      }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('Audit-Einträge sind unveränderlich', async () => {
    const db = dbFor(env, OWNER);
    const audits = await getDocs(paths.audit(db, s.tid));
    const first = audits.docs[0]!;
    await assertFails(updateDoc(first.ref, { action: 'geschönt' }));
    await assertFails(deleteDoc(first.ref));
  });
});

describe('Ergebnis-Helfer', () => {
  it('liest intern, aber keine Audit-Daten und keine fremden Rollen', async () => {
    const db = dbFor(env, HELPER);
    await assertSucceeds(getDoc(paths.tournament(db, s.tid)));
    await assertSucceeds(getDocs(paths.matches(db, s.tid)));
    await assertSucceeds(getDoc(paths.roleGrant(db, s.tid, HELPER.uid)));
    await assertFails(getDocs(paths.audit(db, s.tid)));
    await assertFails(getDoc(paths.roleGrant(db, s.tid, OWNER.uid)));
  });

  it('trägt auf seinem Feld Anpfiff, Zwischenstand und Endstand ein', async () => {
    const db = dbFor(env, HELPER);
    let m = await setMatchLive(db, HELPER, s.tid, s.matchF1, await matchRevision(env, s.tid, s.matchF1));
    m = await recordResult(db, HELPER, s.tid, s.matchF1, 1, 0, m.revision);
    m = await recordResult(db, HELPER, s.tid, s.matchF1, 3, 0, m.revision, { finish: true });
    expect(m.status).toBe('completed');
    const pub = await getDoc(paths.publicResult(dbFor(env, null), s.tid, s.matchF1));
    expect(pub.data()).toMatchObject({ goalsA: 3, goalsB: 0, status: 'completed' });
  });

  it('darf Spiele auf anderen Feldern nicht ändern', async () => {
    const db = dbFor(env, HELPER);
    const rev = await matchRevision(env, s.tid, s.matchF2);
    await expect(setMatchLive(db, HELPER, s.tid, s.matchF2, rev)).rejects.toMatchObject({
      code: 'permission_denied',
    });
  });

  it('darf nur Score- und Statusfelder ändern, nicht Paarung, Feld oder Zeit', async () => {
    const db = dbFor(env, HELPER);
    const rev = await matchRevision(env, s.tid, s.matchF1);
    // Jeweils mit gültigem Statuswechsel, damit nur das Zusatzfeld den Ausschlag gibt.
    for (const extra of [{ teamAId: 't5' }, { fieldId: 'f2' }, { startISO: '2026-11-07T18:00:00.000Z' }]) {
      const patch = { status: 'live', ...extra };
      const batch = writeBatch(db);
      const audit = writeAudit(db, batch, s.tid, HELPER, { action: 'x', targetType: 'match', targetId: s.matchF1 });
      batch.update(paths.match(db, s.tid, s.matchF1), {
        ...patch,
        revision: rev + 1,
        updatedAt: serverTimestamp(),
        lastAuditId: audit.id,
      });
      await assertFails(batch.commit());
    }
  });

  it('kann Stammdaten, Konfiguration und Rollen nicht ändern', async () => {
    const db = dbFor(env, HELPER);
    await assertFails(updateDoc(doc(paths.teams(db, s.tid), 't1'), { name: 'Umbenannt' }));
    await assertFails(
      updateDoc(paths.tournament(db, s.tid), {
        title: 'x',
        revision: (await currentRevision(env, s.tid)) + 1,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(updateDoc(paths.roleGrant(db, s.tid, HELPER.uid), { allowedFieldIds: null }));
    await assertFails(updateDoc(paths.roleGrant(db, s.tid, HELPER.uid), { role: 'owner' }));
    await assertFails(updateDoc(paths.publicTournament(db, s.tid), { title: 'x', updatedAt: serverTimestamp() }));
  });

  it('kann keine Runde freigeben', async () => {
    const owner = dbFor(env, OWNER);
    await finishRound(owner);
    await closeRound(owner, OWNER, s.tid, s.roundId);
    const { roundId } = await saveRoundPreview(owner, OWNER, s.tid, swissPreview(await resultsRevision()));
    await expect(publishRound(dbFor(env, HELPER), HELPER, s.tid, roundId)).rejects.toMatchObject({
      code: 'permission_denied',
    });
  });

  it('kann ein beendetes Spiel nicht wieder öffnen', async () => {
    const db = dbFor(env, HELPER);
    const m = await recordResult(db, HELPER, s.tid, s.matchF1, 1, 1, await matchRevision(env, s.tid, s.matchF1), {
      finish: true,
    });
    await expect(reopenMatchForCorrection(db, HELPER, s.tid, s.matchF1, m.revision)).rejects.toMatchObject({
      code: 'permission_denied',
    });
  });

  it('Schreiben ohne Audit-Eintrag wird abgelehnt', async () => {
    const db = dbFor(env, HELPER);
    const rev = await matchRevision(env, s.tid, s.matchF1);
    await assertFails(
      updateDoc(paths.match(db, s.tid, s.matchF1), {
        status: 'live',
        revision: rev + 1,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('„beendet“ ohne gültigen Score und „nicht ausgetragen“ mit Score werden abgelehnt', async () => {
    const db = dbFor(env, HELPER);
    const rev = await matchRevision(env, s.tid, s.matchF1);
    const attempt = (patch: Record<string, unknown>) => {
      const batch = writeBatch(db);
      const audit = writeAudit(db, batch, s.tid, HELPER, { action: 'x', targetType: 'match', targetId: s.matchF1 });
      batch.update(paths.match(db, s.tid, s.matchF1), {
        ...patch,
        revision: rev + 1,
        updatedAt: serverTimestamp(),
        lastAuditId: audit.id,
      });
      batch.update(paths.tournament(db, s.tid), { resultsRevision: 1, updatedAt: serverTimestamp() });
      return batch.commit();
    };
    await assertFails(attempt({ status: 'completed' }));
    await assertFails(attempt({ status: 'completed', goalsA: -1, goalsB: 0 }));
    await assertFails(attempt({ status: 'completed', goalsA: 1.5, goalsB: 0 }));
    await assertFails(attempt({ status: 'not_played', notPlayedReason: 'no_show', goalsA: 3, goalsB: 0 }));
  });

  it('kann sich nicht selbst Owner-Rechte geben', async () => {
    const db = dbFor(env, OUTSIDER);
    await assertFails(
      setDoc(paths.roleGrant(db, s.tid, OUTSIDER.uid), {
        uid: OUTSIDER.uid,
        tournamentId: s.tid,
        role: 'owner',
        createdAt: serverTimestamp(),
        createdBy: OUTSIDER.uid,
      } as never),
    );
  });
});

describe('Gleichzeitige Bearbeitung (§12 F)', () => {
  it('veraltete Revision führt zum Konflikt, der erste Wert bleibt erhalten', async () => {
    const rev = await matchRevision(env, s.tid, s.matchF1);
    await recordResult(dbFor(env, HELPER), HELPER, s.tid, s.matchF1, 2, 0, rev, { finish: true });
    const err = await recordResult(dbFor(env, OWNER), OWNER, s.tid, s.matchF1, 0, 5, rev, { finish: true }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RevisionConflictError);
    expect((err as RevisionConflictError<{ goalsA: number }>).current.goalsA).toBe(2);
    const m = (await getDoc(paths.match(dbFor(env, OWNER), s.tid, s.matchF1))).data()!;
    expect([m.goalsA, m.goalsB]).toEqual([2, 0]);
  });

  it('auch ohne Transaktion verhindern die Regeln das Überschreiben mit alter Revision', async () => {
    const rev = await matchRevision(env, s.tid, s.matchF1);
    await setMatchLive(dbFor(env, HELPER), HELPER, s.tid, s.matchF1, rev);
    const db = dbFor(env, OWNER);
    const batch = writeBatch(db);
    const audit = writeAudit(db, batch, s.tid, OWNER, { action: 'x', targetType: 'match', targetId: s.matchF1 });
    batch.update(paths.match(db, s.tid, s.matchF1), {
      status: 'live',
      revision: rev + 1, // veraltet: aktuell ist rev + 1, erwartet wäre rev + 2
      updatedAt: serverTimestamp(),
      lastAuditId: audit.id,
    });
    await assertFails(batch.commit());
  });

  it('jede Änderung erzeugt einen Audit-Eintrag mit Akteur', async () => {
    const rev = await matchRevision(env, s.tid, s.matchF1);
    await recordResult(dbFor(env, HELPER), HELPER, s.tid, s.matchF1, 4, 4, rev, { finish: true });
    const audits = await getDocs(paths.audit(dbFor(env, OWNER), s.tid));
    const entry = audits.docs.map((d) => d.data()).find((a) => a.targetId === s.matchF1 && a.action === 'match.result.final');
    expect(entry).toMatchObject({ actorUid: HELPER.uid, after: { goalsA: 4, goalsB: 4 } });
  });
});

describe('Erweiterter Helfer', () => {
  it('darf auf allen Feldern eintragen und beendete Spiele korrigieren', async () => {
    const db = dbFor(env, EXTENDED);
    let m = await recordResult(db, EXTENDED, s.tid, s.matchF2, 1, 0, await matchRevision(env, s.tid, s.matchF2), {
      finish: true,
    });
    m = await reopenMatchForCorrection(db, EXTENDED, s.tid, s.matchF2, m.revision);
    expect(m.status).toBe('live');
    m = await recordResult(db, EXTENDED, s.tid, s.matchF2, 1, 1, m.revision, { finish: true });
    expect([m.goalsA, m.goalsB]).toEqual([1, 1]);
  });

  it('darf mit Freigaberecht eine Runde freigeben – nur einmal', async () => {
    const owner = dbFor(env, OWNER);
    await finishRound(owner);
    await closeRound(owner, OWNER, s.tid, s.roundId);
    const { roundId } = await saveRoundPreview(owner, OWNER, s.tid, swissPreview(await resultsRevision()));
    const db = dbFor(env, EXTENDED);
    await publishRound(db, EXTENDED, s.tid, roundId);
    await expect(publishRound(owner, OWNER, s.tid, roundId)).rejects.toMatchObject({ code: 'invalid_state' });
    const pub = await getDocs(paths.publicMatches(dbFor(env, null), s.tid));
    expect(pub.size).toBe(4);
  });

  it('kann keine Stammdaten ändern', async () => {
    const db = dbFor(env, EXTENDED);
    await assertFails(updateDoc(doc(paths.teams(db, s.tid), 't1'), { name: 'x' }));
    await assertFails(setDoc(doc(paths.fields(db, s.tid), 'f9'), { name: 'Neu' } as never));
  });
});

describe('Rundenfreigabe', () => {
  it('Schweizer Runde nur nach geschlossener Vorrunde und mit aktueller Ergebnisbasis', async () => {
    const owner = dbFor(env, OWNER);
    await finishRound(owner);
    const stale = await resultsRevision();
    const { roundId } = await saveRoundPreview(owner, OWNER, s.tid, swissPreview(stale));
    await expect(publishRound(owner, OWNER, s.tid, roundId)).rejects.toMatchObject({ code: 'invalid_state' });
    await closeRound(owner, OWNER, s.tid, s.roundId);
    // Ergebniskorrektur nach Berechnung der Vorschau -> Basis veraltet.
    const m = await reopenMatchForCorrection(owner, OWNER, s.tid, s.matchF1, await matchRevision(env, s.tid, s.matchF1));
    await recordResult(owner, OWNER, s.tid, s.matchF1, 0, 0, m.revision, { finish: true });
    await expect(publishRound(owner, OWNER, s.tid, roundId)).rejects.toMatchObject({ code: 'invalid_state' });
    await publishRound(owner, OWNER, s.tid, roundId, { allowStaleBasis: true });
  });

  it('Vorschau-Spiele sind nie öffentlich', async () => {
    const owner = dbFor(env, OWNER);
    await finishRound(owner);
    await closeRound(owner, OWNER, s.tid, s.roundId);
    const { matchIds } = await saveRoundPreview(owner, OWNER, s.tid, swissPreview(await resultsRevision()));
    const guest = dbFor(env, null);
    const pub = await getDocs(paths.publicMatches(guest, s.tid));
    expect(pub.docs.map((d) => d.id)).not.toContain(matchIds[0]);
  });

  it('nicht ausgetragene Spiele zählen als entschieden', async () => {
    const owner = dbFor(env, OWNER);
    await recordResult(owner, OWNER, s.tid, s.matchF1, 1, 0, await matchRevision(env, s.tid, s.matchF1), { finish: true });
    await markMatchNotPlayed(owner, OWNER, s.tid, s.matchF2, 'no_show', await matchRevision(env, s.tid, s.matchF2));
    await closeRound(owner, OWNER, s.tid, s.roundId);
    const r = (await getDoc(paths.round(owner, s.tid, s.roundId))).data()!;
    expect(r.status).toBe('closed');
  });
});

// ---------- Hilfen ----------

async function finishRound(db: ReturnType<typeof dbFor>) {
  await recordResult(db, OWNER, s.tid, s.matchF1, 2, 0, await matchRevision(env, s.tid, s.matchF1), { finish: true });
  await recordResult(db, OWNER, s.tid, s.matchF2, 1, 1, await matchRevision(env, s.tid, s.matchF2), { finish: true });
}

async function resultsRevision(): Promise<number> {
  let rev = -1;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore() as never, `tournaments/${s.tid}`));
    rev = (snap.data() as { resultsRevision: number }).resultsRevision;
  });
  return rev;
}

function swissPreview(generatedFromRevision: number) {
  return {
    number: 2,
    mode: 'swiss' as const,
    plannedStartISO: '2026-11-07T09:30:00.000Z',
    generatedFromRevision,
    matches: [
      { teamAId: 't1', teamBId: 't3', fieldId: 'f1', durationMinutes: 12 },
      { teamAId: 't5', teamBId: 't2', fieldId: 'f2', durationMinutes: 12 },
    ],
    byeTeamIds: ['t4'],
  };
}
