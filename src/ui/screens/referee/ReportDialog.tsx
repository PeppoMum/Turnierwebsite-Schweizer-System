// Ergebnis als Schiri melden. Die Meldung zählt erst, wenn die Turnierleitung sie übernimmt.
import { useState } from 'react';
import type { Match } from '../../../domain';
import { useService } from '../../data/context';
import type { RefereeReport } from '../../data/types';
import { Dialog, Notice } from '../../components/ui';
import type { FinalsRules } from '../admin/stages/FinalsResultDialog';

function NumberBox({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <input
      className="input num"
      style={{ width: 64, textAlign: 'center' }}
      inputMode="numeric"
      aria-label={label}
      value={String(value)}
      onChange={(e) => onChange(Math.min(99, Number(e.target.value.replace(/\D/g, '') || 0)))}
    />
  );
}

export function ReportDialog({
  tid,
  match,
  myId,
  nameA,
  nameB,
  finals,
  initial,
  onClose,
}: {
  tid: string;
  match: Match;
  myId: string;
  nameA: string;
  nameB: string;
  finals?: FinalsRules;
  initial?: RefereeReport;
  onClose: () => void;
}) {
  const service = useService();
  const penaltyOnly = Boolean(finals?.penaltyOnly);
  const [goalsA, setGoalsA] = useState(penaltyOnly ? 0 : (initial?.goalsA ?? match.goalsA ?? 0));
  const [goalsB, setGoalsB] = useState(penaltyOnly ? 0 : (initial?.goalsB ?? match.goalsB ?? 0));
  const [extra, setExtra] = useState(initial?.decidedBy === 'extra_time');
  const [penA, setPenA] = useState(initial?.penaltiesA ?? 0);
  const [penB, setPenB] = useState(initial?.penaltiesB ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const penalties = Boolean(finals) && (penaltyOnly || goalsA === goalsB);
  const preview = penalties
    ? penaltyOnly
      ? `${penA}:${penB} im Neunmeterschießen`
      : `${goalsA}:${goalsB}, ${penA}:${penB} im Neunmeterschießen`
    : `${goalsA}:${goalsB}${finals && extra ? ' nach Verlängerung' : ''}`;
  const ready = !penalties || penA !== penB;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await service.reportRefereeResult(tid, match.id, {
        refereeId: myId,
        goalsA,
        goalsB,
        ...(finals
          ? penalties
            ? { decidedBy: 'penalties' as const, penaltiesA: penA, penaltiesB: penB }
            : { decidedBy: extra ? ('extra_time' as const) : ('regular' as const) }
          : {}),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
      setBusy(false);
    }
  };

  return (
    <Dialog title="Ergebnis melden" onClose={onClose}>
      <p style={{ margin: 0 }}>Die Turnierleitung sieht deine Meldung sofort und übernimmt sie mit einem Klick. Erst dann zählt das Ergebnis.</p>
      <div className="finals-grid">
        <span className="finals-head" />
        {!penaltyOnly && <span className="finals-head">Tore</span>}
        {penalties && <span className="finals-head">Neunmeter</span>}
        <span className="finals-name">{nameA}</span>
        {!penaltyOnly && <NumberBox label={`Tore ${nameA}`} value={goalsA} onChange={setGoalsA} />}
        {penalties && <NumberBox label={`Neunmeter ${nameA}`} value={penA} onChange={setPenA} />}
        <span className="finals-name">{nameB}</span>
        {!penaltyOnly && <NumberBox label={`Tore ${nameB}`} value={goalsB} onChange={setGoalsB} />}
        {penalties && <NumberBox label={`Neunmeter ${nameB}`} value={penB} onChange={setPenB} />}
      </div>
      {finals?.extraTime && !penaltyOnly && !penalties && (
        <label className="check">
          <input type="checkbox" checked={extra} onChange={(e) => setExtra(e.target.checked)} />
          <span>Nach Verlängerung entschieden</span>
        </label>
      )}
      {finals && !penaltyOnly && penalties && (
        <span className="small-text">
          In der Endrunde braucht es einen Sieger. {finals.extraTime ? 'Tore nach der Verlängerung eintragen, dann das Neunmeterschießen.' : 'Trag das Neunmeterschießen ein.'}
        </span>
      )}
      <Notice tone="info" title={ready ? `Meldung: ${preview}` : 'Beim Neunmeterschießen muss es einen Sieger geben.'} />
      {error && <span className="field-error">{error}</span>}
      <div className="row">
        <button type="button" className="btn pri" disabled={busy || !ready} onClick={save}>
          {busy ? 'Speichert …' : 'Melden'}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Abbrechen
        </button>
      </div>
    </Dialog>
  );
}
