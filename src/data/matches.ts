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

/** Baukasten: wie ein Endrunden-Spiel entschieden wurde. `null` = Angaben entfernen. */
export interface MatchDecision {
  decidedBy: NonNullable<MatchDoc['decidedBy']>;
  penaltiesA?: number | null;
  penaltiesB?: number | null;
  walkoverWinner?: 'A' | 'B' | null;
}

const DECISION_KEYS = ['decidedBy', 'penaltiesA', 'penaltiesB', 'walkoverWinner'] as const;

type MatchPatch = {
  status: MatchStatus;
  goalsA?: number | null;
  goalsB?: number | null;
  notPlayedReason?: NotPlayedReason | null;
  completedAt?: 'now' | null;
  decided?: MatchDecision | null;
};

function hasDecision(m: MatchDoc): boolean {
  return DECISION_KEYS.some((k) => m[k] != null);
}

/** Entscheidung für Verlauf und Rückgängig (nur bei Baukasten-Spielen). */
function decisionSnap(m: MatchDoc): Record<string, unknown> {
  return m.stageId
    ? {
        decidedBy: m.decidedBy ?? null,
        penaltiesA: m.penaltiesA ?? null,
        penaltiesB: m.penaltiesB ?? null,
        ...(m.walkoverWinner ? { walkoverWinner: m.walkoverWinner } : {}),
      }
    : {};
}

/** Verlässt ein Spiel „beendet“, verliert es seine Entscheidung (außer kampflos gewertet). */
function clearDecision(m: MatchDoc): { decided?: null } {
  return hasDecision(m) ? { decided: null } : {};
}

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
            ...decisionSnap(current),
          },
          after: {
            status: patch.status,
            goalsA: 'goalsA' in patch ? (patch.goalsA ?? null) : (current.goalsA ?? null),
            goalsB: 'goalsB' in patch ? (patch.goalsB ?? null) : (current.goalsB ?? null),
            notPlayedReason:
              'notPlayedReason' in patch ? (patch.notPlayedReason ?? null) : (current.notPlayedReason ?? null),
            revision,
            ...(current.stageId
              ? 'decided' in patch
                ? {
                    decidedBy: patch.decided?.decidedBy ?? null,
                    penaltiesA: patch.decided?.penaltiesA ?? null,
                    penaltiesB: patch.decided?.penaltiesB ?? null,
                    ...(patch.decided?.walkoverWinner ? { walkoverWinner: patch.decided.walkoverWinner } : {}),
                  }
                : decisionSnap(current)
              : {}),
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
      if ('decided' in patch) {
        for (const k of DECISION_KEYS) {
          const v = patch.decided?.[k] ?? null;
          if (v !== null) (update as Record<string, unknown>)[k] = v;
          else if (current[k] != null) (update as Record<string, unknown>)[k] = deleteField();
        }
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
        ...('decided' in patch
          ? Object.fromEntries(DECISION_KEYS.map((k) => [k, patch.decided?.[k] ?? undefined]))
          : {}),
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
          {
            status: next.status,
            // Baukasten: wie entschieden wurde, ist öffentlich (die Neunmeter-Treffer nicht).
            ...(next.stageId ? { decidedBy: next.decidedBy ?? null, walkoverWinner: next.walkoverWinner ?? null } : {}),
            sourceRevision: revision,
            updatedAt: serverTimestamp(),
          },
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
  options: MatchWriteOptions & { finish?: boolean; decided?: MatchDecision | null } = {},
) {
  assertGoal(goalsA, 'Tore Team A');
  assertGoal(goalsB, 'Tore Team B');
  if (options.decided?.decidedBy === 'penalties') {
    assertGoal(options.decided.penaltiesA ?? -1, 'Neunmeter Team A');
    assertGoal(options.decided.penaltiesB ?? -1, 'Neunmeter Team B');
  }
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
      const decided = options.decided !== undefined ? { decided: options.decided } : options.finish ? {} : clearDecision(m);
      return options.finish
        ? { status: 'completed', goalsA, goalsB, completedAt: 'now', ...decided }
        : { status: 'live', goalsA, goalsB, ...decided };
    },
    options,
  );
}

/**
 * Gruppenspiel kampflos werten (Team kommt nicht, bleibt aber im Turnier): beendet mit 2:0 für den
 * Gegner, `decidedBy: 'walkover'`. Zählt in der Tabelle wie ein normales Ergebnis.
 */
export function recordWalkover(
  db: Firestore,
  actor: Actor,
  tid: string,
  matchId: string,
  result: { goalsA: number; goalsB: number; walkoverWinner: 'A' | 'B' },
  expectedRevision: number,
  options?: MatchWriteOptions,
) {
  return mutateMatch(
    db,
    actor,
    tid,
    matchId,
    expectedRevision,
    'match.walkover',
    (m) => {
      if (m.status !== 'scheduled' && m.status !== 'live') {
        throw new DataError('invalid_state', 'Nur Spiele, die noch nicht beendet sind, lassen sich kampflos werten.');
      }
      return {
        status: 'completed',
        goalsA: result.goalsA,
        goalsB: result.goalsB,
        notPlayedReason: null,
        completedAt: 'now',
        decided: { decidedBy: 'walkover', walkoverWinner: result.walkoverWinner, penaltiesA: null, penaltiesB: null },
      };
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
        ...clearDecision(m),
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
      // Kampflos gewertetes Gruppenspiel: zurück auf „geplant“, die 2:0 waren nie ein Spielstand.
      if (m.status === 'completed' && m.decidedBy === 'walkover') {
        return { status: 'scheduled', goalsA: null, goalsB: null, completedAt: null, decided: null };
      }
      if (m.status === 'completed') return { status: 'live', completedAt: null, ...clearDecision(m) };
      if (m.status === 'not_played') return { status: 'scheduled', notPlayedReason: null, ...clearDecision(m) };
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
      return { status: 'scheduled', goalsA: null, goalsB: null, notPlayedReason: null, completedAt: null, ...clearDecision(m) };
    },
    options,
  );
}

export interface MatchState {
  status: Extract<MatchStatus, 'scheduled' | 'live' | 'completed' | 'not_played'>;
  goalsA?: number | null;
  goalsB?: number | null;
  notPlayedReason?: NotPlayedReason | null;
  /** Baukasten: Entscheidung wiederherstellen; fehlt = unverändert bzw. entfernt, wenn nicht beendet. */
  decided?: {
    decidedBy?: MatchDecision['decidedBy'] | null;
    penaltiesA?: number | null;
    penaltiesB?: number | null;
    walkoverWinner?: 'A' | 'B' | null;
  };
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
      if (target.decided) {
        patch.decided = target.decided.decidedBy
          ? {
              decidedBy: target.decided.decidedBy,
              penaltiesA: target.decided.penaltiesA ?? null,
              penaltiesB: target.decided.penaltiesB ?? null,
              walkoverWinner: target.decided.walkoverWinner ?? null,
            }
          : null;
      } else if (target.status !== 'completed' && hasDecision(m)) {
        patch.decided = null;
      }
      return patch;
    },
    options,
  );
}
