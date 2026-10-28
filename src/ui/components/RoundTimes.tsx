// Zeitplan aller Runden: ungefähre Start- und Endzeiten, auch für Runden, die noch nicht gepaart sind.
import type { RoundStatus } from '../../domain';
import type { RoundTimeEstimate } from '../data/logic';
import { formatTime } from '../format';

function statusPill(r: RoundTimeEstimate, status: RoundStatus | undefined) {
  if (r.estimated) return <span className="pill">Paarungen folgen</span>;
  if (status === 'closed') return <span className="pill">Beendet</span>;
  if (status === 'active') return <span className="pill g">Läuft</span>;
  if (status === 'published') return <span className="pill a">Ausgelost</span>;
  return <span className="pill">Geplant</span>;
}

export function RoundTimes({
  rounds,
  statusOf,
  timeZone,
}: {
  rounds: RoundTimeEstimate[];
  statusOf: (roundNumber: number) => RoundStatus | undefined;
  timeZone: string;
}) {
  if (rounds.length === 0) return null;
  const anyEstimated = rounds.some((r) => r.estimated);
  return (
    <section className="section" aria-label="Zeitplan aller Runden">
      <div className="section-head">
        <h2 className="section-title">Zeitplan</h2>
        <span className="small-text">alle Runden</span>
      </div>
      <div className="list">
        {rounds.map((r) => (
          <div key={r.number} className="list-row" style={{ flexWrap: 'wrap' }}>
            <b style={{ minWidth: 72 }}>Runde {r.number}</b>
            <span className="grow" style={{ display: 'grid', gap: 2 }}>
              <span>
                {r.estimated ? 'ca. ' : ''}
                {formatTime(r.startISO, timeZone)} – {formatTime(r.endISO, timeZone)} Uhr
              </span>
              {r.waveStartISOs.length > 1 && (
                <span className="small-text">Anstöße {r.waveStartISOs.map((w) => formatTime(w, timeZone)).join(' · ')}</span>
              )}
            </span>
            {statusPill(r, statusOf(r.number))}
          </div>
        ))}
      </div>
      {anyEstimated && (
        <span className="small-text">
          Die Zeiten der kommenden Runden sind hochgerechnet. Sie können sich um ein paar Minuten verschieben, wenn es vorher länger dauert.
        </span>
      )}
    </section>
  );
}
