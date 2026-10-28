import type { Match } from '../../../domain';
import { formatTime } from '../../format';
import { EmptyState, MatchStatusPill, TeamName } from '../../components/ui';
import { ScheduleFilter, matchesFilter, useScheduleFilter } from '../../components/ScheduleFilter';
import { RoundTimes } from '../../components/RoundTimes';
import { roundTimes } from '../../data/logic';
import { groupByWave } from './LiveTab';
import type { AdminCtx } from './AdminTournament';

function hasScore(m: Match): boolean {
  return m.status === 'completed' || m.status === 'live';
}

function scoreA(m: Match): string {
  return hasScore(m) ? String(m.goalsA ?? 0) : m.status === 'not_played' ? 'n. a.' : '';
}

function scoreB(m: Match): string {
  return hasScore(m) ? String(m.goalsB ?? 0) : '';
}

export function ScheduleTab({ ctx }: { ctx: AdminCtx }) {
  const { data } = ctx;
  const t = data.tournament;
  const [filter, setFilter] = useScheduleFilter();
  const allRounds = [...data.rounds].sort((a, b) => a.number - b.number);
  const rounds = allRounds.filter((r) => filter.round === null || r.number === filter.round);
  const teams = data.teams.map((tm) => ({ id: tm.id, name: tm.name, logo: ctx.teamLogo(tm.id) }));
  const status = new Map(allRounds.map((r) => [r.number, r.status]));
  const timeline = <RoundTimes rounds={roundTimes(data)} statusOf={(n) => status.get(n)} timeZone={t.timeZone} />;
  if (allRounds.length === 0) {
    return (
      <>
        <EmptyState text="Hier erscheinen die Paarungen, sobald die erste Runde ausgelost ist." />
        {timeline}
      </>
    );
  }
  return (
    <>
      <div className="row no-print">
        <button type="button" className="btn" onClick={() => window.print()}>
          Drucken
        </button>
      </div>
      {timeline}
      <ScheduleFilter rounds={allRounds.map((r) => r.number)} teams={teams} value={filter} onChange={setFilter} />
      {rounds.map((r) => {
        const bye = data.byes.find((b) => b.roundId === r.id && (!filter.teamId || b.teamId === filter.teamId));
        const waves = groupByWave(data.matches.filter((m) => m.roundId === r.id && matchesFilter(filter, m)));
        return (
          <section key={r.id} className="section">
            <div className="section-head">
              <h2 className="section-title">Runde {r.number}</h2>
              <span className="small-text">{formatTime(r.plannedStartISO, t.timeZone)} Uhr</span>
            </div>
            {waves.length > 0 && (
              <>
              <div className="list phone-only">
                {waves.flatMap((w) =>
                  w.matches.map((m) => (
                    <div key={m.id} className="fixture">
                      <span className="when">
                        <b>{formatTime(m.startISO, t.timeZone)}</b>
                        {ctx.fieldName(m.fieldId)}
                      </span>
                      <TeamName name={ctx.teamName(m.teamAId)} logo={ctx.teamLogo(m.teamAId)} />
                      <span className="goals">{scoreA(m)}</span>
                      <TeamName name={ctx.teamName(m.teamBId)} logo={ctx.teamLogo(m.teamBId)} />
                      <span className="goals">{scoreB(m)}</span>
                    </div>
                  )),
                )}
              </div>
              <div className="table-box phone-hide">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="l">Zeit</th>
                      <th className="l">Feld</th>
                      <th className="l">Heim</th>
                      <th>Ergebnis</th>
                      <th className="l">Gast</th>
                      <th className="l">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {waves.flatMap((w) =>
                      w.matches.map((m) => (
                        <tr key={m.id}>
                          <td className="l">{formatTime(m.startISO, t.timeZone)}</td>
                          <td className="l">{ctx.fieldName(m.fieldId)}</td>
                          <td className="l">
                            <TeamName name={ctx.teamName(m.teamAId)} logo={ctx.teamLogo(m.teamAId)} />
                          </td>
                          <td style={{ fontWeight: 700 }}>
                            {m.status === 'completed' || m.status === 'live' ? `${m.goalsA ?? 0}:${m.goalsB ?? 0}` : m.status === 'not_played' ? 'n. a.' : '–'}
                          </td>
                          <td className="l">
                            <TeamName name={ctx.teamName(m.teamBId)} logo={ctx.teamLogo(m.teamBId)} />
                          </td>
                          <td className="l">
                            <MatchStatusPill status={m.status} />
                          </td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
              </>
            )}
            {bye && <span className="small-text">Freilos: {ctx.teamName(bye.teamId)}</span>}
            {waves.length === 0 && !bye && <span className="muted">{filter.teamId ? `${ctx.teamName(filter.teamId)} spielt in dieser Runde nicht.` : 'Keine Spiele.'}</span>}
          </section>
        );
      })}
      {t.currentRound < t.roundsTotal && (
        <p className="muted">
          Runde {t.currentRound + 1} bis {t.roundsTotal} werden nach dem jeweiligen Tabellenstand gepaart und erscheinen nach und nach.
        </p>
      )}
    </>
  );
}
