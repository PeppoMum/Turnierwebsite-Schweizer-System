// Schritt „Turnierform“: Vorlage, Mannschaftszahl, Vorrunde, Zwischenrunde, Endrunden, links die
// Einstellungen, rechts (Handy: oben) die Live-Skizze. Entwurf „Turnier anlegen“, Seite „Ausgearbeitet“.
import { FORMAT_TEMPLATES, TIE_BREAK_ORDER, type DrawDecider, type TieBreakVariant } from '../../../domain/format';
import { GROUP_LOT_EXPLANATION, GROUP_TIE_BREAKER_LABELS, HEAD_TO_HEAD_EXPLANATION } from '../../../domain/groups';
import { uid } from '../../data/mockStore';
import type { WizardDraft } from '../../data/types';
import { Icon } from '../../components/Icon';
import { InfoButton, Seg } from '../../components/ui';
import {
  MAX_FINAL_ROUNDS,
  addFinalRound,
  defaultBuilder,
  finalRoundSize,
  finalsSourceSizes,
  fromFormat,
  groupSizeText,
  koStartLabel,
  placementAvailable,
  prelimSizes,
  setFinalsMode,
  swissBuilder,
  type BuilderState,
  type FinalForm,
  type FinalRound,
  type FinalsMode,
  type Prelim,
} from './builder';
import { activeTeams, type WizardPreview } from './preview';
import { Sketch } from './Sketch';
import { StepMode } from './steps';
import type { StepErrors } from './validate';

interface FormatStepProps {
  draft: WizardDraft;
  update: (patch: Partial<WizardDraft>) => void;
  errors: StepErrors;
  builder: BuilderState;
  setBuilder: (b: BuilderState) => void;
  preview: WizardPreview;
}

const GROUP_CHIPS = [2, 3, 4, 5, 6, 8];
const FORM_LABEL: Record<FinalForm, string> = {
  knockout: 'K.-o.',
  knockout_all: 'K.-o., alle Plätze ausspielen',
  final_group: 'Finalgruppe, jeder gegen jeden',
};
const FINALS_OPTIONS: Array<{
  value: FinalsMode;
  label: string;
  help: string;
}> = [
  {
    value: 'none',
    label: 'Keine',
    help: 'Die Tabelle der Vorrunde ist das Ergebnis.',
  },
  {
    value: 'knockout',
    label: 'K.-o.',
    help: 'Viertelfinale bis Finale für die Besten.',
  },
  {
    value: 'tiers',
    label: 'Gold / Silber / Bronze',
    help: 'Mehrere Endrunden nach Gruppenplätzen.',
  },
];

/** Mannschaftszahl ändern: hinten Teams anhängen bzw. wegnehmen. */
function withTeamCount(draft: WizardDraft, n: number): WizardDraft['teams'] {
  const active = activeTeams(draft);
  if (n > active.length) {
    const extra = Array.from({ length: n - active.length }, (_, i) => ({
      id: uid('tm'),
      name: `Team ${draft.teams.length + i + 1}`,
      active: true,
    }));
    return [...draft.teams, ...extra];
  }
  const drop = new Set(active.slice(n).map((t) => t.id));
  return draft.teams.filter((t) => !drop.has(t.id));
}

function TeamCounter({ draft, update }: Pick<FormatStepProps, 'draft' | 'update'>) {
  const n = activeTeams(draft).length;
  const set = (v: number) => update({ teams: withTeamCount(draft, Math.max(2, Math.min(64, v))) });
  return (
    <div className="wz-line">
      <label className="label" htmlFor="wz-teams" style={{ margin: 0 }}>
        Mannschaften
      </label>
      <div className="wz-counter">
        <button type="button" className="btn sq" aria-label="Eine Mannschaft weniger" onClick={() => set(n - 1)}>
          <Icon name="minus" />
        </button>
        <input
          id="wz-teams"
          className="input num"
          type="number"
          inputMode="numeric"
          min={2}
          max={64}
          value={n}
          onChange={(e) => set(Number(e.target.value) || 2)}
        />
        <button type="button" className="btn sq" aria-label="Eine Mannschaft mehr" onClick={() => set(n + 1)}>
          <Icon name="plus" />
        </button>
      </div>
    </div>
  );
}

function YesNo({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="wz-line">
      <span className="label" style={{ margin: 0 }}>
        {label}
      </span>
      <Seg<'yes' | 'no'>
        label={label}
        value={value ? 'yes' : 'no'}
        onChange={(v) => onChange(v === 'yes')}
        options={[
          { value: 'no', label: 'Nein' },
          { value: 'yes', label: 'Ja' },
        ]}
      />
    </div>
  );
}

function PlaceChips({ max, value, onChange, label }: { max: number; value: number[]; onChange: (v: number[]) => void; label: string }) {
  return (
    <div className="wz-chips" role="group" aria-label={label}>
      {Array.from({ length: max }, (_, i) => i + 1).map((p) => {
        const on = value.includes(p);
        return (
          <button
            key={p}
            type="button"
            className="chip"
            aria-pressed={on}
            aria-label={`Platz ${p}`}
            onClick={() => onChange(on ? value.filter((x) => x !== p) : [...value, p].sort((a, b) => a - b))}
          >
            {p}.
          </button>
        );
      })}
    </div>
  );
}

function RoundEditor({
  builder,
  round,
  teamCount,
  onChange,
  onRemove,
}: {
  builder: BuilderState;
  round: FinalRound;
  teamCount: number;
  onChange: (r: FinalRound) => void;
  onRemove?: () => void;
}) {
  const source = finalsSourceSizes(builder, teamCount);
  const maxPlace = Math.max(1, ...source);
  const groups = source.length;
  const size = finalRoundSize(builder, round, teamCount);
  const isKo = round.form !== 'final_group';
  const summary = isKo ? (koStartLabel(size) ? `${size} Teams · beginnt mit ${koStartLabel(size)}` : `${size} Teams`) : `${size} Teams · jeder gegen jeden`;
  const multi = builder.finalsMode === 'tiers';
  return (
    <div className="wz-round">
      <div className="wz-round-head">
        <i className={`wz-dot ${round.color === 'neutral' ? '' : round.color}`} aria-hidden="true" />
        {multi ? (
          <input className="input grow" aria-label="Name der Endrunde" value={round.name} onChange={(e) => onChange({ ...round, name: e.target.value })} />
        ) : (
          <span className="grow">{round.name}</span>
        )}
        <span className="small-text">{summary}</span>
        {onRemove && (
          <button type="button" className="btn sq" aria-label={`${round.name} entfernen`} onClick={onRemove}>
            ✕
          </button>
        )}
      </div>
      <div className="stack tight">
        <span className="small-text">{groups > 1 ? 'Wer kommt rein: Platz in jeder Gruppe' : 'Wer kommt rein: Platz in der Tabelle'}</span>
        <PlaceChips max={maxPlace} value={round.places} label={`Plätze für die ${round.name}`} onChange={(places) => onChange({ ...round, places })} />
      </div>
      {groups > 1 && (
        <div className="wz-best">
          <span>dazu die besten</span>
          <select
            className="select"
            aria-label="Wie viele der besten"
            value={round.best?.count ?? 0}
            onChange={(e) => {
              const count = Number(e.target.value);
              onChange({
                ...round,
                best:
                  count === 0
                    ? null
                    : {
                        place: round.best?.place ?? Math.min(maxPlace, Math.max(...round.places, 0) + 1),
                        count,
                      },
              });
            }}
          >
            {Array.from({ length: groups }, (_, i) => (
              <option key={i} value={i}>
                {i === 0 ? 'keine' : i}
              </option>
            ))}
          </select>
          {round.best && (
            <>
              <span>von Platz</span>
              <select
                className="select"
                aria-label="Von welchem Gruppenplatz"
                value={round.best.place}
                onChange={(e) =>
                  onChange({
                    ...round,
                    best: { ...round.best!, place: Number(e.target.value) },
                  })
                }
              >
                {Array.from({ length: maxPlace }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
              <InfoButton title="Die Besten eines Platzes">
                <p>
                  Die Seite vergleicht zum Beispiel alle Gruppendritten: erst Punkte pro Spiel, dann Tordifferenz pro Spiel, dann Tore pro Spiel. So zählt es
                  fair, auch wenn Gruppen ungleich groß sind.
                </p>
              </InfoButton>
            </>
          )}
        </div>
      )}
      <select
        className="select"
        aria-label={`Form der ${round.name}`}
        value={round.form}
        onChange={(e) => onChange({ ...round, form: e.target.value as FinalForm })}
      >
        {(Object.keys(FORM_LABEL) as FinalForm[]).map((f) => (
          <option key={f} value={f}>
            {FORM_LABEL[f]}
          </option>
        ))}
      </select>
    </div>
  );
}

export function FormatStep(props: FormatStepProps) {
  const { draft, update, builder: b, setBuilder, preview } = props;
  const teamCount = activeTeams(draft).length;
  const change = (patch: Partial<BuilderState>) => setBuilder({ ...b, ...patch, templateId: null });
  const sizes = prelimSizes(b, teamCount);
  const maxGroups = Math.max(1, Math.min(16, Math.floor(teamCount / 2)));

  const setPrelim = (p: Prelim) => {
    if (p === b.prelim) return;
    if (p === 'swiss') return setBuilder(swissBuilder(b));
    const base: BuilderState = {
      ...(b.prelim === 'swiss' ? defaultBuilder() : b),
      templateId: null,
      prelim: p,
      intermediate: null,
      groupSizes: null,
    };
    const groupCount = p === 'league' ? 1 : Math.max(2, Math.min(base.groupCount === 1 ? 2 : base.groupCount, maxGroups));
    const next = {
      ...base,
      groupCount,
      placement: p === 'groups' && base.placement,
    };
    setBuilder(
      setFinalsMode(next, next.finalsMode === 'none' ? 'knockout' : next.finalsMode === 'tiers' && p === 'league' ? 'knockout' : next.finalsMode, teamCount),
    );
  };

  const setTemplate = (id: string) => {
    const t = FORMAT_TEMPLATES.find((x) => x.id === id);
    if (!t) return change({});
    setBuilder(fromFormat(t.build(), t.id));
    update({ teams: withTeamCount(draft, t.teamCount) });
  };

  const setGroupCount = (n: number) => {
    const next = { ...b, templateId: null, groupCount: n, groupSizes: null };
    setBuilder(next.finalsMode === 'none' ? next : setFinalsMode(next, next.finalsMode, teamCount));
  };

  const setIntermediate = (on: boolean) => {
    const next: BuilderState = {
      ...b,
      templateId: null,
      intermediate: on
        ? {
            groupCount: Math.max(2, Math.floor(b.groupCount / 2)),
            places: [1, 2],
            carryOverPoints: false,
          }
        : null,
      placement: false,
    };
    setBuilder(setFinalsMode(next, next.finalsMode === 'none' ? 'knockout' : next.finalsMode, teamCount));
  };

  const setRound = (i: number, r: FinalRound) => change({ finals: b.finals.map((x, j) => (j === i ? r : x)) });
  const removeRound = (i: number) => {
    const finals = b.finals.filter((_, j) => j !== i);
    change({
      finals,
      finalsMode: finals.length <= 1 ? (finals.length === 0 ? 'none' : 'knockout') : 'tiers',
    });
  };
  const anyKo = b.finals.some((r) => r.form === 'knockout' && finalRoundSize(b, r, teamCount) >= 4);
  const anyKoAll = b.finals.some((r) => r.form !== 'final_group');

  const settings = (
    <div className="wz-settings card">
      <div className="field">
        <label className="label" htmlFor="wz-template">
          Vorlage
        </label>
        <select id="wz-template" className="select" value={b.templateId ?? ''} onChange={(e) => setTemplate(e.target.value)}>
          <option value="">Eigene Einstellungen</option>
          {FORMAT_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <span className="small-text">Eine Vorlage füllt alles vor. Danach kannst du jede Einstellung ändern.</span>
      </div>
      <TeamCounter draft={draft} update={update} />

      <div className="wz-sep" />
      <div className="stack tight">
        <h2 className="wz-h">Vorrunde</h2>
        <Seg<Prelim>
          label="Vorrunde"
          value={b.prelim}
          onChange={setPrelim}
          options={[
            { value: 'groups', label: 'Gruppen' },
            { value: 'league', label: 'Jeder gegen jeden' },
            { value: 'swiss', label: 'Schweizer System' },
          ]}
        />
      </div>

      {b.prelim === 'swiss' && (
        <div className="stack" style={{ gap: 22 }}>
          <StepMode draft={draft} update={update} errors={props.errors} />
        </div>
      )}

      {b.prelim === 'groups' && (
        <div className="stack tight">
          <span className="label">Anzahl Gruppen</span>
          <div className="wz-chips" role="group" aria-label="Anzahl Gruppen">
            {GROUP_CHIPS.filter((n) => n <= maxGroups || n === b.groupCount).map((n) => (
              <button key={n} type="button" className="chip" aria-pressed={b.groupCount === n} onClick={() => setGroupCount(n)}>
                {n}
              </button>
            ))}
            {maxGroups >= 7 && (
              <select
                className="select"
                style={{ width: 'auto' }}
                aria-label="Mehr Gruppen"
                value={b.groupCount > 8 || b.groupCount === 7 ? b.groupCount : ''}
                onChange={(e) => setGroupCount(Number(e.target.value))}
              >
                <option value="">Mehr …</option>
                {[7, ...Array.from({ length: Math.max(0, maxGroups - 8) }, (_, i) => i + 9)].map((n) => (
                  <option key={n} value={n}>
                    {n} Gruppen
                  </option>
                ))}
              </select>
            )}
          </div>
          <span className="small-text">
            {groupSizeText(sizes)} Mannschaften,{' '}
            {(() => {
              const games = [...new Set(sizes.map((n) => (n - 1) * (b.doubleRoundRobin ? 2 : 1)))].sort((x, y) => x - y);
              return `${games.join(' oder ')} Spiele pro Team`;
            })()}
          </span>
          <label className="check">
            <input type="checkbox" checked={b.groupSizes !== null} onChange={(e) => change({ groupSizes: e.target.checked ? [...sizes] : null })} />
            <span>Eigene Gruppengrößen</span>
          </label>
          {b.groupSizes && (
            <div className="wz-chips">
              {b.groupSizes.map((n, g) => (
                <label key={g} className="inline-field">
                  <span className="label">{String.fromCharCode(65 + g)}</span>
                  <input
                    className="input num"
                    style={{ width: 70 }}
                    type="number"
                    min={2}
                    value={n}
                    aria-label={`Größe Gruppe ${String.fromCharCode(65 + g)}`}
                    onChange={(e) =>
                      change({
                        groupSizes: b.groupSizes!.map((x, j) => (j === g ? Number(e.target.value) : x)),
                      })
                    }
                  />
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {b.prelim !== 'swiss' && (
        <>
          <YesNo label="Hin- und Rückspiel" value={b.doubleRoundRobin} onChange={(v) => change({ doubleRoundRobin: v })} />
          {b.prelim === 'groups' && <YesNo label="Jede Gruppe auf festem Feld" value={b.fixedFields} onChange={(v) => change({ fixedFields: v })} />}
          <div className="stack tight">
            <span className="label">
              Bei Punktgleichheit entscheidet{' '}
              <InfoButton title="Punktgleichheit">
                <p>{HEAD_TO_HEAD_EXPLANATION}</p>
                <p>{GROUP_LOT_EXPLANATION}</p>
              </InfoButton>
            </span>
            <Seg<TieBreakVariant>
              label="Bei Punktgleichheit"
              value={b.tieBreakVariant}
              onChange={(v) => change({ tieBreakVariant: v })}
              options={[
                { value: 'h2h_first', label: 'Direkter Vergleich zuerst' },
                { value: 'goals_first', label: 'Tordifferenz zuerst' },
              ]}
            />
            <span className="small-text">
              Punkte 3 / 1 / 0, dann {TIE_BREAK_ORDER[b.tieBreakVariant].map((x) => GROUP_TIE_BREAKER_LABELS[x]).join(', ')}, zuletzt das Los.
            </span>
          </div>
        </>
      )}

      {b.prelim === 'groups' && b.groupCount >= 2 && (
        <>
          <div className="wz-sep" />
          <div className="stack tight">
            <h2 className="wz-h">Zwischenrunde</h2>
            <Seg<'off' | 'on'>
              label="Zwischenrunde"
              value={b.intermediate ? 'on' : 'off'}
              onChange={(v) => setIntermediate(v === 'on')}
              options={[
                { value: 'off', label: 'Keine' },
                { value: 'on', label: 'Neue Gruppen' },
              ]}
            />
          </div>
          {b.intermediate && (
            <div className="stack tight">
              <span className="small-text">Wer kommt rein: Platz in jeder Gruppe</span>
              <PlaceChips
                max={Math.max(...sizes)}
                value={b.intermediate.places}
                label="Plätze für die Zwischenrunde"
                onChange={(places) =>
                  setBuilder(
                    setFinalsMode(
                      {
                        ...b,
                        templateId: null,
                        intermediate: { ...b.intermediate!, places },
                      },
                      b.finalsMode,
                      teamCount,
                    ),
                  )
                }
              />
              <span className="label">Gruppen in der Zwischenrunde</span>
              <div className="wz-chips" role="group" aria-label="Gruppen in der Zwischenrunde">
                {[2, 3, 4, 6, 8].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className="chip"
                    aria-pressed={b.intermediate!.groupCount === n}
                    onClick={() =>
                      setBuilder(
                        setFinalsMode(
                          {
                            ...b,
                            templateId: null,
                            intermediate: { ...b.intermediate!, groupCount: n },
                          },
                          b.finalsMode,
                          teamCount,
                        ),
                      )
                    }
                  >
                    {n}
                  </button>
                ))}
              </div>
              <span className="small-text">
                Die neuen Gruppen werden über Kreuz gebildet: Teams aus derselben Vorrunden-Gruppe treffen sich nicht gleich wieder.
              </span>
              <label className="check">
                <input
                  type="checkbox"
                  checked={b.intermediate.carryOverPoints}
                  onChange={(e) =>
                    change({
                      intermediate: {
                        ...b.intermediate!,
                        carryOverPoints: e.target.checked,
                      },
                    })
                  }
                />
                <span>Punkte und Tore aus der Vorrunde mitnehmen</span>
              </label>
              {!b.intermediate.carryOverPoints && <span className="small-text">Aus: alle starten in der Zwischenrunde bei 0 Punkten.</span>}
            </div>
          )}
        </>
      )}

      {b.prelim !== 'swiss' && (
        <>
          <div className="wz-sep" />
          <div className="stack tight">
            <h2 className="wz-h">Endrunde</h2>
            <div className="phone-hide">
              <Seg<FinalsMode>
                label="Endrunde"
                value={b.finalsMode}
                onChange={(v) => setBuilder(setFinalsMode(b, v, teamCount))}
                options={FINALS_OPTIONS.map((o) => ({
                  value: o.value,
                  label: o.label,
                }))}
              />
            </div>
            <div className="phone-only wz-opts" role="group" aria-label="Endrunde">
              {FINALS_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className="wz-opt"
                  aria-pressed={b.finalsMode === o.value}
                  onClick={() => setBuilder(setFinalsMode(b, o.value, teamCount))}
                >
                  <i className="rd" aria-hidden="true" />
                  <div>
                    <b>{o.label}</b>
                    <span>{o.help}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
          {b.finals.map((r, i) => (
            <RoundEditor
              key={r.id}
              builder={b}
              round={r}
              teamCount={teamCount}
              onChange={(next) => setRound(i, next)}
              onRemove={b.finalsMode === 'tiers' && b.finals.length > 2 ? () => removeRound(i) : undefined}
            />
          ))}
          {b.finalsMode === 'tiers' && b.finals.length < MAX_FINAL_ROUNDS && (
            <div>
              <button type="button" className="btn" onClick={() => setBuilder(addFinalRound(b, teamCount))}>
                <Icon name="plus" />
                Weitere Endrunde
              </button>
            </div>
          )}
          {b.finalsMode !== 'none' && (
            <div className="stack tight">
              {anyKo && (
                <label className="check">
                  <input type="checkbox" checked={b.thirdPlace} onChange={(e) => change({ thirdPlace: e.target.checked })} />
                  <span>Spiel um Platz 3</span>
                </label>
              )}
              {anyKo && b.thirdPlace && (
                <label className="check">
                  <input type="checkbox" checked={b.thirdPlacePenaltyOnly} onChange={(e) => change({ thirdPlacePenaltyOnly: e.target.checked })} />
                  <span>Spiel um Platz 3 nur als Neunmeterschießen</span>
                </label>
              )}
              {placementAvailable(b, teamCount) && (
                <label className="check">
                  <input type="checkbox" checked={b.placement} onChange={(e) => change({ placement: e.target.checked })} />
                  <span>Übrige Plätze in Platzierungsspielen ausspielen (3. A gegen 3. B …)</span>
                </label>
              )}
              {placementAvailable(b, teamCount) && b.placement && (
                <label className="check">
                  <input type="checkbox" checked={b.placementPenaltyOnly} onChange={(e) => change({ placementPenaltyOnly: e.target.checked })} />
                  <span>Platzierungsspiele nur als Neunmeterschießen</span>
                </label>
              )}
            </div>
          )}
          {b.finalsMode !== 'none' && (anyKoAll || b.placement) && (
            <div className="field">
              <label className="label" htmlFor="wz-draw">
                Unentschieden in der Endrunde
              </label>
              <select id="wz-draw" className="select" value={b.drawDecider} onChange={(e) => change({ drawDecider: e.target.value as DrawDecider })}>
                <option value="penalties">Direkt Neunmeterschießen</option>
                <option value="extra_time_then_penalties">Erst Verlängerung, dann Neunmeterschießen</option>
              </select>
            </div>
          )}
        </>
      )}
    </div>
  );

  if (b.prelim === 'swiss') return settings;
  return (
    <div className="wz-split">
      {settings}
      <Sketch preview={preview} builder={b} timeZone={draft.timeZone} fieldNames={draft.fields.map((f) => f.name)} />
    </div>
  );
}
