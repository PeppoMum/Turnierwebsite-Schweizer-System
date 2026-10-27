// Änderungsverlauf (§2.2 Änderungsprotokoll): wer hat wann was geändert. Wird beim Öffnen und auf
// Knopfdruck geladen, nicht bei jeder Änderung (spart Lesezugriffe im kostenlosen Firebase-Kontingent).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthUser, useService } from '../../data/context';
import { describeHistory } from '../../data/history';
import type { HistoryEntry } from '../../data/types';
import { EmptyState, Seg } from '../../components/ui';
import type { AdminCtx } from './AdminTournament';

type Filter = 'all' | 'results';

export function HistoryTab({ ctx }: { ctx: AdminCtx }) {
  const service = useService();
  const user = useAuthUser();
  const tid = ctx.data.tournament.id;
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

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
          {shown.map((l) => (
            <div key={l.id} className="list-row">
              <span className="small-text" style={{ minWidth: 92, fontVariantNumeric: 'tabular-nums' }}>
                {l.atISO ? fmt.format(new Date(l.atISO)) : 'gerade eben'}
              </span>
              <span className="grow">{l.text}</span>
              <span className="pill">{l.who}</span>
            </div>
          ))}
        </div>
      )}
      <p className="small-text">Hier steht jede Änderung, auch die von Helfern. Einträge lassen sich nicht löschen.</p>
    </div>
  );
}
