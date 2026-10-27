import { useMemo } from 'react';
import type { TournamentData } from '../../data/types';
import { computeStandings } from '../../data/logic';
import type { AdminTab } from '../../router';
import { formatDateShort } from '../../format';
import { TournamentStatusPill } from '../../components/ui';
import { StandingsTable, type TeamInfo } from '../../components/StandingsTable';
import { LiveTab } from './LiveTab';
import { ScheduleTab } from './ScheduleTab';
import { TeamsTab } from './TeamsTab';
import { SettingsTab } from './SettingsTab';
import { HistoryTab } from './HistoryTab';

export interface AdminCtx {
  data: TournamentData;
  teamInfo: Map<string, TeamInfo>;
  teamName: (id: string) => string;
  teamLogo: (id: string) => string | undefined;
  fieldName: (id?: string) => string;
}

export function useAdminCtx(data: TournamentData): AdminCtx {
  return useMemo(() => {
    const teamInfo = new Map<string, TeamInfo>(
      data.teams.map((t) => [t.id, { name: t.name, status: t.status, logo: t.logoAssetId ? data.assets[t.logoAssetId] : undefined }]),
    );
    const fields = new Map(data.fields.map((f) => [f.id, f.name]));
    return {
      data,
      teamInfo,
      teamName: (id) => teamInfo.get(id)?.name ?? 'Unbekannt',
      teamLogo: (id) => teamInfo.get(id)?.logo,
      fieldName: (id) => (id ? (fields.get(id) ?? 'Feld') : 'Ohne Feld'),
    };
  }, [data]);
}

const TAB_TITLE: Record<AdminTab, string> = {
  live: 'Live',
  spielplan: 'Spielplan',
  tabelle: 'Tabelle',
  teams: 'Teams',
  einstellungen: 'Einstellungen',
  verlauf: 'Verlauf',
};

export function AdminTournament({ data, tab }: { data: TournamentData; tab: AdminTab }) {
  const ctx = useAdminCtx(data);
  const t = data.tournament;
  return (
    <div className="page">
      <div className="page-head">
        <div className="stack tight" style={{ minWidth: 0 }}>
          <span className="small-text">
            {t.title} · {formatDateShort(t.localDate)}
          </span>
          <h1 className="page-title">{TAB_TITLE[tab]}</h1>
        </div>
        <TournamentStatusPill status={t.status} />
      </div>
      {tab === 'live' && <LiveTab ctx={ctx} />}
      {tab === 'spielplan' && <ScheduleTab ctx={ctx} />}
      {tab === 'tabelle' && <StandingsSection ctx={ctx} />}
      {tab === 'teams' && <TeamsTab ctx={ctx} />}
      {tab === 'einstellungen' && <SettingsTab ctx={ctx} />}
      {tab === 'verlauf' && <HistoryTab ctx={ctx} />}
    </div>
  );
}

function StandingsSection({ ctx }: { ctx: AdminCtx }) {
  const rows = useMemo(() => computeStandings(ctx.data), [ctx.data]);
  const showBuchholz = ctx.data.tournament.ranking.tieBreakers.includes('buchholz');
  const hasWithdrawn = rows.some((r) => !r.eligible);
  return (
    <div className="section">
      <div className="row no-print">
        <button type="button" className="btn" onClick={() => window.print()}>
          Drucken
        </button>
      </div>
      <StandingsTable rows={rows} teams={ctx.teamInfo} showBuchholz={showBuchholz} />
      <p className="small-text">
        Sortiert nach Punkten pro Spiel, dann {ctx.data.tournament.ranking.tieBreakers.length > 0 ? 'nach Feinwertung' : 'nach Name'}.
        {hasWithdrawn && ' Zurückgezogene Teams stehen am Ende, ihre Spiele zählen für niemanden.'}
      </p>
    </div>
  );
}
