// Spielkarte im Cockpit: Ergebnis eingeben speichert sofort, „Spiel beenden“ ist ein eigener Schritt.
import { useState } from 'react';
import type { Match, NotPlayedReason } from '../../../domain';
import { useService } from '../../data/context';
import { formatTime } from '../../format';
import { Icon } from '../../components/Icon';
import { Dialog, MatchStatusPill, TeamName } from '../../components/ui';

const REASONS: Array<{ value: NotPlayedReason; label: string }> = [
  { value: 'no_show', label: 'Team nicht erschienen' },
  { value: 'withdrawal', label: 'Team zurückgezogen' },
  { value: 'cancellation', label: 'Abgesagt' },
  { value: 'other', label: 'Anderer Grund' },
];

function ScoreStepper({ label, value, onChange, disabled }: { label: string; value: number; onChange: (n: number) => void; disabled?: boolean }) {
  // Während der Eingabe eigener Text, sonst immer der gespeicherte Wert.
  const [editing, setEditing] = useState<string | null>(null);
  const text = editing ?? String(value);
  return (
    <div className="stepper">
      <button type="button" className="btn sq" aria-label={`${label}: ein Tor weniger`} disabled={disabled || value <= 0} onClick={() => onChange(value - 1)}>
        <Icon name="minus" />
      </button>
      <input
        className="input"
        inputMode="numeric"
        aria-label={`Tore ${label}`}
        value={text}
        disabled={disabled}
        onChange={(e) => setEditing(e.target.value.replace(/\D/g, '').slice(0, 2))}
        onBlur={() => {
          const n = Number(text);
          if (text !== '' && Number.isInteger(n) && n !== value) onChange(n);
          setEditing(null);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <button type="button" className="btn sq" aria-label={`${label}: ein Tor mehr`} disabled={disabled} onClick={() => onChange(value + 1)}>
        <Icon name="plus" />
      </button>
    </div>
  );
}

export function MatchCard({
  tid,
  match,
  teamName,
  teamLogo,
  fieldName,
  timeZone,
  quickMode,
  locked,
}: {
  tid: string;
  match: Match;
  teamName: (id: string) => string;
  teamLogo: (id: string) => string | undefined;
  fieldName: string;
  timeZone: string;
  quickMode: boolean;
  locked?: boolean;
}) {
  const service = useService();
  const [notPlayedOpen, setNotPlayedOpen] = useState(false);
  const [reason, setReason] = useState<NotPlayedReason>('no_show');
  const [error, setError] = useState<string | null>(null);
  const [draftA, setDraftA] = useState(match.goalsA ?? 0);
  const [draftB, setDraftB] = useState(match.goalsB ?? 0);

  const ga = match.goalsA ?? 0;
  const gb = match.goalsB ?? 0;
  const editable = !locked && (match.status === 'live' || match.status === 'scheduled');

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
    }
  };

  const setScore = (a: number, b: number) => run(() => service.recordScore(tid, match.id, a, b));

  return (
    <article className={match.status === 'live' ? 'match live' : 'match'} aria-label={`${teamName(match.teamAId)} gegen ${teamName(match.teamBId)}`}>
      <div className="match-meta">
        <span style={{ fontWeight: 600, color: 'var(--tx)' }}>{fieldName}</span>
        <span>{formatTime(match.startISO, timeZone)}</span>
        <span className="spacer" />
        <MatchStatusPill status={match.status} />
      </div>

      {editable && !quickMode && match.status === 'live' ? (
        <div className="score-entry">
          <TeamName name={teamName(match.teamAId)} logo={teamLogo(match.teamAId)} />
          <ScoreStepper label={teamName(match.teamAId)} value={ga} onChange={(n) => setScore(n, gb)} />
          <TeamName name={teamName(match.teamBId)} logo={teamLogo(match.teamBId)} />
          <ScoreStepper label={teamName(match.teamBId)} value={gb} onChange={(n) => setScore(ga, n)} />
        </div>
      ) : editable && quickMode ? (
        <div className="score-entry">
          <TeamName name={teamName(match.teamAId)} logo={teamLogo(match.teamAId)} />
          <ScoreStepper label={teamName(match.teamAId)} value={draftA} onChange={setDraftA} />
          <TeamName name={teamName(match.teamBId)} logo={teamLogo(match.teamBId)} />
          <ScoreStepper label={teamName(match.teamBId)} value={draftB} onChange={setDraftB} />
        </div>
      ) : (
        <div className="match-teams">
          <TeamName name={teamName(match.teamAId)} logo={teamLogo(match.teamAId)} />
          <span className={`score ${match.status === 'completed' && ga < gb ? 'lose' : ''}`}>{match.status === 'completed' || match.status === 'live' ? ga : ''}</span>
          <TeamName name={teamName(match.teamBId)} logo={teamLogo(match.teamBId)} />
          <span className={`score ${match.status === 'completed' && gb < ga ? 'lose' : ''}`}>{match.status === 'completed' || match.status === 'live' ? gb : ''}</span>
        </div>
      )}

      {match.status === 'not_played' && (
        <span className="small-text">Grund: {REASONS.find((r) => r.value === match.notPlayedReason)?.label ?? 'nicht angegeben'}. Zählt für keins der beiden Teams.</span>
      )}
      {error && <span className="field-error">{error}</span>}

      {!locked && (
        <div className="match-actions">
          {quickMode && editable && (
            <button
              type="button"
              className="btn pri"
              onClick={() =>
                run(async () => {
                  await service.recordScore(tid, match.id, draftA, draftB);
                  await service.setMatchStatus(tid, match.id, 'completed');
                })
              }
            >
              {draftA}:{draftB} speichern und beenden
            </button>
          )}
          {!quickMode && match.status === 'scheduled' && (
            <button type="button" className="btn pri" onClick={() => run(() => service.setMatchStatus(tid, match.id, 'live'))}>
              Anpfiff
            </button>
          )}
          {!quickMode && match.status === 'live' && (
            <button type="button" className="btn pri" onClick={() => run(() => service.setMatchStatus(tid, match.id, 'completed'))}>
              Spiel beenden
            </button>
          )}
          {editable && (
            <button type="button" className="btn" onClick={() => setNotPlayedOpen(true)}>
              Nicht ausgetragen
            </button>
          )}
          {(match.status === 'completed' || match.status === 'not_played') && (
            <button type="button" className="btn" onClick={() => run(() => service.reopenMatch(tid, match.id))}>
              <Icon name="edit" />
              Korrigieren
            </button>
          )}
        </div>
      )}

      {notPlayedOpen && (
        <Dialog title="Spiel nicht ausgetragen" onClose={() => setNotPlayedOpen(false)}>
          <p>
            {teamName(match.teamAId)} gegen {teamName(match.teamBId)} zählt dann für beide Teams nicht: kein Spiel, keine Punkte, keine Tore. Auch nicht für das Team, das da war.
          </p>
          <div className="field">
            <span className="label">Grund</span>
            <div className="stack tight" role="radiogroup" aria-label="Grund">
              {REASONS.map((r) => (
                <label key={r.value} className="check">
                  <input type="radio" name={`reason-${match.id}`} checked={reason === r.value} onChange={() => setReason(r.value)} />
                  <span>{r.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="row">
            <button
              type="button"
              className="btn pri"
              onClick={() =>
                run(async () => {
                  await service.markNotPlayed(tid, match.id, reason);
                  setNotPlayedOpen(false);
                })
              }
            >
              Als nicht ausgetragen speichern
            </button>
            <button type="button" className="btn" onClick={() => setNotPlayedOpen(false)}>
              Abbrechen
            </button>
          </div>
        </Dialog>
      )}
    </article>
  );
}
