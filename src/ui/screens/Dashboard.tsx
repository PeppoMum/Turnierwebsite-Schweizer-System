import { useState } from 'react';
import { useService, useTournaments } from '../data/context';
import type { TournamentData } from '../data/types';
import { formatDateShort } from '../format';
import { href, navigate, publicUrl } from '../router';
import { CopyButton, Crest, EmptyState, Seg, TournamentStatusPill } from '../components/ui';
import { Icon } from '../components/Icon';

type Filter = 'all' | 'active' | 'archived';

export function Dashboard() {
  const all = useTournaments();
  const [filter, setFilter] = useState<Filter>('active');
  const list = all
    .filter((d) => {
      const archived = d.tournament.status === 'archived';
      return filter === 'all' || (filter === 'archived' ? archived : !archived);
    })
    .sort((a, b) => b.tournament.localDate.localeCompare(a.tournament.localDate));

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Turniere</h1>
        <a className="btn pri" href={href({ name: 'create' })}>
          <Icon name="plus" />
          Turnier erstellen
        </a>
      </div>
      <div className="row">
        <Seg<Filter>
          label="Anzeigen"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'active', label: 'Aktiv' },
            { value: 'all', label: 'Alle' },
            { value: 'archived', label: 'Archiv' },
          ]}
        />
      </div>
      {list.length === 0 ? (
        <EmptyState
          text={filter === 'archived' ? 'Hier erscheinen archivierte Turniere.' : 'Hier erscheinen deine Turniere.'}
          action={
            filter !== 'archived' && (
              <a className="btn pri" href={href({ name: 'create' })}>
                Erstes Turnier anlegen
              </a>
            )
          }
        />
      ) : (
        <div className="grid">
          {list.map((d) => (
            <TournamentCard key={d.tournament.id} data={d} />
          ))}
        </div>
      )}
    </div>
  );
}

function TournamentCard({ data }: { data: TournamentData }) {
  const service = useService();
  const t = data.tournament;
  const activeTeams = data.teams.filter((x) => x.status === 'active').length;
  const logo = t.organizerAssetId ? data.assets[t.organizerAssetId] : undefined;
  const isPublic = t.status !== 'draft';
  return (
    <article className="card stack">
      <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <Crest name={t.organizerName || t.title} logo={logo} large />
        <div className="stack tight" style={{ flex: 1, minWidth: 0 }}>
          <a href={href({ name: 'admin', id: t.id, tab: 'live' })} style={{ color: 'inherit', textDecoration: 'none' }}>
            <h2 className="section-title" style={{ overflowWrap: 'anywhere' }}>
              {t.title}
            </h2>
          </a>
          <span className="small-text">
            {formatDateShort(t.localDate)}
            {t.venue ? ` · ${t.venue}` : ''}
          </span>
        </div>
        <TournamentStatusPill status={t.status} />
      </div>
      <dl className="summary" style={{ gridTemplateColumns: 'max-content 1fr' }}>
        <dt>Teams</dt>
        <dd>{activeTeams}</dd>
        <dt>Runde</dt>
        <dd>
          {t.currentRound} von {t.roundsTotal}
        </dd>
      </dl>
      <div className="row">
        <button type="button" className="btn" onClick={() => navigate({ name: 'admin', id: t.id, tab: 'live' })}>
          Öffnen
        </button>
        {isPublic && <CopyButton text={publicUrl(t.id)} />}
        <button
          type="button"
          className="btn sq"
          aria-label="Duplizieren"
          title="Duplizieren"
          onClick={async () => {
            const id = await service.duplicateTournament(t.id);
            navigate({ name: 'admin', id, tab: 'einstellungen' });
          }}
        >
          <Icon name="copy" />
        </button>
        <button
          type="button"
          className="btn sq"
          aria-label={t.status === 'archived' ? 'Wiederherstellen' : 'Archivieren'}
          title={t.status === 'archived' ? 'Wiederherstellen' : 'Archivieren'}
          onClick={() => service.setArchived(t.id, t.status !== 'archived')}
        >
          <Icon name="archive" />
        </button>
      </div>
    </article>
  );
}
