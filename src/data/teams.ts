// Nichtantritt, Rückzug und Rücknahme (§2.1, §9, §12 C). Noch nicht begonnene Spiele des
// Teams werden „nicht ausgetragen“; begonnene und beendete bleiben unangetastet.
// Die Wertungsfolgen (Projektentscheidung: Spiele zurückgezogener Teams zählen für niemanden)
// berechnet src/domain; hier wird nur gespeichert und der Ergebniszähler erhöht.
import {
  deleteField,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type Firestore,
} from 'firebase/firestore';
import type { TeamStatus } from '../domain';
import { newTransactionId, undoField, writeAudit, type Actor, type UndoRef } from './audit';
import { DataError, notFound, toDataError } from './errors';
import type { PublicStandingRow, PublicTeam } from './model';
import { paths } from './paths';
import { standingsArePublic, toPublicStandings } from './projections';

export interface TeamStatusOptions extends UndoRef {
  /** Tabelle nach der Änderung (nur Modus `full`). */
  standings?: { rows: PublicStandingRow[]; throughRound: number };
  /**
   * Nur bei Rücknahme: Spiele, die der Rückzug ausfallen ließ und die wieder „geplant“ werden.
   * Übersprungen werden Spiele, die inzwischen nicht mehr „nicht ausgetragen“ sind.
   */
  reopenMatchIds?: string[];
}

async function teamMatchIds(db: Firestore, tid: string, teamId: string): Promise<string[]> {
  const [a, b] = await Promise.all([
    getDocs(query(paths.matches(db, tid), where('teamAId', '==', teamId))),
    getDocs(query(paths.matches(db, tid), where('teamBId', '==', teamId))),
  ]);
  return [...a.docs, ...b.docs].map((d) => d.id);
}

async function changeTeamStatus(
  db: Firestore,
  actor: Actor,
  tid: string,
  teamId: string,
  mode: 'withdraw' | 'restore',
  options: TeamStatusOptions,
): Promise<TeamStatus> {
  const matchIds = mode === 'withdraw' ? await teamMatchIds(db, tid, teamId) : (options.reopenMatchIds ?? []);
  const undo = undoField(options);
  try {
    return await runTransaction(db, async (tx) => {
      const tRef = paths.tournament(db, tid);
      const teamRef = paths.team(db, tid, teamId);
      const pubRef = paths.publicTournament(db, tid);
      const [tSnap, teamSnap, pubSnap, ...matchSnaps] = await Promise.all([
        tx.get(tRef),
        tx.get(teamRef),
        tx.get(pubRef),
        ...matchIds.map((id) => tx.get(paths.match(db, tid, id))),
      ]);
      if (!tSnap.exists()) throw notFound('Das Turnier');
      if (!teamSnap.exists()) throw notFound('Die Mannschaft');
      const tournament = tSnap.data();

      let status: TeamStatus = 'active';
      const transactionId = newTransactionId();
      if (mode === 'withdraw') {
        const started = matchSnaps.some((s) => {
          const st = s.data()?.status;
          return st === 'live' || st === 'completed' || st === 'not_played';
        });
        status = started ? 'withdrawn' : 'no_show';
        // Ausfallende Spiele im Audit festhalten, damit „Rückgängig“ genau diese wieder plant.
        const cancelled = matchSnaps.filter((s) => s.data()?.status === 'scheduled').map((s) => s.id);
        const audit = writeAudit(
          db,
          tx,
          tid,
          actor,
          {
            action: `team.${status}`,
            targetType: 'tournament',
            targetId: tid,
            after: { teamId, status, matchIds: cancelled, ...undo },
          },
          transactionId,
        );
        for (const s of matchSnaps) {
          const m = s.data();
          if (!m || m.status !== 'scheduled') continue;
          tx.update(s.ref, {
            status: 'not_played',
            notPlayedReason: started ? 'withdrawal' : 'no_show',
            revision: m.revision + 1,
            updatedAt: serverTimestamp(),
            updatedBy: actor.uid,
            lastAuditId: audit.id,
          });
          tx.set(
            paths.publicMatch(db, tid, s.id),
            { status: 'not_played', sourceRevision: m.revision + 1, updatedAt: serverTimestamp() },
            { merge: true },
          );
        }
        tx.update(teamRef, { status, withdrawnAt: new Date().toISOString() });
      } else {
        if (teamSnap.data().status === 'active') {
          throw new DataError('invalid_state', 'Die Mannschaft ist bereits aktiv.');
        }
        const reopened = matchSnaps.filter((s) => s.data()?.status === 'not_played');
        const audit = writeAudit(
          db,
          tx,
          tid,
          actor,
          {
            action: 'team.restore',
            targetType: 'tournament',
            targetId: tid,
            after: { teamId, ...(reopened.length > 0 ? { matchIds: reopened.map((s) => s.id) } : {}), ...undo },
          },
          transactionId,
        );
        for (const s of reopened) {
          const m = s.data()!;
          tx.update(s.ref, {
            status: 'scheduled',
            notPlayedReason: deleteField(),
            revision: m.revision + 1,
            updatedAt: serverTimestamp(),
            updatedBy: actor.uid,
            lastAuditId: audit.id,
          });
          tx.set(
            paths.publicMatch(db, tid, s.id),
            { status: 'scheduled', sourceRevision: m.revision + 1, updatedAt: serverTimestamp() },
            { merge: true },
          );
        }
        tx.update(teamRef, { status, withdrawnAt: deleteField() });
      }

      // Rückzug verändert die Wertung: Paarungsbasis ist danach veraltet.
      const resultsRevision = tournament.resultsRevision + 1;
      tx.update(tRef, {
        resultsRevision,
        revision: tournament.revision + 1,
        updatedAt: serverTimestamp(),
      });
      if (pubSnap.exists()) {
        const teams: PublicTeam[] = pubSnap
          .data()
          .teams.map((t) => (t.id === teamId ? { ...t, status } : t));
        tx.update(pubRef, { teams, updatedAt: serverTimestamp() });
        if (standingsArePublic(tournament.visibility) && options.standings) {
          tx.set(paths.publicStandings(db, tid), {
            ...toPublicStandings(options.standings.rows, options.standings.throughRound, resultsRevision),
            updatedAt: serverTimestamp(),
          } as never);
        }
      }
      return status;
    });
  } catch (err) {
    throw toDataError(err);
  }
}

/**
 * Mannschaft fällt aus. Vor ihrem ersten Spiel: `no_show`, sonst `withdrawn`. Alle noch
 * geplanten Spiele werden „nicht ausgetragen“. Liefert den neuen Status.
 */
export function withdrawTeam(
  db: Firestore,
  actor: Actor,
  tid: string,
  teamId: string,
  options: TeamStatusOptions = {},
): Promise<TeamStatus> {
  return changeTeamStatus(db, actor, tid, teamId, 'withdraw', options);
}

/** Rückzug zurücknehmen. Bereits als „nicht ausgetragen“ markierte Spiele bleiben so. */
export function restoreTeam(
  db: Firestore,
  actor: Actor,
  tid: string,
  teamId: string,
  options: TeamStatusOptions = {},
): Promise<TeamStatus> {
  return changeTeamStatus(db, actor, tid, teamId, 'restore', options);
}
