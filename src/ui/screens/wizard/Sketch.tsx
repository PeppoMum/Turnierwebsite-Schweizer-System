// Live-Skizze neben dem Baukasten: Kennzahlen und „So läuft das Turnier“ mit Uhrzeiten.
// Auf dem Handy oben als kleine Übersicht, der Ablauf klappt auf.
import { useState } from 'react';
import type { StageColor, StageConfig } from '../../../domain/format';
import { groupLetter } from '../../../domain/groups';
import { formatTime } from '../../format';
import { Notice } from '../../components/ui';
import { entryText, type BuilderState } from './builder';
import { roundLabel, type WizardPreview } from './preview';

interface SketchProps {
  preview: WizardPreview;
  builder: BuilderState;
  timeZone: string;
  fieldNames: string[];
}

const COLOR_CLASS: Record<StageColor, string> = {
  gold: 'gold',
  silver: 'silver',
  bronze: 'bronze',
  neutral: '',
};
const COLOR_NAME: Record<StageColor, string> = {
  gold: 'Gold',
  silver: 'Silber',
  bronze: 'Bronze',
  neutral: '',
};

interface Step {
  label: string;
  startISO: string;
  count: number;
}

function stageSteps(preview: WizardPreview, stageId: string): Step[] {
  const plan = preview.plan;
  if (!plan) return [];
  const start = new Map(plan.day.matches.map((m) => [m.matchId, m.startISO]));
  const steps = new Map<string, Step>();
  for (const m of plan.matches) {
    if (m.stageId !== stageId) continue;
    const label = roundLabel(m.matchKey);
    const iso = start.get(m.id) ?? '';
    const s = steps.get(label);
    if (!s) steps.set(label, { label, startISO: iso, count: 1 });
    else {
      s.count++;
      if (iso && (!s.startISO || iso < s.startISO)) s.startISO = iso;
    }
  }
  // Bei gleicher Anstoßzeit das Finale zuletzt.
  const rank = (label: string) => (label === 'Finale' ? 1 : 0);
  return [...steps.values()].sort((a, b) => a.startISO.localeCompare(b.startISO) || rank(a.label) - rank(b.label));
}

function placeRangeText(s: StageConfig): string {
  return s.placeRange ? `Plätze ${s.placeRange.from} bis ${s.placeRange.to}` : '';
}

function gamesText(g: WizardPreview['gamesPerTeam']): string {
  if (!g) return '–';
  return g.min === g.max ? String(g.min) : `${g.min}–${g.max}`;
}

export function Kpis({ preview, timeZone }: { preview: WizardPreview; timeZone: string }) {
  const placed = preview.format?.stages.reduce((max, s) => Math.max(max, s.placeRange?.to ?? 0), 0) ?? 0;
  return (
    <div className="wz-kpis">
      <div className="kpi">
        <b>{preview.plan ? preview.plan.matches.length : '–'}</b>
        <span>Spiele</span>
      </div>
      <div className="kpi">
        <b>{gamesText(preview.gamesPerTeam)}</b>
        <span>Spiele je Team</span>
      </div>
      <div className="kpi">
        <b>{preview.lastStartISO ? formatTime(preview.lastStartISO, timeZone) : '–'}</b>
        <span>Letztes Spiel ca.</span>
      </div>
      <div className="kpi">
        <b>{placed > 0 ? `1–${placed}` : preview.teamCount > 0 ? `1–${preview.teamCount}` : '–'}</b>
        <span>{preview.check.eliminated > 0 ? `Plätze, ${preview.check.eliminated} scheiden aus` : 'Jeder Platz vergeben'}</span>
      </div>
    </div>
  );
}

function Problems({ preview }: { preview: WizardPreview }) {
  const { errors, hints } = preview.check;
  if (errors.length === 0 && hints.length === 0 && preview.warnings.length === 0) return null;
  return (
    <div className="stack tight">
      {errors.length > 0 && (
        <Notice tone="warn" title="So geht es noch nicht">
          {errors.join(' ')}
        </Notice>
      )}
      {(hints.length > 0 || preview.warnings.length > 0) && (
        <Notice tone="hint" title="Gut zu wissen">
          {[...hints, ...preview.warnings].join(' ')}
        </Notice>
      )}
    </div>
  );
}

/** „So läuft das Turnier“: Gruppen, Pfeile mit Einstiegsregeln, Endrunden mit Uhrzeiten. */
export function Timeline({ preview, builder, timeZone }: SketchProps) {
  const format = preview.format;
  if (!format) return <span className="muted">Sobald die Einstellungen passen, erscheint hier der Ablauf.</span>;
  const t = (iso?: string) => (iso ? formatTime(iso, timeZone) : '–');
  const phases = [...new Set(format.stages.map((s) => s.phase))].sort((a, b) => a - b);
  const sizes = new Map<string, number[]>();
  for (const m of preview.plan?.matches ?? []) {
    if (m.groupIndex === undefined) continue;
    const list = sizes.get(m.stageId) ?? [];
    list[m.groupIndex] = (list[m.groupIndex] ?? 0) + 1;
    sizes.set(m.stageId, list);
  }
  const fieldOfGroup = (stageId: string, g: number) => {
    const ids = new Set(preview.plan?.matches.filter((m) => m.stageId === stageId && m.groupIndex === g).map((m) => m.id));
    const used = new Set(preview.plan?.day.matches.filter((m) => ids.has(m.matchId)).map((m) => m.fieldName));
    return used.size === 1 ? [...used][0] : null;
  };
  return (
    <div className="stack" style={{ gap: 12 }}>
      {phases.map((phase) => {
        const stages = format.stages.filter((s) => s.phase === phase);
        const phaseSpan = preview.plan?.day.phases.find((p) => p.phase === phase);
        const count = preview.plan?.matches.filter((m) => stages.some((s) => s.id === m.stageId)).length ?? 0;
        const grouped = stages[0]?.kind === 'groups';
        return (
          <div key={phase} className="stack tight">
            {phase > 0 && (
              <div className="wz-arrows" aria-hidden="true">
                {stages.map((s) => (
                  <span key={s.id}>
                    ↓{' '}
                    {s.entry
                      ? entryText({
                          places: s.entry.places,
                          best: s.entry.best?.[0] ?? null,
                        })
                      : ''}
                  </span>
                ))}
              </div>
            )}
            <div className="wz-phase-head">
              <span>
                {grouped ? stages[0]!.name : phase === phases[phases.length - 1] ? 'Endrunde' : stages.map((s) => s.name).join(', ')} · {count} Spiele
              </span>
              <span>
                {t(phaseSpan?.startISO)} – {t(phaseSpan?.endISO)}
              </span>
            </div>
            {grouped ? (
              <div className="wz-tiles">
                {(sizes.get(stages[0]!.id) ?? []).map((n, g) => {
                  const field = builder.fixedFields ? fieldOfGroup(stages[0]!.id, g) : null;
                  const single = (sizes.get(stages[0]!.id) ?? []).length === 1;
                  return (
                    <div key={g} className="wz-tile">
                      <b>{single ? 'Eine Tabelle' : `Gruppe ${groupLetter(g + (phase > 0 ? groupOffset(format, stages[0]!.id) : 0))}`}</b>
                      <span>
                        {field ? `${field} · ` : ''}
                        {n} Spiele
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                className="wz-tiles"
                style={{
                  gridTemplateColumns: `repeat(auto-fit, minmax(${stages.length > 2 ? 150 : 180}px, 1fr))`,
                }}
              >
                {stages.map((s) => {
                  const steps = stageSteps(preview, s.id);
                  const teams = s.kind === 'knockout' ? s.size : s.kind === 'placement' ? s.matches.length * 2 : s.entry ? null : preview.teamCount;
                  return (
                    <div key={s.id} className={`wz-final ${COLOR_CLASS[s.color]}`}>
                      <b>
                        {s.name}
                        {teams ? ` · ${teams} Teams` : s.kind === 'final_group' ? ' · Finalgruppe' : ''}
                      </b>
                      {steps.map((st) => (
                        <div key={st.label} className="wz-step">
                          {st.label === 'Finale' ? <b>{st.label}</b> : st.label}
                          {st.count > 1 && (st.label === 'Platzierungsspiele' || st.label === 'Spiele') ? ` (${st.count})` : ''}
                          <span>{t(st.startISO)}</span>
                        </div>
                      ))}
                      <span className="small-text">{placeRangeText(s)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {preview.check.eliminated > 0 && (
        <div className="wz-out">
          {preview.check.eliminated} {preview.check.eliminated === 1 ? 'Mannschaft scheidet' : 'Mannschaften scheiden'} nach der Vorrunde aus und bekommen
          keinen Platz.
        </div>
      )}
    </div>
  );
}

/** Zwischenrunden-Gruppen werden nach den Vorrunden-Gruppen weitergezählt (E, F …). */
function groupOffset(format: NonNullable<WizardPreview['format']>, stageId: string): number {
  let offset = 0;
  for (const s of format.stages) {
    if (s.id === stageId) break;
    if (s.kind === 'groups') offset += s.groupCount;
  }
  return offset;
}

/** Skizze rechts neben dem Baukasten (Computer) bzw. oben (Handy). */
export function Sketch(props: SketchProps) {
  const { preview, timeZone, fieldNames } = props;
  const [open, setOpen] = useState(false);
  const fieldText = `${fieldNames.length} ${fieldNames.length === 1 ? 'Feld' : 'Felder'}`;
  return (
    <section className="wz-sketch" aria-label="Skizze des Turniers">
      <div className="phone-hide stack" style={{ gap: 14 }}>
        <Kpis preview={preview} timeZone={timeZone} />
        <div className="card stack" style={{ gap: 14 }}>
          <div className="wz-line" style={{ alignItems: 'baseline' }}>
            <h2 className="wz-h">So läuft das Turnier</h2>
            <span className="small-text">
              {preview.firstStartISO ? `${formatTime(preview.firstStartISO, timeZone)} bis ca. ${formatTime(preview.lastEndISO, timeZone)} Uhr · ` : ''}
              {fieldText}
            </span>
          </div>
          <Timeline {...props} />
        </div>
        <Problems preview={preview} />
      </div>
      <div className="phone-only card stack" style={{ gap: 10, padding: 14 }}>
        <MiniBlocks preview={preview} />
        <div className="wz-mini-nums">
          <span>
            <b>{preview.plan?.matches.length ?? '–'}</b> <span className="muted">Spiele</span>
          </span>
          <span>
            <b>{gamesText(preview.gamesPerTeam)}</b> <span className="muted">je Team</span>
          </span>
          <span>
            <span className="muted">Ende ca.</span> <b>{preview.lastEndISO ? formatTime(preview.lastEndISO, timeZone) : '–'}</b>
          </span>
        </div>
        <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Ablauf ausblenden' : 'Ablauf mit Uhrzeiten ansehen'}
        </button>
        {open && <Timeline {...props} />}
        <Problems preview={preview} />
      </div>
    </section>
  );
}

/** Kleine Blöcke fürs Handy: Gruppen oben, Endrunden darunter. */
function MiniBlocks({ preview }: { preview: WizardPreview }) {
  const format = preview.format;
  if (!format) return null;
  const phases = [...new Set(format.stages.map((s) => s.phase))].sort((a, b) => a - b);
  const finals = format.stages.filter((s) => s.kind === 'knockout' || s.kind === 'final_group');
  const label = (s: StageConfig) =>
    s.kind === 'placement' ? 'Plätze' : finals.length > 1 ? COLOR_NAME[s.color] || s.name : s.kind === 'final_group' ? 'Finalgruppe' : 'K.-o.';
  return (
    <div className="wz-mini" aria-hidden="true">
      {phases.map((phase) => {
        const stages = format.stages.filter((s) => s.phase === phase);
        return (
          <div key={phase}>
            {stages.flatMap((s) =>
              s.kind === 'groups'
                ? Array.from({ length: s.groupCount }, (_, g) => (
                    <span key={`${s.id}-${g}`}>{s.groupCount === 1 ? 'Liga' : groupLetter(g + (phase > 0 ? groupOffset(format, s.id) : 0))}</span>
                  ))
                : [
                    <span key={s.id} className={COLOR_CLASS[s.color]}>
                      {label(s)}
                      {s.kind === 'knockout' ? ` · ${s.size}` : ''}
                    </span>,
                  ],
            )}
          </div>
        );
      })}
    </div>
  );
}
