// Spielstände und Spielstatus (§11: setMatchLive, recordResult, markMatchNotPlayed,
// reopenMatchForCorrection). Jede Änderung läuft als Transaktion mit erwarteter
// `match.revision`; eine abweichende Revision führt zum Konfliktdialog (§12 F) statt
// „letzter Schreibvorgang gewinnt“.
import {
  deleteField,
  runTransaction,
  serverTimestamp,
  type Firestore,
  type UpdateData,
} from 'firebase/firestore';
import type { MatchStatus, NotPlayedReason } from '../domain';
import { clean, newTransactionId, undoField, writeAudit, type Actor, type UndoRef } from './audit';
import { DataError, RevisionConflictError, notFound, toDataError } from './errors';
import { toMatch } from './mappers';
import type { MatchDoc, PublicStandingRow } from './model';
import { paths } from './paths';
import {
  isPublishedMatchStatus,
  resultsArePublic,
  standingsArePublic,
  toPublicResult,
  toPublicStandings,
} from './projections';

export const MAX_GOALS = 99;

export interface MatchWriteOptions extends UndoRef {
  /**
   * Nur im Modus `full`: berechnet die öffentliche Tabelle nach dieser Änderung.
   * Bekommt das geänderte Spiel; der Aufrufer kennt alle übrigen Spiele aus seinem Abo.
   */
  standingsAfter?: (
    updated: MatchDoc & { id: string },
  ) => { rows: PublicStandingRow[]; throughRound: number };
}

type MatchPatch = {
  status: MatchStatus;
  goalsA?: number | null;
  goalsB?: number | null;
  notPlayedReason?: NotPlayedReason | null;
  completedAt?: 'now' | null;
};

function assertGoal(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_GOALS) {
    throw new DataError(
      'invalid_input',
      `${label}: Bitte eine ganze Zahl zwischen 0 und ${MAX_GOALS} eingeben.`,
    );
  }
}

export function isResultRelevantChange(before: MatchDoc, after: MatchDoc): boolean {
  return (
    (before.goalsA ?? null) !== (after.goalsA ?? null) ||
    (before.goalsB ?? null) !== (after.goalsB ?? null) ||
    (before.status === 'completed') !== (after.status === 'completed')
  );
}

async function mutateMatch(
  db: Firestore,
  actor: Actor,
  tid: string,
  matchId: string,
  expectedRevision: number,
  action: string,
  patchFor: (current: MatchDoc) => MatchPatch,
  options: MatchWriteOptions = {},
) {
  try {
    return await runTransaction(db, async (tx) => {
      const tournamentRef = paths.tournament(db, tid);
      const matchRef = paths.match(db, tid, matchId);
      const [tSnap, mSnap] = await Promise.all([tx.get(tournamentRef), tx.get(matchRef)]);
      if (!tSnap.exists()) throw notFound('Das Turnier');
      if (!mSnap.exists()) throw notFound('Das Spiel');
      const tournament = tSnap.data();
      const current = mSnap.data();
      if (current.revision !== expectedRevision) {
        throw new RevisionConflictError(
          expectedRevision,
          current.revision,
          toMatch(matchId, current),
        );
      }

      const patch = patchFor(current);
      const revision = current.revision + 1;
      const transactionId = newTransactionId();
      const auditRef = writeAudit(
        db,
        tx,
        tid,
        actor,
        {
          action,
          targetType: 'match',
          targetId: matchId,
          before: {
            status: current.status,
            goalsA: current.goalsA ?? null,
            goalsB: current.goalsB ?? null,
            notPlayedReason: current.notPlayedReason ?? null,
            revision: current.revision,
          },
          after: {
            status: patch.status,
            goalsA: 'goalsA' in patch ? (patch.goalsA ?? null) : (current.goalsA ?? null),
            goalsB: 'goalsB' in patch ? (patch.goalsB ?? null) : (current.goalsB ?? null),
            notPlayedReason:
              'notPlayedReason' in patch ? (patch.notPlayedReason ?? null) : (current.notPlayedReason ?? null),
            revision,
            ...undoField(options),
          },
        },
        transactionId,
      );

      const update: UpdateData<MatchDoc> = {
        status: patch.status,
        revision,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
        lastAuditId: auditRef.id,
      };
      if ('goalsA' in patch) update.goalsA = patch.goalsA ?? deleteField();
      if ('goalsB' in patch) update.goalsB = patch.goalsB ?? deleteField();
      if ('notPlayedReason' in patch) update.notPlayedReason = patch.notPlayedReason ?? deleteField();
      if ('completedAt' in patch) {
        update.completedAt = patch.completedAt === 'now' ? serverTimestamp() : deleteField();
      }
      tx.update(matchRef, update);

      // Lokales Bild des Spiels nach der Änderung (für Projektionen und Rückgabe).
      const next: MatchDoc = clean({
        ...current,
        status: patch.status,
        goalsA: 'goalsA' in patch ? (patch.goalsA ?? undefined) : current.goalsA,
        goalsB: 'goalsB' in patch ? (patch.goalsB ?? undefined) : current.goalsB,
        notPlayedReason:
          'notPlayedReason' in patch ? (patch.notPlayedReason ?? undefined) : current.notPlayedReason,
        revision,
      });

      const relevant = isResultRelevantChange(current, next);
      const resultsRevision = tournament.resultsRevision + (relevant ? 1 : 0);
      if (relevant) {
        tx.update(tournamentRef, { resultsRevision, updatedAt: serverTimestamp() });
      }

      // Öffentliche Projektion: Status immer, Tore nur außerhalb des Kindermodus.
      if (isPublishedMatchStatus(current.status) && isPublishedMatchStatus(next.status)) {
        tx.set(
          paths.publicMatch(db, tid, matchId),
          { status: next.status, sourceRevision: revision, updatedAt: serverTimestamp() },
          { merge: true },
        );
        if (resultsArePublic(tournament.visibility)) {
          tx.set(paths.publicResult(db, tid, matchId), {
            ...toPublicResult(matchId, next),
            updatedAt: serverTimestamp(),
          } as never);
        }
        if (standingsArePublic(tournament.visibility) && relevant && options.standingsAfter) {
          const { rows, throughRound } = options.standingsAfter({ ...next, id: matchId });
          tx.set(paths.publicStandings(db, tid), {
            ...toPublicStandings(rows, throughRound, resultsRevision),
            updatedAt: serverTimestamp(),
          } as never);
        }
      }

      return toMatch(matchId, next);
    });
  } catch (err) {
    throw toDataError(err);
  }
}

/** Anpfiff: scheduled -> live. */
export function setMatchLive(
  db: Firestore,
  actor: Actor,
  tid: string,
  matchId: string,
  expectedRevision: number,
  options?: MatchWriteOptions,
) {
  return mutateMatch(
    db,
    actor,
    tid,
    matchId,
    expectedRevision,
    'match.live',
    (m) => {
      if (m.status !== 'scheduled') {
        throw new DataError('invalid_state', 'Nur geplante Spiele können angepfiffen werden.');
      }
      return { status: 'live' };
    },
    options,
  );
}

/**
 * Spielstand speichern. Ohne `finish` bleibt das Spiel `live` (Zwischenstand, sofort
 * persistiert); mit `finish` wird es `completed` („Spiel beenden“).
 */
export function recordResult(
  db: Firestore,
  actor: Actor,
  tid: string,
  matchId: string,
  goalsA: number,
  goalsB: number,
  expectedRevision: number,
  options: MatchWriteOptions & { finish?: boolean } = {},
) {
  assertGoal(goalsA, 'Tore Team A');
  assertGoal(goalsB, 'Tore Team B');
  return mutateMatch(
    db,
    actor,
    tid,
    matchId,
    expectedRevision,
    options.finish ? 'match.result.final' : 'match.result.live',
    (m) => {
      if (m.status === 'draft' || m.status === 'cancelled') {
        throw new DataError('invalid_state', 'Für dieses Spiel kann kein Ergebnis erfasst werden.');
      }
      if (m.status === 'not_played') {
        throw new DataError(
          'invalid_state',
          'Das Spiel ist als „nicht ausgetragen“ markiert. Öffne es zuerst zur Korrektur.',
        );
      }
      return options.finish
        ? { status: 'completed', goalsA, goalsB, completedAt: 'now' }
        : { status: 'live', goalsA, goalsB };
    },
    options,
  );
}

/** Nicht ausgetragen: für beide Teams kein Spiel, keine Punkte, keine Tore (§2.1). */
export function markMatchNotPlayed(
  db: Firestore,
  actor: Actor,
  tid: string,
  matchId: string,
  reason: NotPlayedReason,
  expectedRevision: number,
  options?: MatchWriteOptions,
) {
  return mutateMatch(
    db,
    actor,
    tid,
    matchId,
    expectedRevision,
    'match.not_played',
    (m) => {
      if (m.status === 'draft' || m.status === 'cancelled') {
        throw new DataError('invalid_state', 'Dieses Spiel kann nicht als „nicht ausgetragen“ markiert werden.');
      }
      // Beendete Spiele nachträglich als „nicht ausgetragen“ markieren dürfen nur Owner und
      // erweiterte Helfer (Regeln).
      return {
        status: 'not_played',
        goalsA: null,
        goalsB: null,
        notPlayedReason: reason,
        completedAt: null,
      };
    },
    options,
  );
}

/**
 * Entschiedenes Spiel zur Korrektur öffnen (nur Owner/erweiterte Helfer, von den Regeln
 * erzwungen). Ein beendetes Spiel wird wieder `live` mit seinem Stand, ein nicht
 * ausgetragenes wieder `scheduled`.
 */
export function reopenMatchForCorrection(
  db: Firestore,
  actor: Actor,
  tid: string,
  matchId: string,
  expectedRevision: number,
  options?: MatchWriteOptions,
) {
  return mutateMatch(
    db,
    actor,
    tid,
    matchId,
    expectedRevision,
    'match.reopen',
    (m) => {
      if (m.status === 'completed') return { status: 'live', completedAt: null };
      if (m.status === 'not_played') return { status: 'scheduled', notPlayedReason: null };
      throw new DataError('invalid_state', 'Nur beendete oder nicht ausgetragene Spiele können geöffnet werden.');
    },
    options,
  );
}

/** Zurück auf „geplant“ (z. B. versehentlich angepfiffen): Stand wird verworfen. */
export function resetMatchToScheduled(
  db: Firestore,
  actor: Actor,
  tid: string,
  matchId: string,
  expectedRevision: number,
  options?: MatchWriteOptions,
) {
  return mutateMatch(
    db,
    actor,
    tid,
    matchId,
    expectedRevision,
    'match.reset',
    (m) => {
      if (m.status !== 'live' && m.status !== 'completed' && m.status !== 'not_played') {
        throw new DataError('invalid_state', 'Dieses Spiel ist bereits geplant oder nicht freigegeben.');
      }
      return { status: 'scheduled', goalsA: null, goalsB: null, notPlayedReason: null, completedAt: null };
    },
    options,
  );
}

export interface MatchState {
  status: Extract<MatchStatus, 'scheduled' | 'live' | 'completed' | 'not_played'>;
  goalsA?: number | null;
  goalsB?: number | null;
  notPlayedReason?: NotPlayedReason | null;
}

/**
 * Spiel auf einen früheren Stand zurücksetzen („Rückgängig“ im Verlauf, nur Owner).
 * `options.undoOf` verweist auf den Verlaufseintrag, der damit zurückgenommen wird.
 */
export function restoreMatchState(
  db: Firestore,
  actor: Actor,
  tid: string,
  matchId: string,
  target: MatchState,
  expectedRevision: number,
  options?: MatchWriteOptions,
) {
  const withGoals = target.status === 'completed' || (target.status === 'live' && target.goalsA != null);
  if (withGoals) {
    assertGoal(target.goalsA ?? -1, 'Tore Team A');
    assertGoal(target.goalsB ?? -1, 'Tore Team B');
  }
  return mutateMatch(
    db,
    actor,
    tid,
    matchId,
    expectedRevision,
    'match.undo',
    (m) => {
      if (m.status === 'draft' || m.status === 'cancelled') {
        throw new DataError('invalid_state', 'Dieses Spiel lässt sich nicht zurücksetzen.');
      }
      const patch: MatchPatch = {
        status: target.status,
        goalsA: withGoals ? target.goalsA : null,
        goalsB: withGoals ? target.goalsB : null,
        notPlayedReason: target.status === 'not_played' ? (target.notPlayedReason ?? 'other') : null,
      };
      // Beendet bleibt beendet: der ursprüngliche Zeitpunkt bleibt dann stehen.
      if (target.status !== 'completed') patch.completedAt = null;
      else if (m.status !== 'completed') patch.completedAt = 'now';
      return patch;
    },
    options,
  );
}
