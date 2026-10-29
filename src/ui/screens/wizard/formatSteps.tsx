// Schritte „Felder und Zeiten“ und „Vorschau“ für Turniere aus dem Baukasten.
// Das Schweizer System nutzt weiter StepOperation, StepPublish und StepReview aus steps.tsx.
import type { Visibility } from '../../../domain';
import { groupLetter } from '../../../domain/groups';
import type { WizardDraft } from '../../data/types';
import { formatDateShort, formatTime, visibilityHelp, visibilityLabel } from '../../format';
import { publicUrl } from '../../router';
import { Field, Notice, QrCode, Seg } from '../../components/ui';
import { TIE_BREAK_ORDER } from '../../../domain/format';
import { GROUP_TIE_BREAKER_LABELS } from '../../../domain/groups';
import type { BuilderState } from './builder';
import { activeTeams, type WizardPreview } from './preview';
import { Kpis, Timeline } from './Sketch';
import { FieldsEditor } from './steps';
import type { StepErrors } from './validate';

interface Props {
  draft: WizardDraft;
  update: (patch: Partial<WizardDraft>) => void;
  errors: StepErrors;
  builder: BuilderState;
  setBuilder: (b: BuilderState) => void;
  preview: WizardPreview;
}

function Minutes({
  label,
  value,
  onChange,
  error,
  min = 1,
}: {
  label: string;
  value: number | null;
  onChange: (n: number) => void;
  error?: string;
  min?: number;
}) {
  return (
    <Field label={label} error={error}>
      {(id, d) => (
        <input
          id={id}
          className="input num"
          type="number"
          inputMode="numeric"
          min={min}
          value={value !== null && Number.isFinite(value) ? value : ''}
          aria-describedby={d}
          aria-invalid={!!error || undefined}
          onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
        />
      )}
    </Field>
  );
}

/* Felder und Zeiten */
export function StepTimesFormat({ draft, update, errors, builder: b, setBuilder, preview }: Props) {
  const hasFinals = b.finalsMode !== 'none';
  const separate = b.finalsMinutes !== null || b.finalMinutes !== null;
  const hasFinal = b.finals.some((r) => r.form !== 'final_group');
  return (
    <>
      <FieldsEditor draft={draft} update={update} errors={errors} />
      <div className="form-grid">
        <Field label="Turnierstart" error={errors.startTime}>
          {(id, d) => (
            <input id={id} className="input" type="time" value={draft.startTime} aria-describedby={d} onChange={(e) => update({ startTime: e.target.value })} />
          )}
        </Field>
        <Minutes label="Spieldauer in Minuten" value={draft.matchMinutes} error={errors.matchMinutes} onChange={(n) => update({ matchMinutes: n })} />
        <Minutes
          label="Wechselpause in Minuten"
          min={0}
          value={draft.turnoverMinutes}
          error={errors.turnoverMinutes}
          onChange={(n) => update({ turnoverMinutes: n })}
        />
        {b.intermediate && (
          <Minutes label="Pause vor der Zwischenrunde" min={0} value={draft.roundBreakMinutes} onChange={(n) => update({ roundBreakMinutes: n })} />
        )}
        {hasFinals && (
          <Minutes
            label="Pause vor der Endrunde"
            min={0}
            value={b.breakBeforeFinalsMinutes}
            error={errors.breakBeforeFinals}
            onChange={(n) => setBuilder({ ...b, breakBeforeFinalsMinutes: n })}
          />
        )}
      </div>
      {hasFinals && (
        <div className="stack tight">
          <label className="check">
            <input
              type="checkbox"
              checked={separate}
              onChange={(e) =>
                setBuilder({
                  ...b,
                  finalsMinutes: e.target.checked ? draft.matchMinutes : null,
                  finalMinutes: e.target.checked && hasFinal ? draft.matchMinutes : null,
                })
              }
            />
            <span>Endrunde und Finale anders lang als die Vorrunde</span>
          </label>
          {separate && (
            <div className="form-grid">
              <Minutes
                label="Spieldauer Endrunde"
                value={b.finalsMinutes}
                error={errors.finalsMinutes}
                onChange={(n) => setBuilder({ ...b, finalsMinutes: n })}
              />
              {hasFinal && (
                <Minutes label="Spieldauer Finale" value={b.finalMinutes} error={errors.finalMinutes} onChange={(n) => setBuilder({ ...b, finalMinutes: n })} />
              )}
            </div>
          )}
        </div>
      )}
      <label className="check">
        <input type="checkbox" checked={draft.restOptimization} onChange={(e) => update({ restOptimization: e.target.checked })} />
        <span>Pausen für alle Teams möglichst gleich lang halten</span>
      </label>
      <Kpis preview={preview} timeZone={draft.timeZone} />
      <div className="card stack" style={{ background: 'var(--bg)' }}>
        <h3 className="card-title">Ablauf mit Uhrzeiten</h3>
        <Timeline preview={preview} builder={b} timeZone={draft.timeZone} fieldNames={draft.fields.map((f) => f.name)} />
      </div>
      {preview.warnings.length > 0 && (
        <Notice tone="hint" title="Gut zu wissen">
          {preview.warnings.join(' ')}
        </Notice>
      )}
      {preview.lastEndISO && Date.parse(preview.lastEndISO) - Date.parse(preview.firstStartISO ?? preview.lastEndISO) > 10 * 3600_000 && (
        <Notice tone="hint" title="Langes Turnier">
          Mit diesen Einstellungen dauert das Turnier über zehn Stunden. Mehr Felder oder kürzere Spiele helfen.
        </Notice>
      )}
    </>
  );
}

/* Vorschau mit Veröffentlichen */
export function StepPreviewFormat({ draft, update, builder: b, preview, groups }: Props & { groups: string[][] | null }) {
  const url = publicUrl(draft.id);
  const teams = activeTeams(draft);
  const name = new Map(teams.map((t) => [t.id, t.name.trim()]));
  const stages = preview.format?.stages ?? [];
  return (
    <>
      <dl className="summary">
        <dt>Turnier</dt>
        <dd>{draft.title || '–'}</dd>
        <dt>Veranstalter</dt>
        <dd>{draft.organizerName || '–'}</dd>
        <dt>Datum</dt>
        <dd>
          {formatDateShort(draft.localDate)}, {draft.startTime} Uhr
        </dd>
        <dt>Mannschaften</dt>
        <dd>{teams.length}</dd>
        <dt>Ablauf</dt>
        <dd>{stages.map((s) => s.name).join(' → ') || '–'}</dd>
        <dt>Punktgleichheit</dt>
        <dd>{TIE_BREAK_ORDER[b.tieBreakVariant].map((x) => GROUP_TIE_BREAKER_LABELS[x]).join(', ')}, Los</dd>
        <dt>Felder</dt>
        <dd>{draft.fields.map((f) => f.name).join(', ')}</dd>
        <dt>Ende</dt>
        <dd>{preview.lastEndISO ? `ca. ${formatTime(preview.lastEndISO, draft.timeZone)} Uhr` : '–'}</dd>
      </dl>
      {groups && groups.length > 1 && (
        <div className="stack tight">
          <h3 className="card-title">Gruppen</h3>
          <ul className="list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {groups.map((g, i) => (
              <li key={i} className="list-row">
                <b style={{ minWidth: 80 }}>Gruppe {groupLetter(i)}</b>
                <span className="grow">{g.map((id) => name.get(id)).join(', ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="card stack" style={{ background: 'var(--bg)' }}>
        <h3 className="card-title">So läuft das Turnier</h3>
        <Timeline preview={preview} builder={b} timeZone={draft.timeZone} fieldNames={draft.fields.map((f) => f.name)} />
      </div>
      <div className="field">
        <span className="label">Was sehen Zuschauer?</span>
        <Seg<Visibility>
          label="Sichtbarkeit"
          value={draft.visibility}
          onChange={(v) => update({ visibility: v })}
          options={(['full', 'no_standings', 'kids'] as const).map((v) => ({
            value: v,
            label: visibilityLabel[v],
          }))}
        />
        <span className="muted" style={{ marginTop: 6 }}>
          {visibilityHelp[draft.visibility]}
        </span>
      </div>
      <div className="grid two">
        <Notice tone="info" title="Erst nach dem Veröffentlichen sichtbar">
          Zuschauer und gegnerische Trainer sehen Gruppen und Spielplan erst, wenn du auf „Turnier veröffentlichen“ drückst. Als Entwurf gespeichert, bleibt
          alles nur für dich sichtbar.
        </Notice>
        <div className="card stack" style={{ background: 'var(--bg)' }}>
          <h3 className="card-title">Link und QR-Code</h3>
          <QrCode text={url} />
          <code className="small-text" style={{ overflowWrap: 'anywhere' }}>
            {url}
          </code>
        </div>
      </div>
      {preview.check.errors.length > 0 && (
        <Notice tone="warn" title="So geht es noch nicht">
          {preview.check.errors.join(' ')}
        </Notice>
      )}
    </>
  );
}
