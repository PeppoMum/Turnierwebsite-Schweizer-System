// Öffentliche Turnierseite (Spezifikation §4.4). Liest nur die öffentliche Projektion, nie die internen Daten.
import { useMemo, useState } from 'react';
import type { PublicTournamentView, StandingRow } from '../../data/types';
import { formatDateShort, formatTime } from '../../format';
import { useNow, useOnline } from '../../hooks';
import type { PublicTab } from '../../router';
import { publicUrl } from '../../router';
import { Crest, EmptyState, Notice, ShareButton, TournamentStatusPill } from '../../components/ui';
import { StandingsTable, type TeamInfo } from '../../components/StandingsTable';
import { ScheduleFilter, matchesFilter, useScheduleFilter } from '../../components/ScheduleFilter';
import { TeamPicker } from '../../components/TeamPicker';
import { formatQuotient } from '../../../domain/scoring/format';
import { RoundTimes } from '../../components/RoundTimes';
import { publicRoundTimes } from '../../data/logic';
import { PublicMatchCard, TimeSlots } from './parts';
import { pickerTeams, sidesOf, type Ctx } from './ctx';
import { buildStageModel } from './stageView';
import { readFav, useFavorite } from './favorite';
import { Groups } from './Groups';
import { Finals } from './Finals';

function PublicRoundTimes({ view }: { view: PublicTournamentView }) {
  const times = useMemo(() => publicRoundTimes(view), [view]);
  const status = new Map(view.rounds.map((r) => [r.number, r.status]));
  return <RoundTimes rounds={times} statusOf={(n) => status.get(n)} timeZone={view.tournament.timeZone} />;
}

export function PublicTournament({ view, tab }: { view: PublicTournamentView; tab: PublicTab }) {
  const online = useOnline();
  const ctx = useMemo<Ctx>(() => {
    const teams = new Map<string, TeamInfo>(view.teams.map((t) => [t.id, { name: t.name, logo: t.logo, status: t.status }]));
    const fields = new Map(view.fields.map((f) => [f.id, f.name]));
    return {
      view,
      teams,
      field: (id) => (id ? (fields.get(id) ?? 'Feld') : ''),
      scores: view.tournament.visibility !== 'kids',
      model: buildStageModel(view),
    };
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
        {tab === 'spielplan' && (ctx.model ? <StageSchedule ctx={ctx} /> : <Schedule ctx={ctx} />)}
        {tab === 'team' && (ctx.model ? <StageMyTeam ctx={ctx} /> : <MyTeam ctx={ctx} />)}
        {tab === 'tabelle' && !ctx.model && <Table ctx={ctx} />}
        {tab === 'gruppen' && ctx.model && <Groups ctx={ctx} />}
        {tab === 'endrunde' && ctx.model && <Finals ctx={ctx} />}
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
    </header>
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
    return (
      <>
        <EmptyState text="Die Paarungen erscheinen hier, sobald die Turnierleitung die erste Runde veröffentlicht." />
        <PublicRoundTimes view={view} />
      </>
    );
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
  const [filter, setFilter] = useScheduleFilter();
  const allRounds = [...view.rounds].sort((a, b) => a.number - b.number);
  const rounds = allRounds.filter((r) => filter.round === null || r.number === filter.round);
  const teamName = filter.teamId ? ctx.teams.get(filter.teamId)?.name : undefined;
  return (
    <>
      <h1 className="page-title">Spielplan</h1>
      {allRounds.length === 0 && <EmptyState text="Die Paarungen erscheinen hier, sobald die erste Runde feststeht." />}
      <PublicRoundTimes view={view} />
      {allRounds.length > 0 && (
        <ScheduleFilter rounds={allRounds.map((r) => r.number)} teams={pickerTeams(view)} value={filter} onChange={setFilter} />
      )}
      {rounds.map((r) => {
        const byes = view.byes.filter((b) => b.roundNumber === r.number);
        const bye = byes.find((b) => !filter.teamId || b.teamId === filter.teamId);
        const ms = view.matches
          .filter((m) => m.roundNumber === r.number && matchesFilter(filter, m))
          .sort((a, b) => (a.startISO ?? '').localeCompare(b.startISO ?? '') || (a.fieldId ?? '').localeCompare(b.fieldId ?? ''));
        return (
          <section key={r.number} className="section">
            <div className="section-head">
              <h2 className="section-title">Runde {r.number}</h2>
              <span className="small-text">{formatTime(r.plannedStartISO, view.tournament.timeZone)} Uhr</span>
            </div>
            {ms.length > 0 && (
              <div className="grid">
                {ms.map((m) => (
                  <PublicMatchCard key={m.id} ctx={ctx} m={m} />
                ))}
              </div>
            )}
            {bye && <span className="small-text">Freilos: {ctx.teams.get(bye.teamId)?.name}</span>}
            {ms.length === 0 && !bye && <span className="muted">{teamName ? `${teamName} spielt in dieser Runde nicht.` : 'Keine Spiele.'}</span>}
          </section>
        );
      })}
      {view.tournament.currentRound < view.tournament.roundsTotal && (
        <p className="muted">Die nächsten Runden werden nach dem Zwischenstand ausgelost und erscheinen nach und nach.</p>
      )}
    </>
  );
}

function MyTeam({ ctx }: { ctx: Ctx }) {
  const { view } = ctx;
  const [fav, setFav] = useFavorite(view.tournament.id);
  const team = fav ? view.teams.find((t) => t.id === fav) : undefined;

  const picker = <TeamPicker label={team ? 'Anderes Team wählen' : 'Team wählen'} teams={pickerTeams(view)} value={fav} onChange={setFav} />;

  if (!team) {
    return (
      <>
        <h1 className="page-title">Mein Team</h1>
        {picker}
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
      </div>
      {picker}
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

/**
 * Tabelle vor dem ersten Ergebnis: Die veröffentlichte Tabelle entsteht erst mit dem ersten gewerteten
 * Spiel. Bis dahin stehen alle Teams ohne Platz und mit 0 Punkten da.
 */
function emptyStandings(view: PublicTournamentView): StandingRow[] {
  return view.teams
    .map((t) => ({
      teamId: t.id,
      name: t.name,
      status: t.status,
      rank: null,
      eligible: t.status === 'active',
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDiff: 0,
      points: 0,
      quotient: null,
      byes: view.byes.filter((b) => b.teamId === t.id).length,
      buchholz: null,
      decidedBy: null,
    }))
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.name.localeCompare(b.name, 'de'));
}

function Table({ ctx }: { ctx: Ctx }) {
  const { view } = ctx;
  const fav = readFav(view.tournament.id) ?? undefined;
  const anyResult = view.matches.some((m) => m.status === 'completed');
  const rows = view.standings ?? (anyResult ? undefined : emptyStandings(view));
  if (!rows) return <EmptyState text="Die Tabelle wird gerade aktualisiert und erscheint gleich." />;
  const showBuchholz = rows.some((r) => r.buchholz !== null);
  return (
    <>
      <h1 className="page-title">Tabelle</h1>
      {!view.standings && <span className="muted">Noch kein Spiel beendet. Die Plätze stehen fest, sobald die ersten Ergebnisse da sind.</span>}
      <StandingsTable rows={rows} teams={ctx.teams} showBuchholz={showBuchholz} highlightTeamId={fav} compact />
      <p className="small-text">Sortiert nach Punkten pro gespieltem Spiel. Freilose und ausgefallene Spiele zählen nicht.</p>
    </>
  );
}

/** Spielplan bei Turnieren mit Gruppen und Endrunde: nach Uhrzeit, eingrenzbar nach Abschnitt und Team. */
function StageSchedule({ ctx }: { ctx: Ctx }) {
  const { view } = ctx;
  const model = ctx.model!;
  const [stageId, setStageId] = useState<string>('');
  const [teamId, setTeamId] = useState<string | null>(null);
  const [fav] = useFavorite(view.tournament.id);
  const ms = view.matches
    .filter((m) => !stageId || m.stageId === stageId)
    .filter((m) => !teamId || sidesOf(ctx, m).some((s) => s.teamId === teamId));
  return (
    <>
      <h1 className="page-title">Spielplan</h1>
      {view.matches.length === 0 ? (
        <EmptyState text="Der Spielplan erscheint hier, sobald die Turnierleitung das Turnier veröffentlicht." />
      ) : (
        <>
          <div className="filters no-print">
            <div className="field">
              <label className="label" htmlFor="st-stage">
                Abschnitt
              </label>
              <select id="st-stage" className="select" value={stageId} onChange={(e) => setStageId(e.target.value)}>
                <option value="">Alle Abschnitte</option>
                {model.format.stages
                  .filter((s) => view.matches.some((m) => m.stageId === s.id))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </div>
            <TeamPicker label="Mannschaft" teams={pickerTeams(view)} value={teamId} onChange={setTeamId} allLabel="Alle Mannschaften" />
          </div>
          <TimeSlots ctx={ctx} matches={ms} fav={fav} />
          <p className="small-text">Kursive Namen in der Endrunde: Stand jetzt, noch nicht fest.</p>
        </>
      )}
    </>
  );
}

/** „Mein Team“ bei Turnieren mit Gruppen und Endrunde: Gruppe, Platz, nächste Spiele (auch „Stand jetzt“). */
function StageMyTeam({ ctx }: { ctx: Ctx }) {
  const { view } = ctx;
  const model = ctx.model!;
  const [fav, setFav] = useFavorite(view.tournament.id);
  const team = fav ? view.teams.find((t) => t.id === fav) : undefined;
  const picker = <TeamPicker label={team ? 'Anderes Team wählen' : 'Team wählen'} teams={pickerTeams(view)} value={fav} onChange={setFav} />;
  if (!team) {
    return (
      <>
        <h1 className="page-title">Mein Team</h1>
        {picker}
        <p className="small-text">Dein Team merkt sich nur dieses Gerät. Du brauchst kein Konto. Es wird dann in Gruppen, Endrunde und Spielplan hervorgehoben.</p>
      </>
    );
  }
  const own = view.matches
    .map((m) => ({ m, sides: sidesOf(ctx, m) }))
    .filter((x) => x.sides.some((s) => s.teamId === team.id))
    .sort((a, b) => (a.m.startISO ?? '').localeCompare(b.m.startISO ?? ''));
  const next = own.filter((x) => x.m.status === 'scheduled' || x.m.status === 'live');
  const past = own.filter((x) => x.m.status !== 'scheduled' && x.m.status !== 'live');
  // Neuester Gruppenabschnitt, in dem das Team steht.
  const table = [...model.tables.values()].reverse().find((t) => t.groups.some((g) => g.teamIds.includes(team.id)));
  const group = table?.groups.find((g) => g.teamIds.includes(team.id));
  const row = group?.rows.find((r) => r.teamId === team.id);
  const placement = model.placements().placements.find((p) => p.teamId === team.id);
  const showTable = view.tournament.visibility === 'full';
  return (
    <>
      <div className="page-head">
        <div className="row" style={{ flexWrap: 'nowrap', minWidth: 0 }}>
          <Crest name={team.name} logo={team.logo} large />
          <h1 className="page-title">{team.name}</h1>
        </div>
      </div>
      {picker}
      {(team.status === 'withdrawn' || team.status === 'no_show') && <Notice tone="hint" title="Dieses Team spielt nicht mehr mit." />}
      {(group || placement) && (
        <div className="kpis">
          {placement && (
            <div className="kpi">
              <b>{placement.placeFrom === placement.placeTo ? `${placement.placeFrom}.` : `${placement.placeFrom}.–${placement.placeTo}.`}</b>
              <span>Endplatz</span>
            </div>
          )}
          {group && table && (
            <div className="kpi">
              <b>{table.groups.length > 1 ? group.name : '–'}</b>
              <span>{table.groups.length > 1 ? `Gruppe (${table.stage.name})` : table.stage.name}</span>
            </div>
          )}
          {row && showTable && (
            <>
              <div className="kpi">
                <b>{row.place}.</b>
                <span>{group?.complete ? 'Platz in der Gruppe' : 'Platz, Stand jetzt'}</span>
              </div>
              <div className="kpi">
                <b>{row.points}</b>
                <span>Punkte aus {row.played} Spielen</span>
              </div>
            </>
          )}
        </div>
      )}
      <section className="section">
        <h2 className="section-title">Nächste Spiele</h2>
        {next.length === 0 ? (
          <span className="muted">Gerade steht kein Spiel an.</span>
        ) : (
          <div className="grid">
            {next.map(({ m }) => (
              <PublicMatchCard key={m.id} ctx={ctx} m={m} fav={fav} showRound />
            ))}
          </div>
        )}
      </section>
      {past.length > 0 && (
        <section className="section">
          <h2 className="section-title">Gespielt</h2>
          <div className="grid">
            {past.map(({ m }) => (
              <PublicMatchCard key={m.id} ctx={ctx} m={m} fav={fav} showRound />
            ))}
          </div>
        </section>
      )}
      <p className="small-text">{own.length} Spiele, davon {past.length} gespielt. Endrunden-Spiele mit „Stand jetzt“ können sich noch ändern.</p>
    </>
  );
}
