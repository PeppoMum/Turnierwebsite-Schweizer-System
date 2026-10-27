// Zeitverschiebung (§8.3, §12 H): nur noch nicht begonnene Spiele verschieben sich;
// laufende und beendete behalten ihre Zeiten.
import { getDocs, query, runTransaction, serverTimestamp, where, type Firestore } from 'firebase/firestore';
import { newTransactionId, writeAudit, type Actor } from './audit';
import { DataError, toDataError } from './errors';
import { paths } from './paths';

const shift = (iso: string, minutes: number) =>
  new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();

/** Verschiebt alle geplanten Spiele und noch nicht begonnenen Runden. Liefert die Anzahl Spiele. */
export async function shiftFutureMatches(
  db: Firestore,
  actor: Actor,
  tid: string,
  deltaMinutes: number,
): Promise<number> {
  if (!Number.isInteger(deltaMinutes) || deltaMinutes === 0 || Math.abs(deltaMinutes) > 24 * 60) {
    throw new DataError('invalid_input', 'Bitte eine Verschiebung in ganzen Minuten (höchstens 24 Stunden) angeben.');
  }
  try {
    const [scheduled, rounds] = await Promise.all([
      getDocs(query(paths.matches(db, tid), where('status', '==', 'scheduled'))),
      getDocs(paths.rounds(db, tid)),
    ]);
    return await runTransaction(db, async (tx) => {
      const snaps = await Promise.all(scheduled.docs.map((d) => tx.get(d.ref)));
      const roundSnaps = await Promise.all(rounds.docs.map((d) => tx.get(d.ref)));
      const audit = writeAudit(
        db,
        tx,
        tid,
        actor,
        { action: 'schedule.shift', targetType: 'tournament', targetId: tid, after: { deltaMinutes } },
        newTransactionId(),
      );
      const shiftedRounds = new Set<string>();
      let count = 0;
      for (const s of snaps) {
        const m = s.data();
        // Inzwischen angepfiffen: nicht verschieben.
        if (!m || m.status !== 'scheduled' || !m.startISO) continue;
        const startISO = shift(m.startISO, deltaMinutes);
        tx.update(s.ref, {
          startISO,
          revision: m.revision + 1,
          updatedAt: serverTimestamp(),
          updatedBy: actor.uid,
          lastAuditId: audit.id,
        });
        tx.set(
          paths.publicMatch(db, tid, s.id),
          { startISO, sourceRevision: m.revision + 1, updatedAt: serverTimestamp() },
          { merge: true },
        );
        shiftedRounds.add(m.roundId);
        count++;
      }
      for (const r of roundSnaps) {
        const round = r.data();
        if (!round || !shiftedRounds.has(r.id)) continue;
        // Runde gilt als nicht begonnen, wenn keines ihrer Spiele mehr als „geplant“ ist.
        const started = snaps.some((s) => s.data()?.roundId === r.id && s.data()?.status !== 'scheduled');
        const anyOutside = round.matchIds.some((id) => !snaps.some((s) => s.id === id));
        if (started || anyOutside) continue;
        const plannedStartISO = shift(round.plannedStartISO, deltaMinutes);
        tx.update(r.ref, { plannedStartISO, updatedAt: serverTimestamp() });
        if (round.status !== 'draft' && round.status !== 'preview') {
          tx.set(
            paths.publicRound(db, tid, r.id),
            { plannedStartISO, updatedAt: serverTimestamp() },
            { merge: true },
          );
        }
      }
      return count;
    });
  } catch (err) {
    throw toDataError(err);
  }
}
