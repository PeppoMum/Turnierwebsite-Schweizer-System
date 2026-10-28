// Rundenvorschau speichern, Runde freigeben, Runde schließen (§7.2 Schritt 8, §9, §10.3).
// Vorschauen (Runde `preview`, Spiele `draft`) sind nur intern sichtbar; erst die Freigabe
// erzeugt die öffentlichen Dokumente.
import {
  deleteField,
  doc,
  getDocs,
  runTransaction,
  serverTimestamp,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase/firestore';
import type { PairingDiagnostics, Round } from '../domain';
import { clean, newTransactionId, undoField, writeAudit, type Actor, type UndoRef } from './audit';
import { DataError, notFound, toDataError } from './errors';
import type { MatchDoc, RoundDoc } from './model';
import { paths } from './paths';
import { toPublicMatch, toPublicRound } from './projections';

/** Stabile Runden-ID je Rundennummer: eine Runde pro Nummer und Turnier. */
export function roundIdFor(roundNumber: number): string {
  return `round-${String(roundNumber).padStart(2, '0')}`;
}

export function byeIdFor(roundId: string, teamId: string): string {
  return `${roundId}_${teamId}`;
}

export interface PreviewMatchInput {
  teamAId: string;
  teamBId: string;
  fieldId?: string;
  waveIndex?: number;
  startISO?: string;
  durationMinutes: number;
}

export interface RoundPreviewInput {
  number: number;
  mode: Round['mode'];
  plannedStartISO: string;
  /** `tournament.resultsRevision`, auf dem die Paarung beruht. */
  generatedFromRevision: number;
  frozenPairings?: boolean;
  pairingDiagnostics?: PairingDiagnostics;
  matches: PreviewMatchInput[];
  byeTeamIds: string[];
}

function validatePreview(input: RoundPreviewInput): void {
  const seen = new Set<string>();
  const claim = (teamId: string) => {
    if (seen.has(teamId)) {
      throw new DataError(
        'invalid_input',
        'Eine Mannschaft ist in dieser Runde mehrfach angesetzt. Bitte Paarungen prüfen.',
      );
    }
    seen.add(teamId);
  };
  for (const m of input.matches) {
    if (m.teamAId === m.teamBId) {
      throw new DataError('invalid_input', 'Eine Mannschaft kann nicht gegen sich selbst spielen.');
    }
    claim(m.teamAId);
    claim(m.teamBId);
  }
  input.byeTeamIds.forEach(claim);
}

/**
 * Speichert (oder ersetzt) die Vorschau einer Runde. Eine bereits freigegebene Runde wird
 * nie überschrieben.
 */
export async function saveRoundPreview(
  db: Firestore,
  actor: Actor,
  tid: string,
  input: RoundPreviewInput,
): Promise<{ roundId: string; matchIds: string[] }> {
  validatePreview(input);
  const roundId = roundIdFor(input.number);
  try {
    return await runTransaction(db, async (tx) => {
      const roundRef = paths.round(db, tid, roundId);
      const existing = await tx.get(roundRef);
      if (existing.exists()) {
        const old = existing.data();
        if (old.status !== 'draft' && old.status !== 'preview') {
          throw new DataError(
            'invalid_state',
            `Runde ${input.number} ist bereits freigegeben und kann nicht neu ausgelost werden.`,
          );
        }
        for (const id of old.matchIds) tx.delete(paths.match(db, tid, id));
        for (const teamId of old.byeTeamIds ?? []) {
          tx.delete(doc(paths.byes(db, tid), byeIdFor(roundId, teamId)));
        }
      }

      const matchIds: string[] = [];
      for (const m of input.matches) {
        const ref = doc(paths.matches(db, tid));
        matchIds.push(ref.id);
        tx.set(
          ref,
          clean({
            ...m,
            roundId,
            roundNumber: input.number,
            status: 'draft',
            revision: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }) as never,
        );
      }
      for (const teamId of input.byeTeamIds) {
        tx.set(doc(paths.byes(db, tid), byeIdFor(roundId, teamId)), {
          roundId,
          teamId,
          reason: 'odd_team_count',
        });
      }
      tx.set(
        roundRef,
        clean({
          number: input.number,
          status: 'preview',
          mode: input.mode,
          plannedStartISO: input.plannedStartISO,
          generatedFromRevision: input.generatedFromRevision,
          frozenPairings: input.frozenPairings ?? false,
          pairingDiagnostics: input.pairingDiagnostics,
          matchIds,
          byeTeamIds: input.byeTeamIds,
          updatedAt: serverTimestamp(),
        }) as never,
      );
      writeAudit(db, tx, tid, actor, {
        action: 'round.preview',
        targetType: 'round',
        targetId: roundId,
        after: { matches: matchIds.length, byes: input.byeTeamIds.length },
      });
      return { roundId, matchIds };
    });
  } catch (err) {
    throw toDataError(err);
  }
}

export interface PublishRoundOptions {
  /**
   * Schweizer Runde trotz veralteter Paarungsbasis freigeben (Ergebnisse wurden nach der
   * Berechnung geändert). Standard: ablehnen.
   */
  allowStaleBasis?: boolean;
}

/**
 * Runde freigeben: atomisch prüfen (Status `preview`, Vorrunde geschlossen, Paarungsbasis
 * aktuell), Spiele auf `scheduled` setzen und die öffentliche Projektion anlegen. Bei
 * gleichzeitigen Freigaben gewinnt genau eine Transaktion.
 */
export async function publishRound(
  db: Firestore,
  actor: Actor,
  tid: string,
  roundId: string,
  options: PublishRoundOptions = {},
): Promise<void> {
  try {
    await runTransaction(db, async (tx) => {
      const tRef = paths.tournament(db, tid);
      const roundRef = paths.round(db, tid, roundId);
      const grantRef = paths.roleGrant(db, tid, actor.uid);
      const [tSnap, rSnap, gSnap] = await Promise.all([
        tx.get(tRef),
        tx.get(roundRef),
        tx.get(grantRef),
      ]);
      if (!tSnap.exists()) throw notFound('Das Turnier');
      if (!rSnap.exists()) throw notFound('Die Runde');
      const tournament = tSnap.data();
      const round = rSnap.data();
      if (round.status !== 'preview') {
        throw new DataError(
          'invalid_state',
          round.status === 'draft'
            ? 'Die Runde ist noch ein Entwurf. Bitte zuerst die Vorschau erstellen.'
            : `Runde ${round.number} ist bereits freigegeben.`,
        );
      }
      if (round.mode === 'swiss') {
        if (round.number > 1) {
          const prev = await tx.get(paths.round(db, tid, roundIdFor(round.number - 1)));
          if (!prev.exists() || prev.data().status !== 'closed') {
            throw new DataError(
              'invalid_state',
              `Runde ${round.number - 1} ist noch nicht abgeschlossen. Schweizer Runden beruhen auf vollständig entschiedenen Vorrunden.`,
            );
          }
        }
        if (round.generatedFromRevision !== tournament.resultsRevision && !options.allowStaleBasis) {
          throw new DataError(
            'invalid_state',
            'Seit der Berechnung dieser Paarungen wurden Ergebnisse geändert. Bitte die Runde neu berechnen oder bewusst trotzdem freigeben.',
          );
        }
      }

      const matchSnaps: DocumentSnapshot<MatchDoc>[] = await Promise.all(
        round.matchIds.map((id) => tx.get(paths.match(db, tid, id))),
      );
      for (const s of matchSnaps) {
        if (!s.exists()) throw notFound('Ein Spiel dieser Runde');
        if (s.data()!.status !== 'draft') {
          throw new DataError('invalid_state', 'Ein Spiel dieser Runde ist bereits freigegeben.');
        }
      }

      const transactionId = newTransactionId();
      const auditRef = writeAudit(
        db,
        tx,
        tid,
        actor,
        {
          action: 'round.publish',
          targetType: 'round',
          targetId: roundId,
          after: { matches: round.matchIds.length, generatedFromRevision: round.generatedFromRevision },
        },
        transactionId,
      );

      tx.update(roundRef, { status: 'published', publishedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      const publishedRound: RoundDoc = { ...round, status: 'published' };
      tx.set(paths.publicRound(db, tid, roundId), {
        ...toPublicRound(roundId, publishedRound),
        publishedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      } as never);

      for (const s of matchSnaps) {
        const m = s.data()!;
        const next: MatchDoc = { ...m, status: 'scheduled', revision: m.revision + 1 };
        tx.update(s.ref, {
          status: 'scheduled',
          revision: next.revision,
          updatedAt: serverTimestamp(),
          updatedBy: actor.uid,
          lastAuditId: auditRef.id,
        });
        tx.set(paths.publicMatch(db, tid, s.id), {
          ...toPublicMatch(s.id, next),
          updatedAt: serverTimestamp(),
        } as never);
      }

      // Nur der Owner pflegt `currentRound` (erweiterte Helfer dürfen das Turnier nicht ändern).
      if (gSnap.exists() && gSnap.data().role === 'owner' && round.number > tournament.currentRound) {
        tx.update(tRef, {
          currentRound: round.number,
          revision: tournament.revision + 1,
          updatedAt: serverTimestamp(),
        });
      }
    });
  } catch (err) {
    throw toDataError(err);
  }
}

/** Runde schließen, sobald alle Spiele entschieden sind (§9). Nur Owner. */
export async function closeRound(
  db: Firestore,
  actor: Actor,
  tid: string,
  roundId: string,
): Promise<void> {
  try {
    await runTransaction(db, async (tx) => {
      const roundRef = paths.round(db, tid, roundId);
      const rSnap = await tx.get(roundRef);
      if (!rSnap.exists()) throw notFound('Die Runde');
      const round = rSnap.data();
      if (round.status !== 'published' && round.status !== 'active') {
        throw new DataError('invalid_state', 'Nur freigegebene oder laufende Runden können geschlossen werden.');
      }
      const matchSnaps = await Promise.all(
        round.matchIds.map((id) => tx.get(paths.match(db, tid, id))),
      );
      const open = matchSnaps.filter((s) => {
        const status = s.data()?.status;
        return status !== 'completed' && status !== 'not_played' && status !== 'cancelled';
      });
      if (open.length > 0) {
        throw new DataError(
          'invalid_state',
          `Noch ${open.length} Spiel(e) offen. Bitte alle Ergebnisse eintragen oder als „nicht ausgetragen“ markieren.`,
        );
      }
      writeAudit(db, tx, tid, actor, { action: 'round.close', targetType: 'round', targetId: roundId });
      tx.update(roundRef, { status: 'closed', closedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      tx.set(
        paths.publicRound(db, tid, roundId),
        { status: 'closed', updatedAt: serverTimestamp() },
        { merge: true },
      );
    });
  } catch (err) {
    throw toDataError(err);
  }
}

/**
 * Abgeschlossene Runde wieder öffnen („Rückgängig“ im Verlauf). Nur Owner und nur, solange
 * danach keine weitere Runde ausgelost wurde.
 */
export async function reopenRound(
  db: Firestore,
  actor: Actor,
  tid: string,
  roundId: string,
  audit: UndoRef = {},
): Promise<void> {
  try {
    const rounds = await getDocs(paths.rounds(db, tid));
    await runTransaction(db, async (tx) => {
      const roundRef = paths.round(db, tid, roundId);
      const rSnap = await tx.get(roundRef);
      if (!rSnap.exists()) throw notFound('Die Runde');
      const round = rSnap.data();
      if (round.status !== 'closed') {
        throw new DataError('invalid_state', 'Die Runde ist nicht abgeschlossen.');
      }
      const drawn = (d: RoundDoc) => d.status !== 'draft' && d.status !== 'preview';
      if (rounds.docs.some((d) => d.data().number > round.number && drawn(d.data()))) {
        throw new DataError('invalid_state', 'Danach wurde schon eine weitere Runde ausgelost.');
      }
      writeAudit(db, tx, tid, actor, {
        action: 'round.reopen',
        targetType: 'round',
        targetId: roundId,
        after: { roundNumber: round.number, ...undoField(audit) },
      });
      tx.update(roundRef, { status: 'active', closedAt: deleteField(), updatedAt: serverTimestamp() });
      tx.set(
        paths.publicRound(db, tid, roundId),
        { status: 'active', updatedAt: serverTimestamp() },
        { merge: true },
      );
    });
  } catch (err) {
    throw toDataError(err);
  }
}
