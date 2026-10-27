// Audit-Datensatz je Änderung (§3). Die Regeln verlangen, dass jede Spieländerung auf einen
// Audit-Eintrag aus demselben Request verweist (`lastAuditId`), vom selben Akteur.
import {
  doc,
  serverTimestamp,
  type DocumentReference,
  type Firestore,
  type Transaction,
  type WriteBatch,
} from 'firebase/firestore';
import type { AuditDoc } from './model';
import { paths } from './paths';

export interface Actor {
  uid: string;
  email?: string | null;
  /** Anonymer Login über den Helferlink ohne Anmeldung (kein Konto). */
  anonymous?: boolean;
}

export interface AuditInput {
  action: string;
  targetType: AuditDoc['targetType'];
  targetId: string;
  before?: unknown;
  after?: unknown;
}

/** Entfernt `undefined` rekursiv (Firestore lehnt `undefined` ab). */
export function clean<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => clean(v)) as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = clean(v);
    }
    return out as T;
  }
  return value;
}

export function newTransactionId(): string {
  return globalThis.crypto.randomUUID();
}

/** Legt einen Audit-Eintrag im übergebenen Batch/Transaktion an und liefert seine Referenz. */
export function writeAudit(
  db: Firestore,
  writer: Transaction | WriteBatch,
  tid: string,
  actor: Actor,
  input: AuditInput,
  transactionId: string = newTransactionId(),
): DocumentReference<AuditDoc> {
  const ref = doc(paths.audit(db, tid));
  const data = clean({
    tournamentId: tid,
    actorUid: actor.uid,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    before: input.before ?? null,
    after: input.after ?? null,
    timestamp: serverTimestamp(),
    transactionId,
  });
  // Transaction.set und WriteBatch.set haben dieselbe Signatur.
  (writer as WriteBatch).set(ref, data as unknown as AuditDoc);
  return ref;
}
