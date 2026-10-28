// Änderungsverlauf (§2.2 Änderungsprotokoll): wer hat wann was geändert. Wird beim Öffnen und auf
// Knopfdruck geladen, nicht bei jeder Änderung (spart Lesezugriffe im kostenlosen Firebase-Kontingent).
// Einzelne Schritte lassen sich zurücknehmen (Regeln in data/undo.ts); vorher erklärt ein Fenster die Folgen.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthUser, useService } from '../../data/context';
import { describeHistory, type HistoryLine } from '../../data/history';
import type { HistoryEntry } from '../../data/types';
import { undoChecks, type UndoCheck } from '../../data/undo';
import { Dialog, EmptyState, Notice, Seg } from '../../components/ui';
import type { AdminCtx } from './AdminTournament';

type Filter = 'all' | 'results';

export function HistoryTab({ ctx }: { ctx: AdminCtx }) {
  const service = useService();
  const user = useAuthUser();
  const tid = ctx.data.tournament.id;
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [undoing, setUndoing] = useState<{ line: HistoryLine; entry: HistoryEntry; check: Extract<UndoCheck, { ok: true }> } | null>(null);

  const fetchEntries = useCallback(
    () =>
      service.loadHistory(tid).then(
        (list) => {
          setEntries(list);
          setError(null);
        },
        (err: unknown) => setError(err instanceof Error ? err.message : 'Der Verlauf konnte nicht geladen werden.'),
      ),
    [service, tid],
  );

  useEffect(() => {
    void fetchEntries();
  }, [fetchEntries]);

  const lines = useMemo(() => (entries ? describeHistory(entries, ctx.data, user?.uid) : []), [entries, ctx.data, user?.uid]);
  const checks = useMemo(() => (entries ? undoChecks(entries, ctx.data) : new Map<string, UndoCheck>()), [entries, ctx.data]);
  const shown = filter === 'results' ? lines.filter((l) => l.isResult) : lines;
  const tz = ctx.data.tournament.timeZone;
  const fmt = new Intl.DateTimeFormat('de-DE', { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="section">
      <div className="row">
        <Seg<Filter>
          label="Anzeigen"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Alles' },
            { value: 'results', label: 'Nur Spiele' },
          ]}
        />
        <button type="button" className="btn" onClick={() => void fetchEntries()}>
          Aktualisieren
        </button>
      </div>
      {error && <span className="field-error">{error}</span>}
      {entries === null && !error ? (
        <span className="muted">Lädt …</span>
      ) : shown.length === 0 ? (
        <EmptyState text="Noch keine Änderungen." />
      ) : (
        <div className="list">
          {shown.map((l) => {
            const check = l.undone ? undefined : checks.get(l.id);
            const entry = entries?.find((e) => e.id === l.id);
            return (
              <div key={l.id} className="list-row">
                <span className="small-text" style={{ minWidth: 92, alignSelf: 'start', fontVariantNumeric: 'tabular-nums' }}>
                  {l.atISO ? fmt.format(new Date(l.atISO)) : 'gerade eben'}
                </span>
                <span className="grow stack tight">
                  <span className={l.undone ? 'muted' : undefined}>{l.text}</span>
                  {l.undone && <span className="small-text">Rückgängig gemacht</span>}
                  {check && !check.ok && <span className="small-text">{check.reason}</span>}
                  {check?.ok && entry && (
                    <span>
                      <button type="button" className="btn compact" onClick={() => setUndoing({ line: l, entry, check })}>
                        {l.isUndo ? 'Wiederherstellen' : 'Rückgängig'}
                      </button>
                    </span>
                  )}
                </span>
                <span className="pill" style={{ alignSelf: 'start' }}>
                  {l.who}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <p className="small-text">
        Hier steht jede Änderung, auch die von Helfern. Einträge lassen sich nicht löschen. Mit „Rückgängig“ nimmst du einen
        Schritt zurück; das steht dann ebenfalls hier.
      </p>
      {undoing && (
        <UndoDialog
          tid={tid}
          {...undoing}
          onClose={() => setUndoing(null)}
          onDone={() => {
            setUndoing(null);
            void fetchEntries();
          }}
        />
      )}
    </div>
  );
}

function UndoDialog({
  tid,
  line,
  entry,
  check,
  onClose,
  onDone,
}: {
  tid: string;
  line: HistoryLine;
  entry: HistoryEntry;
  check: Extract<UndoCheck, { ok: true }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const service = useService();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title={line.isUndo ? 'Wiederherstellen?' : 'Rückgängig machen?'} onClose={onClose}>
      <p style={{ margin: 0 }}>
        <b>{line.text}</b>
      </p>
      <p style={{ margin: 0 }}>{check.explain}</p>
      {check.warning && <Notice title="Gut zu wissen" tone="hint">{check.warning}</Notice>}
      {error && <span className="field-error">{error}</span>}
      <div className="row">
        <button
          type="button"
          className="btn pri"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await service.undoHistory(tid, entry);
              onDone();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Das hat nicht geklappt. Bitte versuche es noch einmal.');
              setBusy(false);
            }
          }}
        >
          {busy ? 'Einen Moment …' : line.isUndo ? 'Wiederherstellen' : 'Rückgängig machen'}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Abbrechen
        </button>
      </div>
    </Dialog>
  );
}
