// Assistent „Turnier anlegen“ (Spezifikation §4.2), sechs Schritte, jederzeit zurück navigierbar.
import { useMemo, useState } from 'react';
import { useService } from '../../data/context';
import { uid } from '../../data/mockStore';
import type { WizardDraft } from '../../data/types';
import { navigate } from '../../router';
import { Icon } from '../../components/Icon';
import { Notice } from '../../components/ui';
import { StepAppearance, StepMode, StepOperation, StepParticipants, StepPublish, StepReview } from './steps';
import { validateStep, type StepErrors } from './validate';

const STEPS = ['Auftritt', 'Teilnehmer', 'Modus & Wertung', 'Spielbetrieb', 'Veröffentlichung', 'Prüfen'] as const;

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
    teams: Array.from({ length: 8 }, (_, i) => ({ id: uid('tm'), name: `Team ${i + 1}`, active: true })),
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
  const [step, setStep] = useState(0);
  const [visited, setVisited] = useState(0);
  const [errors, setErrors] = useState<StepErrors>({});
  const [saving, setSaving] = useState(false);

  const update = (patch: Partial<WizardDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const allErrors = useMemo(() => STEPS.map((_, i) => validateStep(i, draft)), [draft]);

  const goTo = (i: number) => {
    if (i > step) {
      const e = allErrors[step]!;
      if (Object.keys(e).length > 0) {
        setErrors(e);
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
    try {
      const id = await service.createTournament(draft, publish);
      navigate({ name: 'admin', id, tab: 'live' });
    } catch (e) {
      setSaving(false);
      throw e;
    }
  };

  const stepProps = { draft, update, errors };
  const errorCount = Object.keys(errors).length;

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Turnier anlegen</h1>
      </div>
      <nav className="steps" aria-label="Schritte">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            className={i !== step && i <= visited ? 'step done' : 'step'}
            aria-current={i === step ? 'step' : undefined}
            disabled={i > visited + 1}
            onClick={() => goTo(i)}
          >
            <span className="n">{i !== step && i <= visited ? <Icon name="check" /> : i + 1}</span>
            {label}
          </button>
        ))}
      </nav>

      {errorCount > 0 && (
        <Notice tone="warn" title="Da fehlt noch etwas" onClose={() => setErrors({})}>
          {Object.values(errors).join(' ')}
        </Notice>
      )}

      <div className="card stack" style={{ gap: 22 }}>
        <h2 className="section-title">{STEPS[step]}</h2>
        {step === 0 && <StepAppearance {...stepProps} />}
        {step === 1 && <StepParticipants {...stepProps} />}
        {step === 2 && <StepMode {...stepProps} />}
        {step === 3 && <StepOperation {...stepProps} />}
        {step === 4 && <StepPublish {...stepProps} />}
        {step === 5 && <StepReview {...stepProps} />}
      </div>

      <div className="wizard-foot">
        {step < STEPS.length - 1 ? (
          <button type="button" className="btn pri" onClick={() => goTo(step + 1)}>
            Weiter zu {STEPS[step + 1]}
          </button>
        ) : (
          <button type="button" className="btn pri" disabled={saving} onClick={() => save(true)}>
            {saving ? 'Speichert …' : 'Turnier veröffentlichen'}
          </button>
        )}
        {step > 0 && (
          <button type="button" className="btn" onClick={() => goTo(step - 1)}>
            Zurück zu {STEPS[step - 1]}
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
