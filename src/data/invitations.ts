// Helfer einladen und verwalten (§2.3 Punkt 6, §3). Spark-tauglich ohne Backend:
// Der Link enthält nur eine Einladungsreferenz. Wer ihn öffnet, meldet sich mit eigenem
// Konto an und löst die Einladung genau einmal ein; die Regeln binden den Grant an diese
// uid. Owner sehen, wer eingelöst hat, und können jederzeit entziehen.
import {
  Timestamp,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type { RoleName } from '../domain';
import { writeAudit, type Actor } from './audit';
import { DataError, notFound, toDataError } from './errors';
import type { InvitationDoc } from './model';
import { paths } from './paths';

export const MAX_INVITATION_HOURS = 30 * 24;
export const DEFAULT_INVITATION_HOURS = 72;

export interface HelperInvitationInput {
  role: RoleName;
  /** Ergebnis-Helfer nur für diese Felder; leer/undefiniert = alle Felder. */
  allowedFieldIds?: string[];
  /** Nur extended_helper: darf Runden freigeben. */
  canPublishRounds?: boolean;
  /** Wie lange der Link einlösbar ist (Standard 72 h, max. 30 Tage). */
  validForHours?: number;
  /** Optionales Ende der Berechtigung, z. B. Turniertagende. */
  grantExpiresAt?: Date;
}

/** Hash-Route der App, unter der ein Helfer die Einladung einlöst. */
export function buildInvitationLink(appBaseUrl: string, tid: string, inviteId: string): string {
  return `${appBaseUrl.replace(/\/?$/, '/')}#/einladung/${encodeURIComponent(tid)}/${encodeURIComponent(inviteId)}`;
}

export async function createHelperInvitation(
  db: Firestore,
  actor: Actor,
  tid: string,
  input: HelperInvitationInput,
): Promise<string> {
  const hours = input.validForHours ?? DEFAULT_INVITATION_HOURS;
  if (!(hours > 0 && hours <= MAX_INVITATION_HOURS)) {
    throw new DataError('invalid_input', 'Eine Einladung kann 1 Stunde bis 30 Tage gültig sein.');
  }
  if (input.canPublishRounds && input.role !== 'extended_helper') {
    throw new DataError('invalid_input', 'Runden freigeben dürfen nur erweiterte Helfer.');
  }
  try {
    const tSnap = await getDoc(paths.tournament(db, tid));
    if (!tSnap.exists()) throw notFound('Das Turnier');
    const ref = doc(paths.invitations(db, tid));
    const batch = writeBatch(db);
    batch.set(ref, {
      tournamentId: tid,
      tournamentTitle: tSnap.data().title,
      role: input.role,
      allowedFieldIds: input.allowedFieldIds?.length ? input.allowedFieldIds : null,
      canPublishRounds: input.canPublishRounds ?? false,
      grantExpiresAt: input.grantExpiresAt ? Timestamp.fromDate(input.grantExpiresAt) : null,
      expiresAt: Timestamp.fromMillis(Date.now() + hours * 3600_000),
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
      usedBy: null,
      usedAt: null,
      revokedAt: null,
    } as never);
    writeAudit(db, batch, tid, actor, {
      action: 'invitation.create',
      targetType: 'invitation',
      targetId: ref.id,
      after: { role: input.role },
    });
    await batch.commit();
    return ref.id;
  } catch (err) {
    throw toDataError(err);
  }
}

export async function getInvitation(
  db: Firestore,
  tid: string,
  inviteId: string,
): Promise<InvitationDoc> {
  try {
    const snap = await getDoc(paths.invitation(db, tid, inviteId));
    if (!snap.exists()) throw notFound('Die Einladung');
    return snap.data();
  } catch (err) {
    throw toDataError(err);
  }
}

export function invitationProblem(inv: InvitationDoc, now: Date = new Date()): string | null {
  if (inv.revokedAt) return 'Diese Einladung wurde zurückgezogen.';
  if (inv.usedBy) return 'Diese Einladung wurde bereits verwendet. Bitte frag nach einem neuen Link.';
  if (inv.expiresAt.toMillis() <= now.getTime()) return 'Diese Einladung ist abgelaufen.';
  return null;
}

/** Einladung mit dem angemeldeten Konto einlösen. Liefert die Rolle. */
export async function redeemInvitation(
  db: Firestore,
  actor: Actor,
  tid: string,
  inviteId: string,
): Promise<RoleName> {
  try {
    return await runTransaction(db, async (tx) => {
      const invRef = paths.invitation(db, tid, inviteId);
      const grantRef = paths.roleGrant(db, tid, actor.uid);
      const [invSnap, grantSnap] = await Promise.all([tx.get(invRef), tx.get(grantRef)]);
      if (!invSnap.exists()) throw notFound('Die Einladung');
      const inv = invSnap.data();
      const problem = invitationProblem(inv);
      if (problem) throw new DataError('invitation_unusable', problem);
      if (grantSnap.exists()) {
        throw new DataError(
          'invitation_unusable',
          'Dein Konto hat für dieses Turnier bereits eine Rolle. Bitte wende dich an die Turnierleitung.',
        );
      }
      tx.set(grantRef, {
        uid: actor.uid,
        tournamentId: tid,
        role: inv.role,
        allowedFieldIds: inv.allowedFieldIds ?? null,
        canPublishRounds: inv.canPublishRounds ?? false,
        expiresAt: inv.grantExpiresAt ?? null,
        revokedAt: null,
        inviteId,
        email: actor.email ?? null,
        createdAt: serverTimestamp(),
        createdBy: actor.uid,
      } as never);
      tx.update(invRef, { usedBy: actor.uid, usedAt: serverTimestamp() });
      tx.set(paths.tournamentRef(db, actor.uid, tid), {
        tournamentId: tid,
        role: inv.role,
        addedAt: serverTimestamp(),
      } as never);
      return inv.role;
    });
  } catch (err) {
    throw toDataError(err);
  }
}

export async function revokeInvitation(
  db: Firestore,
  actor: Actor,
  tid: string,
  inviteId: string,
): Promise<void> {
  const batch = writeBatch(db);
  batch.update(paths.invitation(db, tid, inviteId), { revokedAt: serverTimestamp() });
  writeAudit(db, batch, tid, actor, {
    action: 'invitation.revoke',
    targetType: 'invitation',
    targetId: inviteId,
  });
  try {
    await batch.commit();
  } catch (err) {
    throw toDataError(err);
  }
}

/** Helfer-Berechtigung entziehen (wirkt sofort in den Regeln). */
export async function revokeHelper(
  db: Firestore,
  actor: Actor,
  tid: string,
  uid: string,
): Promise<void> {
  const batch = writeBatch(db);
  batch.update(paths.roleGrant(db, tid, uid), { revokedAt: serverTimestamp() });
  writeAudit(db, batch, tid, actor, { action: 'grant.revoke', targetType: 'grant', targetId: uid });
  try {
    await batch.commit();
  } catch (err) {
    throw toDataError(err);
  }
}
