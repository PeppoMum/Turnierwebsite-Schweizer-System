import { useMemo, useState } from 'react';
import type { PairingMode, Visibility } from '../../../domain';
import { uid } from '../../data/mockStore';
import { previewNextRound, roundMinutes, wavesPerRound } from '../../data/logic';
import type { TournamentData, WizardDraft } from '../../data/types';
import { formatDateShort, formatMinutes, visibilityHelp, visibilityLabel } from '../../format';
import { publicUrl } from '../../router';
import { Icon } from '../../components/Icon';
import { ImagePicker } from '../../components/ImagePicker';
import { ByeInfo, PAIRING_MODE_LABEL, PairingModeInfo, QuotientInfo, TIE_BREAKER_LABEL, TieBreakerOrder } from '../../components/rules';
import { Field, Notice, QrCode, Seg, TeamName } from '../../components/ui';
import type { StepErrors } from './validate';

interface StepProps {
  draft: WizardDraft;
  update: (patch: Partial<WizardDraft>) => void;
  errors: StepErrors;
}

const TIME_ZONES = ['Europe/Berlin', 'Europe/Vienna', 'Europe/Zurich', 'Europe/Amsterdam', 'Europe/London'];

function NumberInput({
  value,
  onChange,
  min,
  max,
  id,
  invalid,
  describedBy,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  id: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  return (
    <input
      id={id}
      className="input num"
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={Number.isFinite(value) ? value : ''}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
    />
  );
}

/* 1 Auftritt */
export function StepAppearance({ draft, update, errors }: StepProps) {
  const setSponsor = (i: number, patch: Partial<WizardDraft['sponsors'][number]>) =>
    update({ sponsors: draft.sponsors.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  return (
    <>
      <div className="form-grid">
        <Field label="Turniername" error={errors.title}>
          {(id, d) => (
            <input id={id} className="input" value={draft.title} aria-invalid={!!errors.title || undefined} aria-describedby={d} onChange={(e) => update({ title: e.target.value })} placeholder="z. B. Herbstcup 2026" />
          )}
        </Field>
        <Field label="Veranstalter" error={errors.organizerName}>
          {(id, d) => (
            <input id={id} className="input" value={draft.organizerName} aria-invalid={!!errors.organizerName || undefined} aria-describedby={d} onChange={(e) => update({ organizerName: e.target.value })} placeholder="Verein" />
          )}
        </Field>
        <Field label="Veranstaltungsort">
          {(id) => <input id={id} className="input" value={draft.venue} onChange={(e) => update({ venue: e.target.value })} placeholder="Sportplatz, Halle" />}
        </Field>
        <Field label="Datum" error={errors.localDate}>
          {(id, d) => <input id={id} className="input" type="date" value={draft.localDate} aria-describedby={d} onChange={(e) => update({ localDate: e.target.value })} />}
        </Field>
        <Field label="Zeitzone">
          {(id) => (
            <select id={id} className="select" value={draft.timeZone} onChange={(e) => update({ timeZone: e.target.value })}>
              {TIME_ZONES.map((z) => (
                <option key={z} value={z}>
                  {z.replace('Europe/', '').replace('_', ' ')}
                </option>
              ))}
            </select>
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
          <button type="button" className="btn" onClick={() => update({ sponsors: [...draft.sponsors, { id: uid('s'), name: '', url: '' }] })}>
            <Icon name="plus" />
            Sponsor hinzufügen
          </button>
        </div>
        {draft.sponsors.length === 0 && <span className="muted">Noch keine Sponsoren. Sie erscheinen später auf der öffentlichen Seite.</span>}
        {draft.sponsors.map((s, i) => (
          <div key={s.id} className="form-grid" style={{ alignItems: 'end' }}>
            <Field label={`Sponsor ${i + 1}`}>
              {(id) => <input id={id} className="input" value={s.name} onChange={(e) => setSponsor(i, { name: e.target.value })} placeholder="Name" />}
            </Field>
            <Field label="Link" error={errors[`sponsor-${i}`]}>
              {(id, d) => (
                <input id={id} className="input" type="url" inputMode="url" value={s.url} aria-describedby={d} aria-invalid={!!errors[`sponsor-${i}`] || undefined} onChange={(e) => setSponsor(i, { url: e.target.value })} placeholder="https://" />
              )}
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
    </>
  );
}

/* 2 Teilnehmer */
export function StepParticipants({ draft, update, errors }: StepProps) {
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);
  const active = draft.teams.filter((t) => t.active && t.name.trim()).length;
  const setTeam = (i: number, patch: Partial<WizardDraft['teams'][number]>) =>
    update({ teams: draft.teams.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  return (
    <>
      <div className="row">
        <span className="pill a">{active} aktive Teams</span>
        {active % 2 === 1 && <span className="pill y">Ungerade Zahl: pro Runde ein Freilos</span>}
        {active > 40 && <span className="pill o">Mehr als 40 Teams: Planung kann lange dauern</span>}
      </div>
      {errors.teams && <span className="field-error">{errors.teams}</span>}
      {errors.teamNames && <span className="field-error">{errors.teamNames}</span>}
      <div className="list">
        {draft.teams.map((t, i) => (
          <div key={t.id} className="list-row">
            <span className="small-text" style={{ width: 22, textAlign: 'right' }}>
              {i + 1}
            </span>
            <input className="input grow" aria-label={`Name Team ${i + 1}`} value={t.name} onChange={(e) => setTeam(i, { name: e.target.value })} />
            <label className="check phone-hide" style={{ minHeight: 0 }}>
              <input type="checkbox" checked={t.active} onChange={(e) => setTeam(i, { active: e.target.checked })} />
              <span>Aktiv</span>
            </label>
            <input type="checkbox" className="phone-only" aria-label={`Team ${i + 1} aktiv`} checked={t.active} onChange={(e) => setTeam(i, { active: e.target.checked })} style={{ width: 22, height: 22, accentColor: 'var(--ac)' }} />
            <button type="button" className="btn sq" aria-label={`Team ${i + 1} entfernen`} onClick={() => update({ teams: draft.teams.filter((_, j) => j !== i) })}>
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="row">
        <button type="button" className="btn" onClick={() => update({ teams: [...draft.teams, { id: uid('tm'), name: `Team ${draft.teams.length + 1}`, active: true }] })}>
          <Icon name="plus" />
          Team hinzufügen
        </button>
        <button type="button" className="btn" onClick={() => setShowImport((s) => !s)} aria-expanded={showImport}>
          Liste einfügen
        </button>
      </div>
      {showImport && (
        <div className="stack">
          <Field label="Ein Team pro Zeile">
            {(id) => <textarea id={id} className="input" value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={'FC Beispiel\nSV Muster'} />}
          </Field>
          <div className="row">
            <button
              type="button"
              className="btn pri"
              disabled={!importText.trim()}
              onClick={() => {
                const names = importText
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean);
                const placeholders = draft.teams.every((t) => /^Team \d+$/.test(t.name));
                const base = placeholders ? [] : draft.teams;
                update({ teams: [...base, ...names.map((name) => ({ id: uid('tm'), name, active: true }))] });
                setImportText('');
                setShowImport(false);
              }}
            >
              Teams übernehmen
            </button>
          </div>
        </div>
      )}
      <p className="small-text">Logos für Teams kannst du nach dem Anlegen unter „Teams“ hinzufügen.</p>
    </>
  );
}

/* 3 Modus & Wertung */
export function StepMode({ draft, update, errors }: StepProps) {
  const active = draft.teams.filter((t) => t.active && t.name.trim()).length;
  const maxRounds = active % 2 === 0 ? active - 1 : active;
  return (
    <>
      <div className="form-grid">
        <Field label="Runden" error={errors.roundsTotal}>
          {(id, d) => <NumberInput id={id} describedBy={d} invalid={!!errors.roundsTotal} min={1} max={20} value={draft.roundsTotal} onChange={(n) => update({ roundsTotal: n, preDrawRounds: Math.min(draft.preDrawRounds, n || 0) })} />}
        </Field>
        <Field label="Vorab ausgeloste Runden" error={errors.preDrawRounds}>
          {(id, d) => (
            <select id={id} className="select" aria-describedby={d} value={draft.preDrawRounds} onChange={(e) => update({ preDrawRounds: Number(e.target.value) })}>
              {Array.from({ length: (Number.isFinite(draft.roundsTotal) ? draft.roundsTotal : 0) + 1 }, (_, i) => (
                <option key={i} value={i}>
                  {i === 0 ? 'Keine, gleich Schweizer System' : `${i} ${i === 1 ? 'Runde' : 'Runden'}`}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {draft.roundsTotal > maxRounds && active >= 2 && (
        <Notice tone="hint" title="Wiederholungen sind unvermeidbar">
          Mit {active} Teams gibt es nur {maxRounds} Runden ohne doppelte Begegnung. Bei {draft.roundsTotal} Runden treffen sich manche Teams zweimal.
        </Notice>
      )}
      <div className="field">
        <span className="label">
          Gegnerwahl <PairingModeInfo />
        </span>
        <Seg<PairingMode>
          label="Gegnerwahl"
          value={draft.pairingMode}
          onChange={(v) => update({ pairingMode: v })}
          options={(['balanced', 'strict_no_rematch', 'performance_first'] as const).map((m) => ({ value: m, label: PAIRING_MODE_LABEL[m] }))}
        />
      </div>
      <dl className="summary">
        <dt>Punkte</dt>
        <dd>Sieg 3, Remis 1, Niederlage 0</dd>
        <dt>Rangfolge</dt>
        <dd>
          Punkte pro gespieltem Spiel <QuotientInfo />
        </dd>
        <dt>Freilos</dt>
        <dd>
          Kein Spiel, keine Punkte, keine Tore <ByeInfo />
        </dd>
      </dl>
      <div className="field">
        <span className="label">Bei gleichem Quotienten entscheidet</span>
        <TieBreakerOrder
          value={draft.tieBreakers}
          onChange={(v) => update({ tieBreakers: v })}
          buchholz={draft.buchholzEnabled}
          onBuchholz={(on) => update({ buchholzEnabled: on })}
        />
      </div>
      <Notice tone="info" title="Nichtantritt ist keine Niederlage">
        Ein nicht ausgetragenes Spiel zählt für beide Teams gar nicht. Wer absichtlich nicht antritt, kann so seinen Quotienten schützen. Sag das den Teams am besten vor dem Turnier.
      </Notice>
    </>
  );
}

/* 4 Spielbetrieb */
export function StepOperation({ draft, update, errors }: StepProps) {
  const active = draft.teams.filter((t) => t.active && t.name.trim()).length;
  const matches = Math.floor(active / 2);
  const waves = wavesPerRound(active, draft.fields.length);
  const perRound = roundMinutes(active, draft.fields.length, draft.matchMinutes || 0, draft.turnoverMinutes || 0);
  const total = draft.roundsTotal * perRound + Math.max(0, draft.roundsTotal - 1) * (draft.roundBreakMinutes || 0);
  const [h, m] = draft.startTime.split(':').map(Number);
  const endMin = (h ?? 0) * 60 + (m ?? 0) + total;
  const end = `${String(Math.floor(endMin / 60) % 24).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
  const setField = (i: number, name: string) => update({ fields: draft.fields.map((f, j) => (j === i ? { ...f, name } : f)) });
  const uneven = matches % Math.max(1, draft.fields.length) !== 0;

  return (
    <>
      <div className="section">
        <div className="section-head">
          <h3 className="card-title">Spielfelder</h3>
          <button type="button" className="btn" onClick={() => update({ fields: [...draft.fields, { id: uid('f'), name: `Platz ${draft.fields.length + 1}` }] })}>
            <Icon name="plus" />
            Feld hinzufügen
          </button>
        </div>
        {errors.fields && <span className="field-error">{errors.fields}</span>}
        {errors.fieldNames && <span className="field-error">{errors.fieldNames}</span>}
        <div className="grid">
          {draft.fields.map((f, i) => (
            <div key={f.id} className="row" style={{ flexWrap: 'nowrap' }}>
              <input className="input" aria-label={`Name Feld ${i + 1}`} value={f.name} onChange={(e) => setField(i, e.target.value)} aria-invalid={!f.name.trim() || undefined} />
              <button type="button" className="btn sq" aria-label={`Feld ${i + 1} entfernen`} disabled={draft.fields.length <= 1} onClick={() => update({ fields: draft.fields.filter((_, j) => j !== i) })}>
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="form-grid">
        <Field label="Turnierstart" error={errors.startTime}>
          {(id, d) => <input id={id} className="input" type="time" value={draft.startTime} aria-describedby={d} onChange={(e) => update({ startTime: e.target.value })} />}
        </Field>
        <Field label="Spieldauer in Minuten" error={errors.matchMinutes}>
          {(id, d) => <NumberInput id={id} describedBy={d} min={1} value={draft.matchMinutes} onChange={(n) => update({ matchMinutes: n })} />}
        </Field>
        <Field label="Wechselpause in Minuten" error={errors.turnoverMinutes}>
          {(id, d) => <NumberInput id={id} describedBy={d} min={0} value={draft.turnoverMinutes} onChange={(n) => update({ turnoverMinutes: n })} />}
        </Field>
        <Field label="Pause zwischen Runden in Minuten">
          {(id) => <NumberInput id={id} min={0} value={draft.roundBreakMinutes} onChange={(n) => update({ roundBreakMinutes: n })} />}
        </Field>
      </div>
      <div className="field">
        <span className="label">Verteilung auf Wellen</span>
        <Seg<'max_capacity' | 'balanced_waves'>
          label="Verteilung auf Wellen"
          value={draft.allocation}
          onChange={(v) => update({ allocation: v })}
          options={[
            { value: 'max_capacity', label: 'Felder voll auslasten' },
            { value: 'balanced_waves', label: 'Gleichmäßig verteilen' },
          ]}
        />
      </div>
      <div className="stack tight">
        <label className="check">
          <input type="checkbox" checked={draft.restOptimization} onChange={(e) => update({ restOptimization: e.target.checked })} />
          <span>Pausen zwischen den Spielen eines Teams möglichst lang halten</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={draft.hardRestMinutes !== null} onChange={(e) => update({ hardRestMinutes: e.target.checked ? 10 : null })} />
          <span>Feste Mindestpause erzwingen</span>
        </label>
        {draft.hardRestMinutes !== null && (
          <div className="inline-field" style={{ paddingLeft: 28 }}>
            <span className="label">Minuten</span>
            <input className="input num" style={{ width: 90 }} type="number" min={0} aria-label="Mindestpause in Minuten" value={draft.hardRestMinutes} onChange={(e) => update({ hardRestMinutes: Number(e.target.value) })} />
          </div>
        )}
        {draft.hardRestMinutes !== null && (
          <span className="small-text" style={{ paddingLeft: 28 }}>
            Wenn die Pause nicht passt, verschiebt sich der Rundenstart oder du bekommst einen Hinweis.
          </span>
        )}
      </div>
      <div className="kpis">
        <div className="kpi">
          <b>{matches}</b>
          <span>Spiele pro Runde</span>
        </div>
        <div className="kpi">
          <b>{waves}</b>
          <span>{waves === 1 ? 'Welle' : 'Wellen'} pro Runde</span>
        </div>
        <div className="kpi">
          <b>{formatMinutes(perRound)}</b>
          <span>pro Runde</span>
        </div>
        <div className={total > 10 * 60 ? 'kpi warn' : 'kpi'}>
          <b>ca. {end}</b>
          <span>Turnierende</span>
        </div>
      </div>
      {uneven && draft.allocation === 'max_capacity' && waves > 1 && (
        <p className="small-text">
          Die letzte Welle ist nicht voll: {matches % draft.fields.length} von {draft.fields.length} Feldern belegt.
        </p>
      )}
    </>
  );
}

/* 5 Veröffentlichung */
export function StepPublish({ draft, update }: StepProps) {
  const url = publicUrl(draft.id);
  const checks = configChecks(draft);
  return (
    <>
      <div className="field">
        <span className="label">Was sehen Zuschauer?</span>
        <Seg<Visibility>
          label="Sichtbarkeit"
          value={draft.visibility}
          onChange={(v) => update({ visibility: v })}
          options={(['full', 'no_standings', 'kids'] as const).map((v) => ({ value: v, label: visibilityLabel[v] }))}
        />
        <span className="muted" style={{ marginTop: 6 }}>
          {visibilityHelp[draft.visibility]}
        </span>
      </div>
      <div className="grid two">
        <div className="card stack" style={{ background: 'var(--bg)' }}>
          <h3 className="card-title">Vorschau Zuschauer</h3>
          <PublicPreviewSample draft={draft} />
        </div>
        <div className="card stack" style={{ background: 'var(--bg)' }}>
          <h3 className="card-title">Link und QR-Code</h3>
          <QrCode text={url} />
          <code className="small-text" style={{ overflowWrap: 'anywhere' }}>
            {url}
          </code>
          <span className="small-text">Der Link funktioniert, sobald du das Turnier veröffentlichst.</span>
        </div>
      </div>
      <div className="stack tight">
        <h3 className="card-title">Prüfung</h3>
        <ul className="list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {checks.map((c) => (
            <li key={c.text} className="list-row">
              <span className={`pill ${c.ok ? 'g' : 'y'}`}>{c.ok ? 'OK' : 'Prüfen'}</span>
              <span className="grow">{c.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function PublicPreviewSample({ draft }: { draft: WizardDraft }) {
  const [a, b] = draft.teams.filter((t) => t.active);
  if (!a || !b) return <span className="muted">Leg zuerst Teams an.</span>;
  const scores = draft.visibility !== 'kids';
  return (
    <div className="stack tight">
      <div className="match">
        <div className="match-meta">
          <span>{draft.fields[0]?.name ?? 'Feld'}</span>
          <span>·</span>
          <span>{draft.startTime}</span>
        </div>
        <div className="match-teams">
          <TeamName name={a.name} />
          {scores && <span className="score">2</span>}
          <TeamName name={b.name} />
          {scores && <span className="score lose">1</span>}
        </div>
      </div>
      <span className="small-text">{draft.visibility === 'full' ? 'Dazu die Tabelle nach Quotient.' : 'Keine Tabelle.'}</span>
    </div>
  );
}

function configChecks(d: WizardDraft): Array<{ ok: boolean; text: string }> {
  const active = d.teams.filter((t) => t.active && t.name.trim()).length;
  const maxRounds = active % 2 === 0 ? active - 1 : active;
  return [
    { ok: active >= 4, text: active >= 4 ? `${active} aktive Teams` : `Nur ${active} aktive Teams, das wird ein kurzes Turnier` },
    { ok: d.roundsTotal <= maxRounds, text: d.roundsTotal <= maxRounds ? `${d.roundsTotal} Runden ohne zwingende Wiederholung möglich` : `${d.roundsTotal} Runden bei ${active} Teams führen zu Wiederholungen` },
    { ok: d.fields.length >= 1, text: `${d.fields.length} ${d.fields.length === 1 ? 'Spielfeld' : 'Spielfelder'}` },
    { ok: !!d.organizerLogo, text: d.organizerLogo ? 'Vereinswappen ist hinterlegt' : 'Kein Vereinswappen, es erscheinen die Initialen' },
    { ok: true, text: `Sichtbarkeit: ${visibilityLabel[d.visibility]}` },
  ];
}

/* 6 Prüfen */
export function StepReview({ draft }: StepProps) {
  const active = draft.teams.filter((t) => t.active && t.name.trim());
  const perRound = roundMinutes(active.length, draft.fields.length, draft.matchMinutes || 0, draft.turnoverMinutes || 0);
  const total = draft.roundsTotal * perRound + Math.max(0, draft.roundsTotal - 1) * (draft.roundBreakMinutes || 0);
  const [seed, setSeed] = useState(1);
  const sim = useMemo(() => {
    const tid = draft.id;
    const data: TournamentData = {
      tournament: {
        id: tid,
        ownerUid: '',
        title: draft.title,
        organizerName: draft.organizerName,
        localDate: draft.localDate,
        timeZone: draft.timeZone,
        status: 'draft',
        visibility: draft.visibility,
        roundsTotal: draft.roundsTotal,
        preDrawRounds: draft.preDrawRounds,
        pairingMode: draft.pairingMode,
        points: { win: 3, draw: 1, loss: 0 },
        ranking: { primary: 'points_per_played_match', tieBreakers: draft.tieBreakers },
        schedule: { tournamentStartISO: '', matchMinutes: draft.matchMinutes, turnoverMinutes: draft.turnoverMinutes, roundBreakMinutes: draft.roundBreakMinutes, allocation: draft.allocation },
        fieldIds: [],
        currentRound: 0,
        revision: 0,
        createdAt: '',
        updatedAt: '',
      },
      teams: active.map((t) => ({ id: t.id, tournamentId: tid, name: t.name, status: 'active', joinedAt: '' })),
      fields: [],
      sponsors: [],
      rounds: [],
      matches: [],
      byes: [],
      assets: {},
    };
    return previewNextRound(data, seed);
  }, [draft, active, seed]);
  const name = new Map(active.map((t) => [t.id, t.name]));

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
        <dt>Teams</dt>
        <dd>{active.length}</dd>
        <dt>Runden</dt>
        <dd>
          {draft.roundsTotal}, davon {draft.preDrawRounds} ausgelost
        </dd>
        <dt>Gegnerwahl</dt>
        <dd>{PAIRING_MODE_LABEL[draft.pairingMode]}</dd>
        <dt>Feinwertung</dt>
        <dd>
          {draft.tieBreakers
            .filter((tb) => tb !== 'buchholz' || draft.buchholzEnabled)
            .map((tb) => TIE_BREAKER_LABEL[tb])
            .join(', ')}
        </dd>
        <dt>Felder</dt>
        <dd>{draft.fields.map((f) => f.name).join(', ')}</dd>
        <dt>Dauer</dt>
        <dd>ca. {formatMinutes(total)}</dd>
        <dt>Sichtbarkeit</dt>
        <dd>{visibilityLabel[draft.visibility]}</dd>
      </dl>
      {total > 10 * 60 && (
        <Notice tone="hint" title="Langes Turnier">
          Mit diesen Einstellungen dauert das Turnier über zehn Stunden. Mehr Felder oder kürzere Spiele helfen.
        </Notice>
      )}
      <div className="section">
        <div className="section-head">
          <h3 className="card-title">Erste Runde, Probe-Auslosung</h3>
          <button type="button" className="btn" onClick={() => setSeed((s) => s + 1)}>
            <Icon name="shuffle" />
            Neu auslosen
          </button>
        </div>
        <div className="list">
          {sim.pairs.map((p) => (
            <div key={p.teamAId} className="list-row">
              <span className="grow" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 8px', alignItems: 'center' }}>
                <TeamName name={name.get(p.teamAId) ?? ''} />
                <span className="muted">gegen</span>
                <TeamName name={name.get(p.teamBId) ?? ''} />
              </span>
            </div>
          ))}
          {sim.byeTeamId && (
            <div className="list-row">
              <span className="pill">Freilos</span>
              <span className="grow">{name.get(sim.byeTeamId)}</span>
            </div>
          )}
        </div>
        <span className="small-text">Die echte Auslosung passiert beim Veröffentlichen.</span>
      </div>
    </>
  );
}
