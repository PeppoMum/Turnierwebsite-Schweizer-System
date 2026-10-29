// Assistent „Turnier anlegen“ (Spezifikation §4.2) mit Turnier-Baukasten (docs/turnier-baukasten.md).
// Schritte: Grunddaten, Turnierform, Mannschaften, Gruppen auslosen (nur bei Gruppen), Felder und Zeiten,
// Vorschau. Jederzeit zurück navigierbar. Schweizer System läuft wie bisher ohne `format`.
import { useMemo, useState } from 'react';
import { checkGroupAssignment } from '../../../domain/groups';
import { useService } from '../../data/context';
import { uid } from '../../data/mockStore';
import type { WizardDraft } from '../../data/types';
import { navigate } from '../../router';
import { Icon } from '../../components/Icon';
import { Notice } from '../../components/ui';
import { defaultBuilder, type BuilderState } from './builder';
import { createFormatTournament } from './create';
import { currentGroups, initialDraw, type DrawState } from './draw';
import { DrawStep } from './DrawStep';
import { FormatStep } from './FormatStep';
import { StepPreviewFormat, StepTimesFormat } from './formatSteps';
import { activeTeams, buildPreview } from './preview';
import { StepAppearance, StepOperation, StepParticipants, StepPublish, StepReview } from './steps';
import { validateStep, type StepErrors, type StepId } from './validate';
import './wizard.css';

const STEP_LABEL: Record<StepId, string> = {
  basics: 'Grunddaten',
  format: 'Turnierform',
  teams: 'Mannschaften',
  draw: 'Gruppen auslosen',
  times: 'Felder und Zeiten',
  preview: 'Vorschau',
};

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function emptyDraft(): WizardDraft {
  return {
    id: uid('t'),
    title: '',
    organizerName: '',
    venue: '',
    localDate: today(),
    timeZone: 'Europe/Berlin',
    sponsors: [],
    teams: Array.from({ length: 8 }, (_, i) => ({
      id: uid('tm'),
      name: `Team ${i + 1}`,
      active: true,
    })),
    roundsTotal: 5,
    preDrawRounds: 1,
    pairingMode: 'balanced',
    tieBreakers: ['head_to_head', 'goal_diff', 'goals_for'],
    buchholzEnabled: false,
    fields: [
      { id: uid('f'), name: 'Platz 1' },
      { id: uid('f'), name: 'Platz 2' },
    ],
    startTime: '10:00',
    matchMinutes: 12,
    turnoverMinutes: 3,
    roundBreakMinutes: 5,
    restOptimization: true,
    hardRestMinutes: null,
    allocation: 'max_capacity',
    visibility: 'full',
  };
}

export function Wizard() {
  const service = useService();
  const [draft, setDraft] = useState<WizardDraft>(emptyDraft);
  const [builder, setBuilder] = useState<BuilderState>(defaultBuilder);
  const [draw, setDraw] = useState<DrawState>(initialDraw);
  const [step, setStep] = useState(0);
  const [visited, setVisited] = useState(0);
  const [errors, setErrors] = useState<StepErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const update = (patch: Partial<WizardDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const swiss = builder.prelim === 'swiss';
  const steps: StepId[] = ['basics', 'format', 'teams', ...(builder.prelim === 'groups' ? (['draw'] as const) : []), 'times', 'preview'];
  const current = steps[Math.min(step, steps.length - 1)]!;

  const teamIds = useMemo(() => activeTeams(draft).map((t) => t.id), [draft]);
  const groups = useMemo(() => {
    if (builder.prelim === 'league') return [teamIds];
    if (builder.prelim !== 'groups' || teamIds.length < 2 * builder.groupCount) return null;
    return currentGroups(draw, teamIds, {
      groupCount: builder.groupCount,
      groupSizes: builder.groupSizes,
    });
  }, [builder.prelim, builder.groupCount, builder.groupSizes, draw, teamIds]);
  const preview = useMemo(() => buildPreview(draft, builder, draw, groups ?? undefined), [draft, builder, draw, groups]);
  const drawErrors = useMemo(() => {
    if (builder.prelim !== 'groups' || !groups) return [];
    return checkGroupAssignment(groups, {
      teamIds,
      groupCount: builder.groupCount,
      groupSizes: builder.groupSizes ?? undefined,
    }).errors;
  }, [builder, groups, teamIds]);
  const ctx = { builder, builderErrors: preview.check.errors, drawErrors };
  const allErrors = steps.map((id) => validateStep(id, draft, ctx));

  const goTo = (i: number) => {
    if (i > step) {
      const bad = allErrors.slice(step, i).findIndex((e) => Object.keys(e).length > 0);
      if (bad >= 0) {
        setStep(step + bad);
        setErrors(allErrors[step + bad]!);
        return;
      }
    }
    setErrors({});
    setStep(i);
    setVisited((v) => Math.max(v, i));
    window.scrollTo(0, 0);
  };

  const save = async (publish: boolean) => {
    const firstBad = allErrors.findIndex((e) => Object.keys(e).length > 0);
    if (firstBad >= 0) {
      setStep(firstBad);
      setErrors(allErrors[firstBad]!);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const id = swiss
        ? await service.createTournament({ ...draft, format: undefined, groupDraws: undefined }, publish)
        : await createFormatTournament(service, draft, builder, draw, groups ?? [], publish);
      navigate({ name: 'admin', id, tab: 'live' });
    } catch (e) {
      setSaving(false);
      setSaveError(e instanceof Error ? e.message : 'Das Speichern hat nicht geklappt. Bitte versuch es noch einmal.');
    }
  };

  const stepProps = { draft, update, errors };
  const formatProps = { ...stepProps, builder, setBuilder, preview };
  const errorCount = Object.keys(errors).length;
  const isLast = step === steps.length - 1;

  return (
    <div className="page wz">
      <div className="page-head">
        <h1 className="page-title">Turnier anlegen</h1>
      </div>
      <nav className="steps" aria-label="Schritte">
        {steps.map((id, i) => (
          <button
            key={id}
            type="button"
            className={i !== step && i <= visited ? 'step done' : 'step'}
            aria-current={i === step ? 'step' : undefined}
            disabled={i > visited + 1}
            onClick={() => goTo(i)}
          >
            <span className="n">{i !== step && i <= visited ? <Icon name="check" /> : i + 1}</span>
            {STEP_LABEL[id]}
          </button>
        ))}
      </nav>
      <span className="phone-only small-text">
        Schritt {step + 1} von {steps.length}
      </span>

      {errorCount > 0 && (
        <Notice tone="warn" title="Da fehlt noch etwas" onClose={() => setErrors({})}>
          {Object.values(errors).join(' ')}
        </Notice>
      )}
      {saveError && (
        <Notice tone="warn" title="Nicht gespeichert" onClose={() => setSaveError(null)}>
          {saveError}
        </Notice>
      )}

      {current === 'format' ? (
        <>
          <h2 className="section-title">{STEP_LABEL[current]}</h2>
          <FormatStep {...formatProps} />
        </>
      ) : (
        <div className="card stack" style={{ gap: 22 }}>
          <h2 className="section-title">{STEP_LABEL[current]}</h2>
          {current === 'basics' && <StepAppearance {...stepProps} />}
          {current === 'teams' && <StepParticipants {...stepProps} swiss={swiss} />}
          {current === 'draw' && groups && <DrawStep draft={draft} builder={builder} draw={draw} setDraw={setDraw} groups={groups} />}
          {current === 'draw' && !groups && <span className="muted">Für diese Gruppenzahl gibt es zu wenige Mannschaften.</span>}
          {current === 'times' && (swiss ? <StepOperation {...stepProps} /> : <StepTimesFormat {...formatProps} />)}
          {current === 'preview' && swiss && (
            <>
              <StepPublish {...stepProps} />
              <StepReview {...stepProps} />
            </>
          )}
          {current === 'preview' && !swiss && <StepPreviewFormat {...formatProps} groups={groups} />}
        </div>
      )}

      <div className="wizard-foot">
        {!isLast ? (
          <button type="button" className="btn pri" onClick={() => goTo(step + 1)}>
            Weiter zu {STEP_LABEL[steps[step + 1]!]}
          </button>
        ) : (
          <button type="button" className="btn pri" disabled={saving} onClick={() => save(true)}>
            {saving ? 'Speichert …' : 'Turnier veröffentlichen'}
          </button>
        )}
        {step > 0 && (
          <button type="button" className="btn" onClick={() => goTo(step - 1)}>
            Zurück zu {STEP_LABEL[steps[step - 1]!]}
          </button>
        )}
        <span className="spacer phone-hide" />
        <button type="button" className="btn" disabled={saving} onClick={() => save(false)}>
          Als Entwurf speichern
        </button>
      </div>
    </div>
  );
}
