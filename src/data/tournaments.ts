// Turniere anlegen, konfigurieren, veröffentlichen, Sichtbarkeit umschalten (§11).
import {
  doc,
  getDocs,
  runTransaction,
  serverTimestamp,
  writeBatch,
  type Firestore,
  type UpdateData,
} from 'firebase/firestore';
import type { TournamentStatus, Visibility } from '../domain';
import { clean, writeAudit, type Actor } from './audit';
import { DataError, RevisionConflictError, notFound, toDataError } from './errors';
import { toTournament } from './mappers';
import type { PublicStandingRow, TournamentDoc } from './model';
import { paths } from './paths';
import {
  isPublishedMatchStatus,
  resultsArePublic,
  standingsArePublic,
  toPublicResult,
  toPublicStandings,
  toPublicTournament,
} from './projections';

/** Konfigurationsfelder, die beim Anlegen gesetzt werden. */
export type NewTournamentInput = Omit<
  TournamentDoc,
  | 'ownerUid'
  | 'status'
  | 'revision'
  | 'resultsRevision'
  | 'currentRound'
  | 'createdAt'
  | 'updatedAt'
  | 'publishedAt'
  | 'finishedAt'
>;

/** Über updateTournamentConfig änderbare Felder (Sichtbarkeit über setVisibility). */
export type TournamentConfigPatch = Partial<
  Omit<
    TournamentDoc,
    'ownerUid' | 'revision' | 'resultsRevision' | 'createdAt' | 'updatedAt' | 'visibility'
  >
>;

/**
 * Legt Turnier, Owner-Grant, Dashboard-Referenz und Audit-Eintrag atomar an.
 * Liefert die neue Turnier-ID.
 */
export async function createTournament(
  db: Firestore,
  actor: Actor,
  input: NewTournamentInput,
  options: { tournamentId?: string } = {},
): Promise<string> {
  if (!input.title.trim()) {
    throw new DataError('invalid_input', 'Bitte gib dem Turnier einen Namen.');
  }
  // Eine vorab vergebene ID erlaubt Link und QR-Code schon im Assistenten. Die Regeln
  // lassen das Anlegen nur zu, wenn es das Turnier noch nicht gibt.
  const tournamentRef = options.tournamentId
    ? paths.tournament(db, options.tournamentId)
    : doc(paths.tournaments(db));
  const tid = tournamentRef.id;
  const batch = writeBatch(db);
  batch.set(
    tournamentRef,
    clean({
      ...input,
      title: input.title.trim(),
      ownerUid: actor.uid,
      status: 'draft',
      revision: 0,
      resultsRevision: 0,
      currentRound: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }) as never,
  );
  batch.set(paths.roleGrant(db, tid, actor.uid), {
    uid: actor.uid,
    tournamentId: tid,
    role: 'owner',
    email: actor.email ?? null,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  } as never);
  batch.set(paths.tournamentRef(db, actor.uid, tid), {
    tournamentId: tid,
    role: 'owner',
    addedAt: serverTimestamp(),
  } as never);
  writeAudit(db, batch, tid, actor, {
    action: 'tournament.create',
    targetType: 'tournament',
    targetId: tid,
    after: { title: input.title.trim() },
  });
  try {
    await batch.commit();
  } catch (err) {
    throw toDataError(err);
  }
  return tid;
}

/** Konfiguration ändern, nur mit passender `revision` (optimistische Sperre). */
export async function updateTournamentConfig(
  db: Firestore,
  actor: Actor,
  tid: string,
  expectedRevision: number,
  patch: TournamentConfigPatch,
) {
  const forbidden = ['ownerUid', 'revision', 'resultsRevision', 'createdAt', 'updatedAt', 'visibility'];
  for (const key of Object.keys(patch)) {
    if (forbidden.includes(key)) {
      throw new DataError('invalid_input', `Das Feld „${key}“ kann hier nicht geändert werden.`);
    }
  }
  try {
    return await runTransaction(db, async (tx) => {
      const ref = paths.tournament(db, tid);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw notFound('Das Turnier');
      const current = snap.data();
      if (current.revision !== expectedRevision) {
        throw new RevisionConflictError(
          expectedRevision,
          current.revision,
          toTournament(tid, current),
          'Die Turnierkonfiguration',
        );
      }
      writeAudit(db, tx, tid, actor, {
        action: 'tournament.update',
        targetType: 'tournament',
        targetId: tid,
        before: pick(current, Object.keys(patch)),
        after: patch,
      });
      tx.update(ref, {
        ...clean(patch),
        revision: current.revision + 1,
        updatedAt: serverTimestamp(),
      } as UpdateData<TournamentDoc>);
      return current.revision + 1;
    });
  } catch (err) {
    throw toDataError(err);
  }
}

/**
 * Turnierstatus ändern (veröffentlicht, läuft, beendet, archiviert) und die öffentliche
 * Projektion nachziehen. `finished` schließt alle freigegebenen Runden.
 */
export async function setTournamentStatus(
  db: Firestore,
  actor: Actor,
  tid: string,
  expectedRevision: number,
  status: TournamentStatus,
): Promise<number> {
  try {
    const rounds = status === 'finished' ? await getDocs(paths.rounds(db, tid)) : null;
    const revision = await runTransaction(db, async (tx) => {
      const ref = paths.tournament(db, tid);
      const pubRef = paths.publicTournament(db, tid);
      const [snap, pubSnap] = await Promise.all([tx.get(ref), tx.get(pubRef)]);
      if (!snap.exists()) throw notFound('Das Turnier');
      const current = snap.data();
      if (current.revision !== expectedRevision) {
        throw new RevisionConflictError(
          expectedRevision,
          current.revision,
          toTournament(tid, current),
          'Das Turnier',
        );
      }
      if (pubSnap.exists()) tx.update(pubRef, { status, updatedAt: serverTimestamp() });
      writeAudit(db, tx, tid, actor, {
        action: `tournament.status.${status}`,
        targetType: 'tournament',
        targetId: tid,
        before: { status: current.status },
        after: { status },
      });
      const update: UpdateData<TournamentDoc> = {
        status,
        revision: current.revision + 1,
        updatedAt: serverTimestamp(),
      };
      if (status === 'published' && !current.publishedAt) update.publishedAt = serverTimestamp();
      if (status === 'finished') update.finishedAt = serverTimestamp();
      tx.update(ref, update);
      for (const r of rounds?.docs ?? []) {
        if (r.data().status !== 'published' && r.data().status !== 'active') continue;
        tx.update(r.ref, { status: 'closed', closedAt: serverTimestamp(), updatedAt: serverTimestamp() });
        tx.set(
          paths.publicRound(db, tid, r.id),
          { status: 'closed', updatedAt: serverTimestamp() },
          { merge: true },
        );
      }
      return current.revision + 1;
    });
    return revision;
  } catch (err) {
    throw toDataError(err);
  }
}

/**
 * Schreibt die öffentliche Turnier-Projektion (Stammdaten, Teams alphabetisch, Felder,
 * Sponsoren). `isPublic=false` nimmt das Turnier offline, ohne Daten zu löschen.
 */
export async function syncPublicTournament(
  db: Firestore,
  tid: string,
  options: { isPublic: boolean },
): Promise<void> {
  try {
    const [teams, fields, sponsors] = await Promise.all([
      getDocs(paths.teams(db, tid)),
      getDocs(paths.fields(db, tid)),
      getDocs(paths.sponsors(db, tid)),
    ]);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(paths.tournament(db, tid));
      if (!snap.exists()) throw notFound('Das Turnier');
      const projection = toPublicTournament(tid, snap.data(), {
        teams: teams.docs.map((d) => ({ ...d.data(), id: d.id })),
        fields: fields.docs.map((d) => ({ ...d.data(), id: d.id })),
        sponsors: sponsors.docs.map((d) => ({ ...d.data(), id: d.id })),
        isPublic: options.isPublic,
      });
      tx.set(paths.publicTournament(db, tid), {
        ...projection,
        updatedAt: serverTimestamp(),
      } as never);
    });
  } catch (err) {
    throw toDataError(err);
  }
}

/**
 * Sichtbarkeitsmodus umschalten (§2.1, §4.4) und die öffentliche Projektion in derselben
 * Transaktion anpassen:
 * - `kids`: alle publicResults und die Tabelle werden gelöscht. Die Regeln sperren das
 *   Lesen zusätzlich, selbst wenn ein Dokument übrig bliebe.
 * - `no_standings`: Ergebnisse werden (neu) veröffentlicht, die Tabelle gelöscht.
 * - `full`: Ergebnisse und – falls übergeben – Tabelle werden veröffentlicht.
 */
export async function setVisibility(
  db: Firestore,
  actor: Actor,
  tid: string,
  expectedRevision: number,
  visibility: Visibility,
  options: { standings?: { rows: PublicStandingRow[]; throughRound: number } } = {},
): Promise<number> {
  try {
    const matches = await getDocs(paths.matches(db, tid));
    return await runTransaction(db, async (tx) => {
      const tRef = paths.tournament(db, tid);
      const pubRef = paths.publicTournament(db, tid);
      const [tSnap, pubSnap] = await Promise.all([tx.get(tRef), tx.get(pubRef)]);
      if (!tSnap.exists()) throw notFound('Das Turnier');
      const current = tSnap.data();
      if (current.revision !== expectedRevision) {
        throw new RevisionConflictError(
          expectedRevision,
          current.revision,
          toTournament(tid, current),
          'Die Turnierkonfiguration',
        );
      }
      writeAudit(db, tx, tid, actor, {
        action: 'tournament.visibility',
        targetType: 'visibility',
        targetId: tid,
        before: { visibility: current.visibility },
        after: { visibility },
      });
      tx.update(tRef, {
        visibility,
        revision: current.revision + 1,
        updatedAt: serverTimestamp(),
      });

      if (pubSnap.exists()) {
        tx.update(pubRef, { visibility, updatedAt: serverTimestamp() });
        const published = matches.docs.filter((d) => isPublishedMatchStatus(d.data().status));
        for (const m of published) {
          const resultRef = paths.publicResult(db, tid, m.id);
          if (resultsArePublic(visibility)) {
            tx.set(resultRef, {
              ...toPublicResult(m.id, m.data()),
              updatedAt: serverTimestamp(),
            } as never);
          } else {
            tx.delete(resultRef);
          }
        }
        const standingsRef = paths.publicStandings(db, tid);
        if (standingsArePublic(visibility) && options.standings) {
          tx.set(standingsRef, {
            ...toPublicStandings(
              options.standings.rows,
              options.standings.throughRound,
              current.resultsRevision,
            ),
            updatedAt: serverTimestamp(),
          } as never);
        } else if (!standingsArePublic(visibility)) {
          tx.delete(standingsRef);
        }
      }
      return current.revision + 1;
    });
  } catch (err) {
    throw toDataError(err);
  }
}

/** Öffentliche Tabelle neu schreiben (nur Modus `full`, sonst von den Regeln abgelehnt). */
export async function publishStandings(
  db: Firestore,
  tid: string,
  rows: PublicStandingRow[],
  throughRound: number,
  resultsRevision: number,
): Promise<void> {
  const batch = writeBatch(db);
  batch.set(paths.publicStandings(db, tid), {
    ...toPublicStandings(rows, throughRound, resultsRevision),
    updatedAt: serverTimestamp(),
  } as never);
  try {
    await batch.commit();
  } catch (err) {
    throw toDataError(err);
  }
}

function pick(source: object, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = (source as Record<string, unknown>)[k] ?? null;
  return clean(out);
}
