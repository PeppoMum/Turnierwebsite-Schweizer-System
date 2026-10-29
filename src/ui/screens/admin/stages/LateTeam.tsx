// Ein Team ist zum Anpfiff noch nicht da (Paket U2, Turnier umstellen). Die Turnierleitung wählt:
// das Spiel mit einem späteren Spiel derselben Gruppe tauschen (Uhrzeit und Feld) oder es kampflos
// 2:0 für den Gegner werten. Das späte Team bleibt in beiden Fällen im Turnier. Beides steht im
// Verlauf und lässt sich dort zurücknehmen.
import { useMemo, useState } from 'react';
import type { Match } from '../../../../domain';
import { WALKOVER_GOALS } from '../../../../domain/groups';
import { laterSwapOptions } from '../../../../domain/schedule';
import { useService } from '../../../data/context';
import type { TournamentData } from '../../../data/types';
import { formatTime } from '../../../format';
import { Dialog } from '../../../components/ui';
import { editableMatches, scheduleCheckOptions } from './model';

export function LateTeamDialog({
  data,
  match,
  nameA,
  nameB,
  onClose,
}: {
  data: TournamentData;
  match: Match;
  nameA: string;
  nameB: string;
  onClose: () => void;
}) {
  const service = useService();
  const t = data.tournament;
  const [late, setLate] = useState<'A' | 'B'>('A');
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lateName = late === 'A' ? nameA : nameB;
  const oppName = late === 'A' ? nameB : nameA;
  const lateId = late === 'A' ? match.teamAId : match.teamBId;
  const teamName = (id: string) => data.teams.find((x) => x.id === id)?.name ?? 'Ein Team';
  const fieldName = (id: string) => data.fields.find((f) => f.id === id)?.name ?? 'Feld';

  const swaps = useMemo(() => {
    if (match.status !== 'scheduled') return [];
    const r = laterSwapOptions(editableMatches(data), match.id, lateId, scheduleCheckOptions(data));
    return r.ok ? r.options : [];
  }, [data, match.id, match.status, lateId]);
  const chosen = swaps.find((s) => s.matchId === pick) ?? swaps[0];

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
      setBusy(false);
    }
  };

  const other = (id: string) => {
    const m = data.matches.find((x) => x.id === id);
    return m ? `${teamName(m.teamAId)} – ${teamName(m.teamBId)}` : 'ein anderes Spiel';
  };

  return (
    <Dialog title="Ein Team ist noch nicht da" onClose={onClose}>
      <div className="field">
        <span className="label">Wer fehlt?</span>
        <div className="stack tight" role="radiogroup" aria-label="Wer fehlt?">
          {(['A', 'B'] as const).map((side) => (
            <label key={side} className="check">
              <input
                type="radio"
                name={`late-${match.id}`}
                checked={late === side}
                onChange={() => {
                  setLate(side);
                  setPick(null);
                }}
              />
              <span>{side === 'A' ? nameA : nameB}</span>
            </label>
          ))}
        </div>
      </div>

      {match.status === 'scheduled' && (
        <section className="stack tight">
          <h3 className="section-title">Spiel nach hinten tauschen</h3>
          {swaps.length === 0 ? (
            <p className="small-text">In dieser Gruppe gibt es kein späteres Spiel, mit dem sich tauschen lässt, ohne dass ein Team zwei Spiele gleichzeitig hätte.</p>
          ) : (
            <>
              <p className="small-text">
                {lateName} spielt dann später. Das andere Spiel rückt auf diese Uhrzeit vor.
              </p>
              <div className="stack tight" role="radiogroup" aria-label="Tauschen mit">
                {swaps.map((s) => (
                  <label key={s.matchId} className="check">
                    <input type="radio" name={`late-swap-${match.id}`} checked={chosen?.matchId === s.matchId} onChange={() => setPick(s.matchId)} />
                    <span>
                      Mit {other(s.matchId)}: neu {formatTime(s.startISO, t.timeZone)} Uhr auf {fieldName(s.fieldId)} ({s.delayMinutes} Min. später)
                    </span>
                  </label>
                ))}
              </div>
              {chosen && chosen.earlyTeamIds.length > 0 && (
                <span className="small-text">
                  Achtung: {chosen.earlyTeamIds.map(teamName).join(' und ')} {chosen.earlyTeamIds.length === 1 ? 'spielt' : 'spielen'} dann früher als bisher
                  geplant und {chosen.earlyTeamIds.length === 1 ? 'ist' : 'sind'} vielleicht noch nicht da.
                </span>
              )}
              {chosen?.issues.map((i) => (
                <span key={i.message} className="small-text">
                  Hinweis: {i.message}
                </span>
              ))}
              <div className="row">
                <button type="button" className="btn pri" disabled={busy || !chosen} onClick={() => chosen && run(() => service.swapMatches(t.id, match.id, chosen.matchId))}>
                  Spiele tauschen
                </button>
              </div>
            </>
          )}
        </section>
      )}

      <section className="stack tight">
        <h3 className="section-title">Kampflos werten</h3>
        <p className="small-text">
          {oppName} gewinnt {WALKOVER_GOALS}:0. In der Tabelle zählt das wie ein normales Ergebnis. {lateName} bleibt im Turnier und spielt seine
          weiteren Spiele ganz normal.
        </p>
        <div className="row">
          <button type="button" className="btn" disabled={busy} onClick={() => run(() => service.recordWalkover(t.id, match.id, late === 'A' ? 'B' : 'A'))}>
            {WALKOVER_GOALS}:0 für {oppName} werten
          </button>
        </div>
      </section>

      {error && <span className="field-error">{error}</span>}
      <p className="small-text">Beides kannst du im Verlauf wieder rückgängig machen.</p>
      <div className="row">
        <button type="button" className="btn" onClick={onClose}>
          Abbrechen
        </button>
      </div>
    </Dialog>
  );
}
