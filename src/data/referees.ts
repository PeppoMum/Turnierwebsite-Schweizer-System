// Schiris über den Schiri-Link (optional je Turnier). Wer den Link kennt, meldet sich anonym an und
// bekommt die Rolle `referee`: Er sieht alles wie ein Helfer, darf aber keine Spiele ändern, nur
// - sich mit Namen eintragen (`referees/{uid}`),
// - Spiele Schiris zuteilen und Ergebnisse melden (`refereeing/{matchId}`).
// Zuschauer sehen davon nichts (nichts davon steht in publicTournaments). Erst wenn die Turnierleitung
// eine Meldung übernimmt, wird daraus über matches.ts ein echtes Ergebnis.
// Der Link funktioniert wie der Helferlink (invitations.ts): Ausschalten oder ein neuer Link sperrt sofort.
import {
  getDoc,
  runTransaction,
  serverTimestamp,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type { Actor } from './audit';
import { DataError, toDataError } from './errors';
import type { RefereeReportDoc } from './model';
import { paths } from './paths';

/**
 * Mit dem Schiri-Link beitreten (anonym). Hat die Person schon eine Rolle (z. B. Turnierleitung), bleibt
 * sie; eine Schiri-Rolle aus einem älteren, inzwischen ersetzten Link wird auf den neuen Link umgestellt.
 */
export async function joinWithOpenRefereeLink(db: Firestore, actor: Actor, tid: string, linkId: string): Promise<void> {
  try {
    await runTransaction(db, async (tx) => {
      const grantRef = paths.roleGrant(db, tid, actor.uid);
      const grantSnap = await tx.get(grantRef);
      if (grantSnap.exists()) {
        const g = grantSnap.data();
        if (g.openLinkId && g.role !== 'referee' && !g.revokedAt) {
          throw new DataError(
            'invitation_unusable',
            'Auf diesem Gerät ist schon der Helferlink geöffnet. Öffne den Schiri-Link bitte in einem privaten Fenster oder auf einem anderen Gerät.',
          );
        }
        if (g.openLinkId && g.openLinkId !== linkId && !g.revokedAt) tx.update(grantRef, { openLinkId: linkId });
        return;
      }
      if (!actor.anonymous) {
        throw new DataError(
          'invitation_unusable',
          'Du bist mit einem Konto angemeldet, das bei diesem Turnier nicht mitmacht. Melde dich ab und öffne den Link noch einmal.',
        );
      }
      tx.set(grantRef, {
        uid: actor.uid,
        tournamentId: tid,
        role: 'referee',
        allowedFieldIds: null,
        canPublishRounds: false,
        expiresAt: null,
        revokedAt: null,
        openLinkId: linkId,
        email: null,
        createdAt: serverTimestamp(),
        createdBy: actor.uid,
      } as never);
    });
    // Probe: Ist der Link (noch) gültig, darf die Person das Turnier jetzt lesen.
    await getDoc(paths.tournament(db, tid));
  } catch (err) {
    const e = toDataError(err);
    if (e.code === 'permission_denied') {
      throw new DataError(
        'invitation_unusable',
        'Dieser Schiri-Link gilt nicht mehr. Bitte frag die Turnierleitung nach dem aktuellen Link.',
        { cause: err },
      );
    }
    throw e;
  }
}

/** Namen eines Schiris speichern (eigener Name, oder die Turnierleitung ändert ihn). */
export async function saveRefereeName(db: Firestore, tid: string, refereeId: string, name: string): Promise<void> {
  try {
    await runTransaction(db, async (tx) => {
      const ref = paths.referee(db, tid, refereeId);
      const snap = await tx.get(ref);
      if (snap.exists()) tx.update(ref, { name, updatedAt: serverTimestamp() });
      else tx.set(ref, { name, joinedAt: serverTimestamp(), updatedAt: serverTimestamp() } as never);
    });
  } catch (err) {
    throw toDataError(err);
  }
}

/** Schiri austragen; seine Spiele werden frei. */
export async function deleteReferee(db: Firestore, tid: string, refereeId: string, assignedMatchIds: string[]): Promise<void> {
  try {
    const freed = assignedMatchIds.map((matchId) => ({ matchId, refereeId: null }));
    await commitChunked(db, freed, (batch) => batch.delete(paths.referee(db, tid, refereeId)), tid);
  } catch (err) {
    throw toDataError(err);
  }
}

/** Einteilung setzen: je Spiel ein Schiri oder null (frei). */
export async function setRefereeAssignments(
  db: Firestore,
  tid: string,
  changes: Array<{ matchId: string; refereeId: string | null }>,
): Promise<void> {
  try {
    await commitChunked(db, changes, undefined, tid);
  } catch (err) {
    throw toDataError(err);
  }
}

// Ein Batch darf höchstens 500 Schreibvorgänge haben; die Regeln prüfen jedes Dokument einzeln.
const CHUNK = 200;

async function commitChunked(
  db: Firestore,
  changes: Array<{ matchId: string; refereeId: string | null }>,
  extra: ((batch: ReturnType<typeof writeBatch>) => void) | undefined,
  tid: string,
): Promise<void> {
  for (let i = 0; i < Math.max(changes.length, 1); i += CHUNK) {
    const batch = writeBatch(db);
    for (const c of changes.slice(i, i + CHUNK)) {
      batch.set(
        paths.refereeingOf(db, tid, c.matchId),
        { matchId: c.matchId, refereeId: c.refereeId, updatedAt: serverTimestamp() } as never,
        { merge: true },
      );
    }
    if (i === 0) extra?.(batch);
    await batch.commit();
  }
}

/** Ergebnis als Schiri melden; null nimmt die Meldung zurück. */
export async function setRefereeReport(
  db: Firestore,
  tid: string,
  matchId: string,
  report: Omit<RefereeReportDoc, 'at'> | null,
): Promise<void> {
  // `merge` würde eine Meldung mit einer älteren zusammenmischen: alle Felder immer ausschreiben.
  const value = report
    ? {
        refereeId: report.refereeId,
        goalsA: report.goalsA,
        goalsB: report.goalsB,
        decidedBy: report.decidedBy ?? null,
        penaltiesA: report.penaltiesA ?? null,
        penaltiesB: report.penaltiesB ?? null,
        at: serverTimestamp(),
      }
    : null;
  try {
    const batch = writeBatch(db);
    batch.set(paths.refereeingOf(db, tid, matchId), { matchId, report: value, updatedAt: serverTimestamp() } as never, { merge: true });
    await batch.commit();
  } catch (err) {
    throw toDataError(err);
  }
}
