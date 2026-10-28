// Stammdaten und Mannschaften nachträglich ändern (§2.1: anlegen, bearbeiten; Logos hinzufügen/ändern).
import { useState } from 'react';
import { useService } from '../../data/context';
import { canChangeDate, detailsOf, validateDetails } from '../../data/details';
import { uid } from '../../data/mockStore';
import type { TournamentData, TournamentDetails } from '../../data/types';
import { Icon } from '../../components/Icon';
import { ImagePicker } from '../../components/ImagePicker';
import { Dialog, Field } from '../../components/ui';

export function EditDetailsDialog({ data, onClose }: { data: TournamentData; onClose: () => void }) {
  const service = useService();
  const [draft, setDraft] = useState<TournamentDetails>(() => detailsOf(data));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const update = (patch: Partial<TournamentDetails>) => setDraft((d) => ({ ...d, ...patch }));
  const setSponsor = (i: number, patch: Partial<TournamentDetails['sponsors'][number]>) =>
    update({ sponsors: draft.sponsors.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const dateLocked = !canChangeDate(data);

  const save = async () => {
    const e = validateDetails(data, draft);
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setBusy(true);
    setFailed(null);
    try {
      await service.updateDetails(data.tournament.id, draft);
      onClose();
    } catch (err) {
      setFailed(err instanceof Error ? err.message : 'Speichern hat nicht geklappt.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Turnierdaten ändern" onClose={onClose}>
      <div className="form-grid">
        <Field label="Turniername" error={errors.title}>
          {(id, d) => (
            <input id={id} className="input" value={draft.title} aria-invalid={!!errors.title || undefined} aria-describedby={d} onChange={(e) => update({ title: e.target.value })} />
          )}
        </Field>
        <Field label="Veranstalter" error={errors.organizerName}>
          {(id, d) => (
            <input id={id} className="input" value={draft.organizerName} aria-invalid={!!errors.organizerName || undefined} aria-describedby={d} onChange={(e) => update({ organizerName: e.target.value })} />
          )}
        </Field>
        <Field label="Veranstaltungsort">
          {(id) => <input id={id} className="input" value={draft.venue} onChange={(e) => update({ venue: e.target.value })} placeholder="Sportplatz, Halle" />}
        </Field>
        <Field label="Datum" error={errors.localDate}>
          {(id, d) => (
            <>
              <input id={id} className="input" type="date" value={draft.localDate} disabled={dateLocked} aria-describedby={d} onChange={(e) => update({ localDate: e.target.value })} />
              {dateLocked && <span className="small-text">Steht fest, weil schon Runden ausgelost sind.</span>}
            </>
          )}
        </Field>
      </div>
      <div className="form-grid">
        <ImagePicker label="Vereinswappen" name={draft.organizerName} value={draft.organizerLogo} onChange={(v) => update({ organizerLogo: v })} />
        <ImagePicker label="Turnierlogo" name={draft.title} value={draft.eventLogo} onChange={(v) => update({ eventLogo: v })} />
      </div>
      <div className="section">
        <div className="section-head">
          <h3 className="card-title">Sponsoren</h3>
          <button type="button" className="btn" onClick={() => update({ sponsors: [...draft.sponsors, { id: uid('neu'), name: '', url: '' }] })}>
            <Icon name="plus" />
            Sponsor hinzufügen
          </button>
        </div>
        {draft.sponsors.length === 0 && <span className="muted">Keine Sponsoren.</span>}
        {draft.sponsors.map((s, i) => (
          <div key={s.id} className="form-grid" style={{ alignItems: 'end' }}>
            <Field label={`Sponsor ${i + 1}`} error={errors[`sponsor-${i}`]}>
              {(id, d) => <input id={id} className="input" value={s.name} aria-describedby={d} onChange={(e) => setSponsor(i, { name: e.target.value })} placeholder="Name" />}
            </Field>
            <Field label="Link">
              {(id) => <input id={id} className="input" type="url" inputMode="url" value={s.url} onChange={(e) => setSponsor(i, { url: e.target.value })} placeholder="https://" />}
            </Field>
            <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'end' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <ImagePicker label="Logo" name={s.name} value={s.logo} onChange={(v) => setSponsor(i, { logo: v })} />
              </div>
              <button type="button" className="btn sq" aria-label={`Sponsor ${i + 1} entfernen`} onClick={() => update({ sponsors: draft.sponsors.filter((_, j) => j !== i) })}>
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
      {failed && <span className="field-error">{failed}</span>}
      <div className="row">
        <button type="button" className="btn pri" disabled={busy} onClick={save}>
          {busy ? 'Speichert …' : 'Speichern'}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Abbrechen
        </button>
      </div>
      {data.tournament.status !== 'draft' && <span className="small-text">Zuschauer sehen die Änderung sofort auf der öffentlichen Seite.</span>}
    </Dialog>
  );
}

/** Mannschaft umbenennen, Logo ändern oder (ohne team) nachmelden. */
export function TeamDialog({
  data,
  team,
  onClose,
}: {
  data: TournamentData;
  team: { id: string; name: string; logo?: string } | null;
  onClose: () => void;
}) {
  const service = useService();
  const [name, setName] = useState(team?.name ?? '');
  const [logo, setLogo] = useState<string | undefined>(team?.logo);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = data.rounds.length > 0;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await service.saveTeam(data.tournament.id, team?.id ?? null, { name, logo });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern hat nicht geklappt.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={team ? `${team.name} ändern` : 'Mannschaft nachmelden'} onClose={onClose}>
      <Field label="Name" error={error ?? undefined}>
        {(id, d) => (
          <input
            id={id}
            className="input"
            value={name}
            aria-invalid={!!error || undefined}
            aria-describedby={d}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
            }}
          />
        )}
      </Field>
      <ImagePicker label="Logo" name={name} value={logo} onChange={setLogo} />
      {!team && started && (
        <span className="muted">
          Die Mannschaft spielt ab der nächsten Runde mit, die du auslost. In der Tabelle zählt wie immer der Schnitt pro Spiel, verpasste Runden sind also kein Nachteil.
        </span>
      )}
      <div className="row">
        <button type="button" className="btn pri" disabled={busy} onClick={save}>
          {busy ? 'Speichert …' : team ? 'Speichern' : 'Nachmelden'}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Abbrechen
        </button>
      </div>
    </Dialog>
  );
}
