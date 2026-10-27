// Öffentliche Turnierseite (Spezifikation §4.4). Liest nur die öffentliche Projektion, nie die internen Daten.
import { useMemo, useState } from 'react';
import type { PublicMatch, PublicTournamentView } from '../../data/types';
import { formatDateShort, formatTime } from '../../format';
import { useNow, useOnline } from '../../hooks';
import type { PublicTab } from '../../router';
import { publicUrl } from '../../router';
import { Icon } from '../../components/Icon';
import { Crest, EmptyState, MatchStatusPill, Notice, ShareButton, TeamName, TournamentStatusPill } from '../../components/ui';
import { StandingsTable, type TeamInfo } from '../../components/StandingsTable';
import { formatQuotient } from '../../../domain/scoring/format';

const FAV_KEY = 'turnier-fav-';

interface Ctx {
  view: PublicTournamentView;
  teams: Map<string, TeamInfo>;
  field: (id?: string) => string;
  scores: boolean;
}

export function PublicTournament({ view, tab }: { view: PublicTournamentView; tab: PublicTab }) {
  const online = useOnline();
  const ctx = useMemo<Ctx>(() => {
    const teams = new Map<string, TeamInfo>(view.teams.map((t) => [t.id, { name: t.name, logo: t.logo, status: t.status }]));
    const fields = new Map(view.fields.map((f) => [f.id, f.name]));
    return { view, teams, field: (id) => (id ? (fields.get(id) ?? 'Feld') : ''), scores: view.tournament.visibility !== 'kids' };
  }, [view]);

  return (
    <>
      {tab === 'aktuell' && <BrandBand view={view} />}
      <div className="page">
        {!online && (
          <Notice tone="hint" title="Keine Verbindung">
            Du siehst den Stand von {formatTime(view.updatedAt, view.tournament.timeZone)} Uhr. Neue Ergebnisse kommen, sobald du wieder online bist.
          </Notice>
        )}
        {tab === 'aktuell' && <Current ctx={ctx} />}
        {tab === 'spielplan' && <Schedule ctx={ctx} />}
        {tab === 'team' && <MyTeam ctx={ctx} />}
        {tab === 'tabelle' && <Table ctx={ctx} />}
        <p className="small-text">Stand {formatTime(view.updatedAt, view.tournament.timeZone)} Uhr, aktualisiert sich von selbst.</p>
      </div>
    </>
  );
}

function BrandBand({ view }: { view: PublicTournamentView }) {
  const t = view.tournament;
  return (
    <header className="brand-band">
      <div className="inner">
        <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'center', gap: 14 }}>
          <Crest name={t.organizerName} logo={view.eventLogo ?? view.organizerLogo} large />
          <div className="stack tight" style={{ minWidth: 0 }}>
            <h1>{t.title}</h1>
          </div>
        </div>
        <div className="meta">
          <span>{t.organizerName}</span>
          <span>{formatDateShort(t.localDate)}</span>
          {t.venue && <span>{t.venue}</span>}
        </div>
        <div className="row">
          <TournamentStatusPill status={t.status} />
          {t.currentRound > 0 && (
            <span className="pill" style={{ background: '#1a1c21', color: '#c9ceda' }}>
              Runde {t.currentRound} von {t.roundsTotal}
            </span>
          )}
        </div>
        {view.sponsors.length > 0 && (
          <div className="sponsors" aria-label="Sponsoren">
            {view.sponsors.map((s) =>
              s.url ? (
                <a key={s.id} className="sponsor" href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.logo && <img src={s.logo} alt="" style={{ height: 22 }} />}
                  {s.name}
                </a>
              ) : (
                <span key={s.id} className="sponsor">
                  {s.logo && <img src={s.logo} alt="" style={{ height: 22 }} />}
                  {s.name}
                </span>
              ),
            )}
          </div>
        )}
      </div>
      <div className="stripe" aria-hidden>
        <i style={{ background: '#000', flex: 3 }} />
        <i style={{ background: 'var(--ac)', flex: 5 }} />
        <i style={{ background: '#fff', flex: 3 }} />
        <i style={{ background: '#FF3131', flex: 0.6 }} />
      </div>
    </header>
  );
}

function PublicMatchCard({ ctx, m, showRound }: { ctx: Ctx; m: PublicMatch; showRound?: boolean }) {
  const a = ctx.teams.get(m.teamAId);
  const b = ctx.teams.get(m.teamBId);
  const hasScore = ctx.scores && m.goalsA !== undefined && m.goalsB !== undefined;
  const done = m.status === 'completed';
  return (
    <article className={m.status === 'live' ? 'match live' : 'match'}>
      <div className="match-meta">
        <span style={{ fontWeight: 600, color: 'var(--tx)' }}>{ctx.field(m.fieldId)}</span>
        <span>{formatTime(m.startISO, ctx.view.tournament.timeZone)}</span>
        {showRound && <span>Runde {m.roundNumber}</span>}
        <span className="spacer" />
        <MatchStatusPill status={m.status} />
      </div>
      <div className="match-teams">
        <TeamName name={a?.name ?? '?'} logo={a?.logo} />
        {hasScore ? <span className={`score ${done && m.goalsA! < m.goalsB! ? 'lose' : ''}`}>{m.goalsA}</span> : <span />}
        <TeamName name={b?.name ?? '?'} logo={b?.logo} />
        {hasScore ? <span className={`score ${done && m.goalsB! < m.goalsA! ? 'lose' : ''}`}>{m.goalsB}</span> : <span />}
      </div>
    </article>
  );
}

function Current({ ctx }: { ctx: Ctx }) {
  const now = useNow(30000);
  const { view } = ctx;
  const live = view.matches.filter((m) => m.status === 'live');
  const upcoming = view.matches.filter((m) => m.status === 'scheduled').sort((a, b) => (a.startISO ?? '').localeCompare(b.startISO ?? ''));
  const nextStart = upcoming[0]?.startISO;
  const nextWave = upcoming.filter((m) => m.startISO === nextStart);
  const recent = view.matches
    .filter((m) => m.status === 'completed')
    .sort((a, b) => (b.startISO ?? '').localeCompare(a.startISO ?? ''))
    .slice(0, 6);
  const minutesToNext = nextStart ? Math.round((new Date(nextStart).getTime() - now) / 60000) : null;

  if (view.matches.length === 0) {
    return <EmptyState text="Die Paarungen erscheinen hier, sobald die Turnierleitung die erste Runde veröffentlicht." />;
  }

  return (
    <>
      <div className="row">
        <ShareButton url={publicUrl(view.tournament.id)} title={view.tournament.title} />
      </div>
      {live.length > 0 && (
        <section className="section">
          <h2 className="section-title">Läuft gerade</h2>
          <div className="grid">
            {live.map((m) => (
              <PublicMatchCard key={m.id} ctx={ctx} m={m} />
            ))}
          </div>
        </section>
      )}
      {nextWave.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Als Nächstes</h2>
            <span className="small-text">
              {nextStart && nextStart.slice(0, 10) !== new Date(now).toISOString().slice(0, 10) ? `${formatDateShort(view.tournament.localDate)}, ` : ''}
              {formatTime(nextStart, view.tournament.timeZone)} Uhr
              {minutesToNext !== null && minutesToNext > 0 && minutesToNext <= 90 ? `, in ${minutesToNext} Min.` : ''}
            </span>
          </div>
          <div className="grid">
            {nextWave.map((m) => (
              <PublicMatchCard key={m.id} ctx={ctx} m={m} />
            ))}
          </div>
        </section>
      )}
      {ctx.scores && recent.length > 0 && (
        <section className="section">
          <h2 className="section-title">Letzte Ergebnisse</h2>
          <div className="grid">
            {recent.map((m) => (
              <PublicMatchCard key={m.id} ctx={ctx} m={m} showRound />
            ))}
          </div>
        </section>
      )}
      {live.length === 0 && nextWave.length === 0 && (
        <EmptyState text={view.tournament.status === 'finished' ? 'Das Turnier ist beendet. Danke fürs Mitfiebern!' : 'Gerade läuft kein Spiel. Die nächste Runde erscheint hier, sobald sie feststeht.'} />
      )}
    </>
  );
}

function Schedule({ ctx }: { ctx: Ctx }) {
  const { view } = ctx;
  const rounds = [...view.rounds].sort((a, b) => a.number - b.number);
  return (
    <>
      <h1 className="page-title">Spielplan</h1>
      {rounds.length === 0 && <EmptyState text="Der Spielplan erscheint hier, sobald die erste Runde feststeht." />}
      {rounds.map((r) => {
        const bye = view.byes.find((b) => b.roundNumber === r.number);
        const ms = view.matches.filter((m) => m.roundNumber === r.number).sort((a, b) => (a.startISO ?? '').localeCompare(b.startISO ?? '') || (a.fieldId ?? '').localeCompare(b.fieldId ?? ''));
        return (
          <section key={r.number} className="section">
            <div className="section-head">
              <h2 className="section-title">Runde {r.number}</h2>
              <span className="small-text">{formatTime(r.plannedStartISO, view.tournament.timeZone)} Uhr</span>
            </div>
            <div className="grid">
              {ms.map((m) => (
                <PublicMatchCard key={m.id} ctx={ctx} m={m} />
              ))}
            </div>
            {bye && <span className="small-text">Freilos: {ctx.teams.get(bye.teamId)?.name}</span>}
          </section>
        );
      })}
      {view.tournament.currentRound < view.tournament.roundsTotal && (
        <p className="muted">Die nächsten Runden werden nach dem Zwischenstand ausgelost und erscheinen nach und nach.</p>
      )}
    </>
  );
}

function readFav(tid: string): string | null {
  try {
    return localStorage.getItem(FAV_KEY + tid);
  } catch {
    return null;
  }
}

function MyTeam({ ctx }: { ctx: Ctx }) {
  const { view } = ctx;
  const [fav, setFavState] = useState<string | null>(() => readFav(view.tournament.id));
  const [query, setQuery] = useState('');
  const setFav = (id: string | null) => {
    setFavState(id);
    try {
      if (id) localStorage.setItem(FAV_KEY + view.tournament.id, id);
      else localStorage.removeItem(FAV_KEY + view.tournament.id);
    } catch {
      // ohne Speicher bleibt die Wahl bis zum Neuladen
    }
  };
  const team = fav ? view.teams.find((t) => t.id === fav) : undefined;

  if (!team) {
    const q = query.trim().toLowerCase();
    const list = view.teams.filter((t) => !q || t.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    return (
      <>
        <h1 className="page-title">Mein Team</h1>
        <div className="field">
          <label className="label" htmlFor="team-search">
            Team suchen
          </label>
          <div style={{ position: 'relative' }}>
            <input id="team-search" className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name eingeben" style={{ paddingLeft: 38 }} />
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--mu)', display: 'flex' }}>
              <Icon name="search" />
            </span>
          </div>
        </div>
        {list.length === 0 ? (
          <EmptyState text="Kein Team gefunden. Probier einen anderen Namen." />
        ) : (
          <div className="list">
            {list.map((t) => (
              <button key={t.id} type="button" className="list-row menu-item" style={{ borderRadius: 0, minHeight: 48 }} onClick={() => setFav(t.id)}>
                <TeamName name={t.name} logo={t.logo} />
              </button>
            ))}
          </div>
        )}
        <p className="small-text">Dein Team merkt sich nur dieses Gerät. Du brauchst kein Konto.</p>
      </>
    );
  }

  const ms = view.matches
    .filter((m) => m.teamAId === team.id || m.teamBId === team.id)
    .sort((a, b) => (a.startISO ?? '').localeCompare(b.startISO ?? ''));
  const next = ms.filter((m) => m.status === 'scheduled' || m.status === 'live');
  const past = ms.filter((m) => m.status !== 'scheduled' && m.status !== 'live');
  const byes = view.byes.filter((b) => b.teamId === team.id);
  const row = view.standings?.find((r) => r.teamId === team.id);

  return (
    <>
      <div className="page-head">
        <div className="row" style={{ flexWrap: 'nowrap', minWidth: 0 }}>
          <Crest name={team.name} logo={team.logo} large />
          <h1 className="page-title">{team.name}</h1>
        </div>
        <button type="button" className="btn" onClick={() => setFav(null)}>
          Anderes Team
        </button>
      </div>
      {(team.status === 'withdrawn' || team.status === 'no_show') && <Notice tone="hint" title="Dieses Team spielt nicht mehr mit." />}
      {row && (
        <div className="kpis">
          <div className="kpi">
            <b>{row.rank !== null ? `${row.rank}.` : '–'}</b>
            <span>Platz</span>
          </div>
          <div className="kpi">
            <b>{formatQuotient(row.points, row.played)}</b>
            <span>Quotient</span>
          </div>
          <div className="kpi">
            <b>{row.points}</b>
            <span>Punkte aus {row.played} Spielen</span>
          </div>
        </div>
      )}
      <section className="section">
        <h2 className="section-title">Nächste Spiele</h2>
        {next.length === 0 ? (
          <span className="muted">Gerade steht kein Spiel an. Neue Runden erscheinen hier automatisch.</span>
        ) : (
          <div className="grid">
            {next.map((m) => (
              <PublicMatchCard key={m.id} ctx={ctx} m={m} showRound />
            ))}
          </div>
        )}
      </section>
      {past.length > 0 && (
        <section className="section">
          <h2 className="section-title">Gespielt</h2>
          <div className="grid">
            {past.map((m) => (
              <PublicMatchCard key={m.id} ctx={ctx} m={m} showRound />
            ))}
          </div>
        </section>
      )}
      {byes.length > 0 && <span className="small-text">Freilos in Runde {byes.map((b) => b.roundNumber).join(', ')}.</span>}
    </>
  );
}

function Table({ ctx }: { ctx: Ctx }) {
  const { view } = ctx;
  const fav = readFav(view.tournament.id) ?? undefined;
  if (!view.standings) return <EmptyState text="Für dieses Turnier gibt es keine öffentliche Tabelle." />;
  const showBuchholz = view.standings.some((r) => r.buchholz !== null);
  return (
    <>
      <h1 className="page-title">Tabelle</h1>
      <StandingsTable rows={view.standings} teams={ctx.teams} showBuchholz={showBuchholz} highlightTeamId={fav} compact />
      <p className="small-text">Sortiert nach Punkten pro gespieltem Spiel. Freilose und ausgefallene Spiele zählen nicht.</p>
    </>
  );
}
