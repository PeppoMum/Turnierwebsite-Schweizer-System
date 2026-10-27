import type { StandingRow } from '../data/types';
import { formatQuotient, formatSigned } from '../format';
import { QuotientInfo, BuchholzInfo } from './rules';
import { TeamName } from './ui';

export interface TeamInfo {
  name: string;
  logo?: string;
  status: string;
}

/** Tabelle nach Quotient. Kompakt zeigt am Handy nur die wichtigsten Spalten. */
export function StandingsTable({
  rows,
  teams,
  showBuchholz,
  highlightTeamId,
  compact,
}: {
  rows: StandingRow[];
  teams: Map<string, TeamInfo>;
  showBuchholz: boolean;
  highlightTeamId?: string;
  compact?: boolean;
}) {
  const hide = compact ? 'phone-hide' : undefined;
  return (
    <div className="table-box">
      <table className="table">
        <thead>
          <tr>
            <th className="l sticky-col" scope="col">
              #&nbsp;&nbsp;Team
            </th>
            <th scope="col" title="Spiele">Sp.</th>
            <th scope="col" className={hide} title="Siege, Remis, Niederlagen">
              S/U/N
            </th>
            <th scope="col" className={hide} title="Tore">Tore</th>
            <th scope="col" title="Tordifferenz">Diff.</th>
            <th scope="col">Pkt.</th>
            <th scope="col">
              <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                Quotient <QuotientInfo />
              </span>
            </th>
            <th scope="col" className={hide} title="Freilose">Freil.</th>
            {showBuchholz && (
              <th scope="col" className={hide}>
                <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                  Buchh. <BuchholzInfo />
                </span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const t = teams.get(r.teamId);
            const cls = [!r.eligible ? 'dim' : '', r.teamId === highlightTeamId ? 'mine' : ''].filter(Boolean).join(' ');
            return (
              <tr key={r.teamId} className={cls || undefined}>
                <td className="l sticky-col" style={{ maxWidth: 260 }}>
                  <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', maxWidth: '100%' }}>
                    <span style={{ width: 20, textAlign: 'right', fontWeight: 700 }}>{r.eligible ? r.rank : '–'}</span>
                    <TeamName name={t?.name ?? '?'} logo={t?.logo} muted={!r.eligible} />
                    {!r.eligible && <span className="pill o">zurückgezogen</span>}
                  </span>
                </td>
                <td>{r.played}</td>
                <td className={hide}>
                  {r.wins}/{r.draws}/{r.losses}
                </td>
                <td className={hide}>
                  {r.goalsFor}:{r.goalsAgainst}
                </td>
                <td>{formatSigned(r.goalDiff)}</td>
                <td>{r.points}</td>
                <td style={{ fontWeight: 700 }}>{formatQuotient(r.quotient)}</td>
                <td className={hide}>{r.byes}</td>
                {showBuchholz && <td className={hide}>{r.buchholz ?? '–'}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
