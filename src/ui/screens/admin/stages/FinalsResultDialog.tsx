// Ergebnis eines Endrunden-Spiels mit Verlängerung oder Neunmeterschießen eintragen und das Spiel beenden.
import { useState } from 'react';
import type { Match } from '../../../../domain';
import { useService } from '../../../data/context';
import type { KnockoutResult } from '../../../data/types';
import { Dialog, Notice } from '../../../components/ui';

export interface FinalsRules {
  /** Spiel besteht nur aus Neunmeterschießen. */
  penaltyOnly: boolean;
  /** Bei Unentschieden erst Verlängerung (sonst direkt Neunmeter). */
  extraTime: boolean;
}

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

export function FinalsResultDialog({
  tid,
  match,
  nameA,
  nameB,
  rules,
  onClose,
}: {
  tid: string;
  match: Match;
  nameA: string;
  nameB: string;
  rules: FinalsRules;
  onClose: () => void;
}) {
  const service = useService();
  const [goalsA, setGoalsA] = useState(rules.penaltyOnly ? 0 : (match.goalsA ?? 0));
  const [goalsB, setGoalsB] = useState(rules.penaltyOnly ? 0 : (match.goalsB ?? 0));
  const [extra, setExtra] = useState(match.decidedBy === 'extra_time');
  const [penA, setPenA] = useState(match.penaltiesA ?? 0);
  const [penB, setPenB] = useState(match.penaltiesB ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const draw = rules.penaltyOnly || goalsA === goalsB;
  const result: KnockoutResult = draw
    ? { goalsA, goalsB, decidedBy: 'penalties', penaltiesA: penA, penaltiesB: penB }
    : { goalsA, goalsB, decidedBy: extra ? 'extra_time' : 'regular' };
  const preview = draw
    ? rules.penaltyOnly
      ? `${penA}:${penB} n. N.`
      : `${goalsA}:${goalsB}, ${penA}:${penB} n. N.`
    : `${goalsA}:${goalsB}${extra ? ' n. V.' : ''}`;
  const winner = draw ? (penA === penB ? null : penA > penB ? nameA : nameB) : goalsA > goalsB ? nameA : nameB;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await service.finishKnockoutMatch(tid, match.id, result);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
      setBusy(false);
    }
  };

  return (
    <Dialog title={rules.penaltyOnly ? 'Neunmeterschießen eintragen' : 'Endrunden-Spiel beenden'} onClose={onClose}>
      <p style={{ margin: 0 }}>
        {rules.penaltyOnly
          ? 'Dieses Spiel wird nur per Neunmeterschießen entschieden. Trag die Treffer ein.'
          : 'In der Endrunde braucht es einen Sieger. Steht es unentschieden, trägst du auch das Neunmeterschießen ein.'}
      </p>
      <div className="finals-grid">
        <span className="finals-head" />
        {!rules.penaltyOnly && <span className="finals-head">Tore</span>}
        {draw && <span className="finals-head">Neunmeter</span>}
        <span className="finals-name">{nameA}</span>
        {!rules.penaltyOnly && <NumberBox label={`Tore ${nameA}`} value={goalsA} onChange={setGoalsA} />}
        {draw && <NumberBox label={`Neunmeter ${nameA}`} value={penA} onChange={setPenA} />}
        <span className="finals-name">{nameB}</span>
        {!rules.penaltyOnly && <NumberBox label={`Tore ${nameB}`} value={goalsB} onChange={setGoalsB} />}
        {draw && <NumberBox label={`Neunmeter ${nameB}`} value={penB} onChange={setPenB} />}
      </div>
      {!rules.penaltyOnly && !draw && rules.extraTime && (
        <label className="check">
          <input type="checkbox" checked={extra} onChange={(e) => setExtra(e.target.checked)} />
          <span>Nach Verlängerung entschieden (Anzeige „n. V.“)</span>
        </label>
      )}
      {!rules.penaltyOnly && draw && rules.extraTime && (
        <span className="small-text">Tore nach der Verlängerung eintragen. Steht es dann noch gleich, entscheidet das Neunmeterschießen.</span>
      )}
      <Notice tone="info" title={winner ? `Ergebnis: ${preview}` : 'Beim Neunmeterschießen muss es einen Sieger geben.'}>
        {winner ? `${winner} kommt weiter.` : undefined}
      </Notice>
      {error && <span className="field-error">{error}</span>}
      <div className="row">
        <button type="button" className="btn pri" disabled={busy || !winner} onClick={save}>
          {busy ? 'Speichert …' : 'Speichern und beenden'}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Abbrechen
        </button>
      </div>
    </Dialog>
  );
}
