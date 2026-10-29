// Spielkarte im Cockpit: Ergebnis eingeben speichert sofort, „Spiel beenden“ ist ein eigener Schritt.
import { useState } from 'react';
import type { Match, NotPlayedReason } from '../../../domain';
import { useService } from '../../data/context';
import { formatTime } from '../../format';
import { Icon } from '../../components/Icon';
import { Dialog, MatchStatusPill, Notice, TeamName } from '../../components/ui';
import type { TournamentData } from '../../data/types';
import { FinalsResultDialog, type FinalsRules } from './stages/FinalsResultDialog';
import { LateTeamDialog } from './stages/LateTeam';

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
  canCorrect = true,
  title,
  nameA,
  nameB,
  finals,
  resultLabel,
  correctWarning,
  lateTeamData,
}: {
  tid: string;
  match: Match;
  teamName: (id: string) => string;
  teamLogo: (id: string) => string | undefined;
  fieldName: string;
  timeZone: string;
  quickMode: boolean;
  locked?: boolean;
  /** false: beendete Spiele nicht wieder öffnen (Ergebnis-Helfer dürfen das nicht). */
  canCorrect?: boolean;
  /** Baukasten: Abschnitt und Spiel, z. B. „Endrunde · Halbfinale 1“. */
  title?: string;
  /** Baukasten: Anzeigenamen, auch für Platzhalter wie „1. Gruppe A“. */
  nameA?: string;
  nameB?: string;
  /** Baukasten: Endrunden-Spiel, beenden geht nur mit Sieger (Verlängerung, Neunmeter). */
  finals?: FinalsRules;
  /** Fertiger Ergebnistext für beendete Spiele, z. B. „1:1, 4:3 n. N.“. */
  resultLabel?: string;
  /** Hinweis vor dem Korrigieren, z. B. wenn die Endrunde schon gefüllt ist. */
  correctWarning?: string | null;
  /** Baukasten, nur Turnierleitung: Knopf „Team fehlt“ (nach hinten tauschen oder kampflos werten). */
  lateTeamData?: TournamentData;
}) {
  const service = useService();
  const [notPlayedOpen, setNotPlayedOpen] = useState(false);
  const [reason, setReason] = useState<NotPlayedReason>('no_show');
  const [error, setError] = useState<string | null>(null);
  const [draftA, setDraftA] = useState(match.goalsA ?? 0);
  const [draftB, setDraftB] = useState(match.goalsB ?? 0);
  const [finalsOpen, setFinalsOpen] = useState(false);
  const [correctOpen, setCorrectOpen] = useState(false);
  const [lateOpen, setLateOpen] = useState(false);
  const shownA = nameA ?? teamName(match.teamAId);
  const shownB = nameB ?? teamName(match.teamBId);
  const teamsKnown = Boolean(match.teamAId && match.teamBId);

  const ga = match.goalsA ?? 0;
  const gb = match.goalsB ?? 0;
  const editable = !locked && teamsKnown && (match.status === 'live' || match.status === 'scheduled');
  /** Endrunde: ohne klaren Sieger nach regulärer Zeit geht es über das Fenster mit Verlängerung/Neunmeter. */
  const needsDecider = (a: number, b: number) => Boolean(finals && (finals.penaltyOnly || a === b));

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
    <article className={match.status === 'live' ? 'match live' : 'match'} aria-label={`${shownA} gegen ${shownB}`}>
      {title && <span className="match-title">{title}</span>}
      <div className="match-meta">
        <span style={{ fontWeight: 600, color: 'var(--tx)' }}>{fieldName}</span>
        <span>{formatTime(match.startISO, timeZone)}</span>
        <span className="spacer" />
        <MatchStatusPill status={match.status} />
      </div>

      {editable && !quickMode && match.status === 'live' && finals?.penaltyOnly ? (
        <div className="match-teams">
          <TeamName name={shownA} logo={teamLogo(match.teamAId)} muted={!match.teamAId} />
          <span className="score" />
          <TeamName name={shownB} logo={teamLogo(match.teamBId)} muted={!match.teamBId} />
          <span className="score" />
        </div>
      ) : editable && !quickMode && match.status === 'live' ? (
        <div className="score-entry">
          <TeamName name={shownA} logo={teamLogo(match.teamAId)} muted={!match.teamAId} />
          <ScoreStepper label={shownA} value={ga} onChange={(n) => setScore(n, gb)} />
          <TeamName name={shownB} logo={teamLogo(match.teamBId)} muted={!match.teamBId} />
          <ScoreStepper label={shownB} value={gb} onChange={(n) => setScore(ga, n)} />
        </div>
      ) : editable && quickMode && !finals?.penaltyOnly ? (
        <div className="score-entry">
          <TeamName name={shownA} logo={teamLogo(match.teamAId)} muted={!match.teamAId} />
          <ScoreStepper label={shownA} value={draftA} onChange={setDraftA} />
          <TeamName name={shownB} logo={teamLogo(match.teamBId)} muted={!match.teamBId} />
          <ScoreStepper label={shownB} value={draftB} onChange={setDraftB} />
        </div>
      ) : (
        <div className="match-teams">
          <TeamName name={shownA} logo={teamLogo(match.teamAId)} muted={!match.teamAId} />
          <span className={`score ${match.status === 'completed' && ga < gb ? 'lose' : ''}`}>{match.status === 'completed' || match.status === 'live' ? ga : ''}</span>
          <TeamName name={shownB} logo={teamLogo(match.teamBId)} muted={!match.teamBId} />
          <span className={`score ${match.status === 'completed' && gb < ga ? 'lose' : ''}`}>{match.status === 'completed' || match.status === 'live' ? gb : ''}</span>
        </div>
      )}

      {resultLabel && match.status === 'completed' && match.decidedBy !== 'walkover' && resultLabel !== `${ga}:${gb}` && (
        <span className="small-text result-note">{resultLabel}</span>
      )}
      {!teamsKnown && match.status === 'scheduled' && <span className="small-text">Die Teams stehen noch nicht fest.</span>}
      {match.decidedBy === 'walkover' &&
        (match.status === 'completed' ? (
          <span className="small-text">
            Kampflos gewertet: {match.walkoverWinner === 'B' ? shownA : shownB} war nicht da und bleibt im Turnier.
          </span>
        ) : (
          <span className="small-text">Kampflos gewertet: Der Gegner hat zurückgezogen.</span>
        ))}
      {match.status === 'not_played' && match.decidedBy !== 'walkover' && (
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
                needsDecider(draftA, draftB)
                  ? run(async () => {
                      if (!finals?.penaltyOnly) await service.recordScore(tid, match.id, draftA, draftB);
                      setFinalsOpen(true);
                    })
                  : run(async () => {
                      await service.recordScore(tid, match.id, draftA, draftB);
                      await service.setMatchStatus(tid, match.id, 'completed');
                    })
              }
            >
              {finals?.penaltyOnly ? 'Neunmeterschießen eintragen' : needsDecider(draftA, draftB) ? `${draftA}:${draftB}, weiter zum Neunmeterschießen` : `${draftA}:${draftB} speichern und beenden`}
            </button>
          )}
          {!quickMode && editable && match.status === 'scheduled' && (
            <button type="button" className="btn pri" onClick={() => run(() => service.setMatchStatus(tid, match.id, 'live'))}>
              Anpfiff
            </button>
          )}
          {!quickMode && editable && match.status === 'live' && (
            <button
              type="button"
              className="btn pri"
              onClick={() => (needsDecider(ga, gb) ? setFinalsOpen(true) : run(() => service.setMatchStatus(tid, match.id, 'completed')))}
            >
              {finals?.penaltyOnly ? 'Neunmeterschießen eintragen' : 'Spiel beenden'}
            </button>
          )}
          {!quickMode && editable && match.status === 'live' && finals?.extraTime && !finals.penaltyOnly && ga !== gb && (
            <button type="button" className="btn" onClick={() => setFinalsOpen(true)}>
              Nach Verlängerung beenden
            </button>
          )}
          {editable && !finals && lateTeamData && match.stageId && (
            <button type="button" className="btn" onClick={() => setLateOpen(true)}>
              <Icon name="clock" />
              Team fehlt
            </button>
          )}
          {editable && !finals && (
            <button type="button" className="btn" onClick={() => setNotPlayedOpen(true)}>
              Nicht ausgetragen
            </button>
          )}
          {canCorrect && (match.status === 'completed' || match.status === 'not_played') && (
            <button type="button" className="btn" onClick={() => (correctWarning ? setCorrectOpen(true) : run(() => service.reopenMatch(tid, match.id)))}>
              <Icon name="edit" />
              Korrigieren
            </button>
          )}
        </div>
      )}

      {finalsOpen && finals && (
        <FinalsResultDialog tid={tid} match={match} nameA={shownA} nameB={shownB} rules={finals} onClose={() => setFinalsOpen(false)} />
      )}

      {lateOpen && lateTeamData && (
        <LateTeamDialog data={lateTeamData} match={match} nameA={shownA} nameB={shownB} onClose={() => setLateOpen(false)} />
      )}

      {correctOpen && (
        <Dialog title="Ergebnis korrigieren?" onClose={() => setCorrectOpen(false)}>
          <Notice tone="hint" title="Die Endrunde ist schon gefüllt">
            {correctWarning}
          </Notice>
          <div className="row">
            <button
              type="button"
              className="btn pri"
              onClick={() =>
                run(async () => {
                  await service.reopenMatch(tid, match.id);
                  setCorrectOpen(false);
                })
              }
            >
              Trotzdem korrigieren
            </button>
            <button type="button" className="btn" onClick={() => setCorrectOpen(false)}>
              Abbrechen
            </button>
          </div>
        </Dialog>
      )}

      {notPlayedOpen && (
        <Dialog title="Spiel nicht ausgetragen" onClose={() => setNotPlayedOpen(false)}>
          <p>
            {shownA} gegen {shownB} zählt dann für beide Teams nicht: kein Spiel, keine Punkte, keine Tore. Auch nicht für das Team, das da war.
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
