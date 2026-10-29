// Turnier-Baukasten (docs/turnier-baukasten.md): Gruppeneinteilung, Lose und Änderungen an mehreren
// Spielen auf einmal (Spielplan speichern, tauschen, verschieben, Endrunde füllen, kampflos).
// Was erlaubt ist, prüft src/ui/data/stages.ts vorher auf den geladenen Daten; hier wird atomar
// geschrieben, mit erwarteter `revision` je Spiel und einem Audit-Eintrag für alle Spiele.
import {
  deleteField,
  doc,
  runTransaction,
  serverTimestamp,
  type Firestore,
  type UpdateData,
} from 'firebase/firestore';
import type { Match } from '../domain';
import { clean, newTransactionId, undoField, writeAudit, type Actor, type AuditInput, type UndoRef } from './audit';
import { DataError, notFound, toDataError } from './errors';
import type { LotDoc, MatchDoc, StageDoc, TeamIdList } from './model';
import { paths } from './paths';
import { isPublishedMatchStatus, resultsArePublic, toPublicMatch, toPublicResult, toPublicStage } from './projections';

/** Felder, die eine Baukasten-Änderung an einem Spiel setzen darf (Tore laufen über matches.ts). */
const LAYOUT_KEYS = [
  'teamAId',
  'teamBId',
  'slotA',
  'slotB',
  'fieldId',
  'startISO',
  'waveIndex',
  'durationMinutes',
  'manual',
  'status',
  'notPlayedReason',
  'decidedBy',
  'walkoverWinner',
  'stageId',
  'groupIndex',
  'matchKey',
  'penaltyOnly',
] as const satisfies readonly (keyof Match)[];

type LayoutKey = (typeof LAYOUT_KEYS)[number];

/** Gewünschter Stand eines Spiels; ohne `expectedRevision` wird es neu angelegt. */
export interface MatchLayoutWrite {
  id: string;
  /** Fehlt bei neuen Spielen. */
  expectedRevision?: number;
  match: Match;
}

export interface MatchChanges {
  writes: MatchLayoutWrite[];
  /** Noch nicht angepfiffene Spiele, die wegfallen (z. B. neuer Spielplan). */
  deletes?: Array<{ id: string; expectedRevision: number }>;
}

/** Neue Spiel-ID (Firestore vergibt sie lokal). */
export function newMatchId(db: Firestore, tid: string): string {
  return doc(paths.matches(db, tid)).id;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function newMatchDoc(m: Match): Record<string, unknown> {
  const picked: Record<string, unknown> = { roundId: m.roundId, roundNumber: m.roundNumber };
  for (const k of LAYOUT_KEYS) picked[k] = m[k];
  return clean({ ...picked, revision: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
}

/**
 * Mehrere Spiele in einer Transaktion anlegen, ändern oder löschen. Jede Änderung braucht die erwartete
 * Revision; ein inzwischen angepfiffenes Spiel bricht alles ab. Öffentliche Spiele werden mitgezogen.
 */
export async function commitMatchChanges(
  db: Firestore,
  actor: Actor,
  tid: string,
  changes: MatchChanges,
  audit: Omit<AuditInput, 'targetType' | 'targetId'> & UndoRef,
): Promise<void> {
  const updates = changes.writes.filter((w) => w.expectedRevision !== undefined);
  const creates = changes.writes.filter((w) => w.expectedRevision === undefined);
  const deletes = changes.deletes ?? [];
  try {
    await runTransaction(db, async (tx) => {
      const tRef = paths.tournament(db, tid);
      const [tSnap, ...snaps] = await Promise.all([
        tx.get(tRef),
        ...[...updates, ...deletes].map((w) => tx.get(paths.match(db, tid, w.id))),
      ]);
      if (!tSnap.exists()) throw notFound('Das Turnier');
      const visibility = tSnap.data().visibility;
      const current = new Map(snaps.map((s) => [s.id, s.data()]));
      for (const w of [...updates, ...deletes]) {
        const m = current.get(w.id);
        if (!m) throw notFound('Ein Spiel');
        if (m.revision !== w.expectedRevision) {
          throw new DataError('invalid_state', 'Ein Spiel wurde inzwischen geändert. Bitte schau es dir noch einmal an.');
        }
      }
      for (const d of deletes) {
        const st = current.get(d.id)!.status;
        if (st !== 'scheduled' && st !== 'draft') {
          throw new DataError('invalid_state', 'Ein Spiel ist inzwischen angepfiffen und bleibt im Spielplan.');
        }
      }

      const auditRef = writeAudit(
        db,
        tx,
        tid,
        actor,
        {
          action: audit.action,
          targetType: 'tournament',
          targetId: tid,
          before: audit.before,
          after: audit.after === undefined && !audit.undoOf ? undefined : { ...(audit.after as object), ...undoField(audit) },
        },
        newTransactionId(),
      );

      const mirror = (id: string, m: MatchDoc) => {
        if (!isPublishedMatchStatus(m.status)) return;
        tx.set(paths.publicMatch(db, tid, id), { ...clean(toPublicMatch(id, m)), updatedAt: serverTimestamp() } as never);
      };

      for (const w of creates) {
        const data = newMatchDoc(w.match);
        tx.set(paths.match(db, tid, w.id), data as never);
        mirror(w.id, { ...(data as unknown as MatchDoc), revision: 0 });
      }

      for (const w of updates) {
        const m = current.get(w.id)!;
        const update: Record<string, unknown> = {};
        for (const k of LAYOUT_KEYS) {
          const next = w.match[k as LayoutKey];
          if (same(m[k as keyof MatchDoc], next)) continue;
          update[k] = next === undefined || next === null ? deleteField() : clean(next);
        }
        if (Object.keys(update).length === 0) continue;
        const revision = m.revision + 1;
        tx.update(paths.match(db, tid, w.id), {
          ...update,
          revision,
          updatedAt: serverTimestamp(),
          updatedBy: actor.uid,
          lastAuditId: auditRef.id,
        } as UpdateData<MatchDoc>);
        const next = clean({ ...m, ...Object.fromEntries(LAYOUT_KEYS.map((k) => [k, w.match[k]])), revision }) as MatchDoc;
        mirror(w.id, next);
        if (next.status !== m.status && resultsArePublic(visibility) && isPublishedMatchStatus(next.status)) {
          tx.set(paths.publicResult(db, tid, w.id), { ...toPublicResult(w.id, next), updatedAt: serverTimestamp() } as never);
        }
      }

      for (const d of deletes) {
        tx.delete(paths.match(db, tid, d.id));
        tx.delete(paths.publicMatch(db, tid, d.id));
        if (resultsArePublic(visibility)) tx.delete(paths.publicResult(db, tid, d.id));
      }
    });
  } catch (err) {
    throw toDataError(err);
  }
}

/** Unterschied zwischen zwei Spiellisten als Änderungen (für commitMatchChanges). */
export function diffMatches(before: Match[], after: Match[]): MatchChanges {
  const old = new Map(before.map((m) => [m.id, m]));
  const keep = new Set(after.map((m) => m.id));
  const writes: MatchLayoutWrite[] = [];
  for (const m of after) {
    const prev = old.get(m.id);
    if (!prev) {
      writes.push({ id: m.id, match: m });
      continue;
    }
    if (LAYOUT_KEYS.some((k) => !same(prev[k], m[k]))) writes.push({ id: m.id, expectedRevision: prev.revision, match: m });
  }
  const deletes = before.filter((m) => !keep.has(m.id)).map((m) => ({ id: m.id, expectedRevision: m.revision }));
  return { writes, deletes };
}

// ---------- Gruppeneinteilung und Lose ----------

export interface StageDrawInput {
  stageId: string;
  groups: string[][];
  mode: NonNullable<StageDoc['mode']>;
  pots?: string[][];
  seed?: number;
}

const lists = (v: string[][]): TeamIdList[] => v.map((teamIds) => ({ teamIds: [...teamIds] }));

/** Firestore-Form -> Listen von Team-IDs. */
export function teamIdLists(v: TeamIdList[] | null | undefined): string[][] {
  return (v ?? []).map((g) => [...g.teamIds]);
}

/** Änderung am Abschnitts-Dokument (privat + öffentlich) mit Audit, atomar. */
async function writeStage(
  db: Firestore,
  actor: Actor,
  tid: string,
  stageId: string,
  change: (current: StageDoc | undefined) => { patch: Partial<StageDoc>; audit: AuditInput },
): Promise<void> {
  try {
    await runTransaction(db, async (tx) => {
      const tRef = paths.tournament(db, tid);
      const sRef = paths.stage(db, tid, stageId);
      const [tSnap, sSnap] = await Promise.all([tx.get(tRef), tx.get(sRef)]);
      if (!tSnap.exists()) throw notFound('Das Turnier');
      const current = sSnap.exists() ? sSnap.data() : undefined;
      const { patch, audit } = change(current);
      const next = clean({ ...(current ?? {}), ...patch, stageId }) as Omit<StageDoc, 'updatedAt'>;
      tx.set(sRef, { ...next, updatedAt: serverTimestamp() } as never);
      tx.set(paths.publicStage(db, tid, stageId), {
        ...clean(toPublicStage(next, tSnap.data().visibility)),
        updatedAt: serverTimestamp(),
      } as never);
      writeAudit(db, tx, tid, actor, audit);
    });
  } catch (err) {
    throw toDataError(err);
  }
}

/** Gruppeneinteilung speichern (geprüft vorher in src/ui/data/stages.ts). */
export function saveStageDraw(db: Firestore, actor: Actor, tid: string, draw: StageDrawInput, undo: UndoRef = {}): Promise<void> {
  return writeStage(db, actor, tid, draw.stageId, (current) => ({
    patch: {
      groups: lists(draw.groups),
      mode: draw.mode,
      pots: draw.pots ? lists(draw.pots) : null,
      seed: draw.seed ?? null,
    },
    audit: {
      action: 'groups.draw',
      targetType: 'stage',
      targetId: draw.stageId,
      // Listen in Listen gehen auch im Audit nicht, deshalb wie im Dokument als `{ teamIds }`.
      before: current?.groups ? { groups: current.groups, mode: current.mode ?? 'manual', ...(current.pots ? { pots: current.pots } : {}) } : null,
      after: { groups: lists(draw.groups), mode: draw.mode, ...undoField(undo) },
    },
  }));
}

export interface LotInput {
  stageId: string;
  groupIndex?: number;
  place?: number;
  order: string[];
}

const lotKey = (l: { groupIndex?: number | null; place?: number | null; order: string[] }) =>
  `${l.groupIndex ?? ''}|${l.place ?? ''}|${[...l.order].sort().join(',')}`;

/** Gezogenes Los speichern; ein Los für dieselben Teams an derselben Stelle wird ersetzt. */
export function saveStageLot(db: Firestore, actor: Actor, tid: string, lot: LotInput): Promise<void> {
  if (lot.order.length < 2) throw new DataError('invalid_input', 'Ein Los braucht mindestens zwei Teams.');
  const saved: LotDoc = clean({
    id: globalThis.crypto.randomUUID(),
    groupIndex: lot.groupIndex ?? null,
    place: lot.place ?? null,
    order: [...lot.order],
    atISO: new Date().toISOString(),
  });
  return writeStage(db, actor, tid, lot.stageId, (current) => ({
    patch: { lots: [...(current?.lots ?? []).filter((l) => lotKey(l) !== lotKey(saved)), saved] },
    audit: {
      action: 'lot.draw',
      targetType: 'stage',
      targetId: lot.stageId,
      after: { order: saved.order, groupIndex: lot.groupIndex ?? null },
    },
  }));
}
