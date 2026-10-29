// „Einteilung vorschlagen“: Die Seite verteilt offene Spiele auf die eingetragenen Schiris, für die nächsten
// Spiele, einen Abschnitt oder das ganze Turnier. Erst „Übernehmen“ speichert; der Spielplan bleibt, wie er ist.
import { useMemo, useState } from 'react';
import type { Match } from '../../../domain';
import { planReferees } from '../../../domain/referees';
import { useService } from '../../data/context';
import { formatTime } from '../../format';
import { Dialog, Field, Notice } from '../../components/ui';
import type { AdminCtx } from '../admin/AdminTournament';
import { stageCardProps } from '../admin/stages/cardProps';

type Scope = string; // 'next' | 'all' | `stage:<id>` | `round:<n>`

export function PlanDialog({
  ctx,
  matches,
  assigned,
  onClose,
}: {
  ctx: AdminCtx;
  matches: Match[];
  assigned: ReadonlyMap<string, string>;
  onClose: () => void;
}) {
  const service = useService();
  const data = ctx.data;
  const t = data.tournament;
  const refs = useMemo(() => data.referees ?? [], [data.referees]);
  // Nur Spiele, die noch nicht angepfiffen sind und eine Uhrzeit haben.
  const open = useMemo(
    () => matches.filter((m) => m.status === 'scheduled' && m.startISO).sort((a, b) => a.startISO!.localeCompare(b.startISO!)),
    [matches],
  );
  const scopes = useMemo(() => {
    const out: Array<{ value: Scope; label: string }> = [{ value: 'next', label: 'Die nächsten Spiele' }];
    if (t.format) {
      for (const s of t.format.stages) if (open.some((m) => m.stageId === s.id)) out.push({ value: `stage:${s.id}`, label: s.name });
    } else {
      for (const n of [...new Set(open.map((m) => m.roundNumber))].sort((a, b) => a - b)) out.push({ value: `round:${n}`, label: `Runde ${n}` });
    }
    out.push({ value: 'all', label: 'Alle offenen Spiele' });
    return out;
  }, [open, t.format]);

  const [scope, setScope] = useState<Scope>('next');
  const [count, setCount] = useState(Math.min(open.length, Math.max(refs.length * 2, 6)));
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inScope = useMemo(() => {
    if (scope === 'next') return open.slice(0, Math.max(0, count));
    if (scope === 'all') return open;
    if (scope.startsWith('stage:')) return open.filter((m) => m.stageId === scope.slice(6));
    if (scope.startsWith('round:')) return open.filter((m) => m.roundNumber === Number(scope.slice(6)));
    return [];
  }, [scope, count, open]);

  const plan = useMemo(
    () =>
      planReferees({
        matches,
        refereeIds: refs.map((r) => r.id),
        existing: assigned,
        scope: inScope.map((m) => m.id),
        keepExisting: keep,
      }),
    [matches, refs, assigned, inScope, keep],
  );
  const proposed = new Map(plan.assignments.map((a) => [a.matchId, a.refereeId]));
  const refName = (id?: string) => refs.find((r) => r.id === id)?.name ?? 'Unbekannt';
  // Was sich ändert: neue Einteilung, und ohne „behalten“ auch Spiele, die jetzt frei werden.
  const changes = inScope
    .map((m) => ({ matchId: m.id, refereeId: proposed.get(m.id) ?? (keep ? assigned.get(m.id) : undefined) ?? null }))
    .filter((c) => (assigned.get(c.matchId) ?? null) !== c.refereeId);
  const newCounts = refs.map((r) => ({ name: r.name, n: inScope.filter((m) => (proposed.get(m.id) ?? (keep ? assigned.get(m.id) : undefined)) === r.id).length }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await service.assignReferees(t.id, changes);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
      setBusy(false);
    }
  };

  return (
    <Dialog title="Einteilung vorschlagen" onClose={onClose}>
      <span className="muted">
        Die Seite verteilt die Spiele gleichmäßig auf {refs.length === 1 ? 'den eingetragenen Schiri' : `die ${refs.length} eingetragenen Schiris`}. Niemand
        pfeift zwei Spiele gleichzeitig, und wer gerade gepfiffen hat, bekommt wenn möglich eine Pause. Am Spielplan ändert sich nichts.
      </span>
      <div className="form-grid">
        <Field label="Für welche Spiele?">
          {(id) => (
            <select id={id} className="select" value={scope} onChange={(e) => setScope(e.target.value)}>
              {scopes.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        {scope === 'next' && (
          <Field label="Wie viele Spiele?">
            {(id) => (
              <input
                id={id}
                className="input"
                inputMode="numeric"
                value={String(count)}
                onChange={(e) => setCount(Math.min(open.length, Number(e.target.value.replace(/\D/g, '') || 0)))}
              />
            )}
          </Field>
        )}
      </div>
      <label className="check">
        <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
        <span>Spiele, die schon einen Schiri haben, so lassen</span>
      </label>

      {inScope.length === 0 ? (
        <Notice tone="hint" title="Hier gibt es keine offenen Spiele." />
      ) : (
        <>
          <div className="ref-counts">
            {newCounts.map((c) => (
              <span key={c.name} className="pill">
                {c.name}: {c.n} {c.n === 1 ? 'Spiel' : 'Spiele'}
              </span>
            ))}
          </div>
          {plan.unassigned.length > 0 && (
            <Notice tone="warn" title={`${plan.unassigned.length} ${plan.unassigned.length === 1 ? 'Spiel bleibt' : 'Spiele bleiben'} ohne Schiri.`}>
              Zu dieser Zeit laufen mehr Spiele, als Schiris frei sind.
            </Notice>
          )}
          <div className="ref-plan-list">
            {inScope.map((m) => {
              const extra = stageCardProps(data, m, ctx.teamName);
              const who = proposed.get(m.id) ?? (keep ? assigned.get(m.id) : undefined);
              return (
                <div key={m.id} className="ref-plan-row">
                  <span className="muted">
                    {formatTime(m.startISO, t.timeZone)} · {ctx.fieldName(m.fieldId)}
                  </span>
                  <span className="ref-plan-teams">
                    {extra?.nameA ?? ctx.teamName(m.teamAId)} – {extra?.nameB ?? ctx.teamName(m.teamBId)}
                  </span>
                  <b className={who ? undefined : 'muted'}>{who ? refName(who) : 'frei'}</b>
                </div>
              );
            })}
          </div>
        </>
      )}
      {error && <span className="field-error">{error}</span>}
      <div className="row">
        <button type="button" className="btn pri" disabled={busy || changes.length === 0} onClick={save}>
          {busy ? 'Speichert …' : changes.length === 0 ? 'Nichts zu ändern' : 'Einteilung übernehmen'}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Abbrechen
        </button>
      </div>
    </Dialog>
  );
}
