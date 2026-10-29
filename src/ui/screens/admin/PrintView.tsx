// Druckansicht (§2.2 „Export Spielplan/Ergebnisse/Tabelle als druckbare PDF“): eine schlichte Seite
// ohne App-Rahmen, die der Browser druckt oder als PDF speichert. Auswahl oben wird nicht gedruckt.
import { useMemo, useState } from 'react';
import type { Match } from '../../../domain';
import { formatGoalDiff, formatQuotient } from '../../../domain/scoring/format';
import { computeStandings } from '../../data/logic';
import type { TournamentData } from '../../data/types';
import { formatDateShort, formatTime } from '../../format';
import { href } from '../../router';
import { Icon } from '../../components/Icon';
import { groupByWave } from './LiveTab';
import { StagePrint } from './stages/StagePrint';
import '../../styles/print.css';
import { PrintCrest, teamCrest } from './printCrest';

type Scores = 'with' | 'blank';

function scoreText(m: Match, scores: Scores): string {
  if (m.status === 'not_played') return 'n. a.';
  if (scores === 'blank') return '___ : ___';
  if (m.status === 'completed' || m.status === 'live') return `${m.goalsA ?? 0} : ${m.goalsB ?? 0}`;
  return '–';
}

export function PrintView({ data }: { data: TournamentData }) {
  return data.tournament.format ? <StagePrint data={data} /> : <SwissPrint data={data} />;
}

function SwissPrint({ data }: { data: TournamentData }) {
  const t = data.tournament;
  const rounds = useMemo(() => [...data.rounds].sort((a, b) => a.number - b.number), [data.rounds]);
  const teams = useMemo(() => [...data.teams].filter((x) => x.status !== 'inactive').sort((a, b) => a.name.localeCompare(b.name, 'de')), [data.teams]);
  const [showSchedule, setShowSchedule] = useState(true);
  const [showTable, setShowTable] = useState(rounds.length > 0);
  // Im Kinderfußballmodus standardmäßig ohne Ergebnisse, damit der Aushang nichts verrät.
  const [scores, setScores] = useState<Scores>(t.visibility === 'kids' ? 'blank' : 'with');
  const [round, setRound] = useState<number | 'all'>('all');
  const [teamId, setTeamId] = useState<string>('');

  const name = (id: string) => data.teams.find((x) => x.id === id)?.name ?? 'Unbekannt';
  const teamMark = (id: string) => <PrintCrest logo={teamCrest(data, id)} />;
  const field = (id?: string) => (id ? (data.fields.find((f) => f.id === id)?.name ?? 'Feld') : '–');
  const logo = (assetId?: string) => (assetId ? data.assets[assetId] : undefined);
  const rows = useMemo(() => computeStandings(data), [data]);
  const shownRounds = rounds.filter((r) => round === 'all' || r.number === round);
  const ofTeam = (m: Match) => !teamId || m.teamAId === teamId || m.teamBId === teamId;
  const showBuchholz = t.ranking.tieBreakers.includes('buchholz');
  const crest = logo(t.organizerAssetId);
  const eventLogo = logo(t.eventAssetId);

  return (
    <div className="print-doc">
      <div className="print-controls no-print">
        <a className="btn" href={href({ name: 'admin', id: t.id, tab: 'spielplan' })}>
          <Icon name="left" />
          Zurück
        </a>
        <label className="check">
          <input type="checkbox" checked={showSchedule} onChange={(e) => setShowSchedule(e.target.checked)} /> Spielplan
        </label>
        <label className="check">
          <input type="checkbox" checked={showTable} onChange={(e) => setShowTable(e.target.checked)} /> Tabelle
        </label>
        <label className="check">
          Ergebnisse
          <select className="select" value={scores} onChange={(e) => setScores(e.target.value as Scores)}>
            <option value="with">eintragen wie gespielt</option>
            <option value="blank">leer zum Ausfüllen</option>
          </select>
        </label>
        <label className="check">
          Runde
          <select className="select" value={round} onChange={(e) => setRound(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
            <option value="all">alle</option>
            {rounds.map((r) => (
              <option key={r.id} value={r.number}>
                {r.number}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          Mannschaft
          <select className="select" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">alle</option>
            {teams.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn pri" onClick={() => window.print()}>
          <Icon name="print" />
          Drucken oder als PDF speichern
        </button>
        <span className="small-text" style={{ flexBasis: '100%' }}>
          Für eine PDF-Datei wählst du im Druckfenster als Drucker „Als PDF speichern“.
        </span>
      </div>

      <header className="print-head">
        {crest && <img src={crest} alt="" className="print-logo" />}
        <div className="grow">
          <h1>{t.title}</h1>
          <p>
            {t.organizerName} · {formatDateShort(t.localDate)}
            {t.venue ? ` · ${t.venue}` : ''}
          </p>
          {teamId && <p className="print-team">Spielplan für {name(teamId)}</p>}
        </div>
        {eventLogo && <img src={eventLogo} alt="" className="print-logo" />}
      </header>

      {showSchedule &&
        (shownRounds.length === 0 ? (
          <p>Es ist noch keine Runde ausgelost.</p>
        ) : (
          shownRounds.map((r) => {
            const matches = groupByWave(data.matches.filter((m) => m.roundId === r.id && ofTeam(m))).flatMap((w) => w.matches);
            const bye = data.byes.find((b) => b.roundId === r.id && (!teamId || b.teamId === teamId));
            if (matches.length === 0 && !bye) return null;
            return (
              <section key={r.id} className="print-round">
                <h2>
                  Runde {r.number} <span>ab {formatTime(r.plannedStartISO, t.timeZone)} Uhr</span>
                </h2>
                <table>
                  <thead>
                    <tr>
                      <th>Zeit</th>
                      <th>Feld</th>
                      <th className="l">Heim</th>
                      <th>Ergebnis</th>
                      <th className="l">Gast</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matches.map((m) => (
                      <tr key={m.id}>
                        <td>{formatTime(m.startISO, t.timeZone)}</td>
                        <td>{field(m.fieldId)}</td>
                        <td className={`l${m.teamAId === teamId ? ' b' : ''}`}>{teamMark(m.teamAId)}{name(m.teamAId)}</td>
                        <td className="score">{scoreText(m, scores)}</td>
                        <td className={`l${m.teamBId === teamId ? ' b' : ''}`}>{teamMark(m.teamBId)}{name(m.teamBId)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {bye && <p className="print-note">Freilos: {name(bye.teamId)}</p>}
              </section>
            );
          })
        ))}

      {showTable && (
        <section className="print-round print-table">
          <h2>
            Tabelle <span>nach Runde {t.currentRound}</span>
          </h2>
          <table>
            <thead>
              <tr>
                <th>Pl.</th>
                <th className="l">Mannschaft</th>
                <th>Sp.</th>
                <th>S</th>
                <th>U</th>
                <th>N</th>
                <th>Tore</th>
                <th>Diff.</th>
                <th>Pkt.</th>
                <th>Quote</th>
                {showBuchholz && <th>Buchh.</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.teamId} className={r.teamId === teamId ? 'b' : undefined}>
                  <td>{r.rank ?? '–'}</td>
                  <td className="l">
                    {teamMark(r.teamId)}
                    {r.name}
                    {!r.eligible && ' (zurückgezogen)'}
                  </td>
                  <td>{r.played}</td>
                  <td>{r.wins}</td>
                  <td>{r.draws}</td>
                  <td>{r.losses}</td>
                  <td>
                    {r.goalsFor}:{r.goalsAgainst}
                  </td>
                  <td>{formatGoalDiff(r.goalDiff)}</td>
                  <td>{r.points}</td>
                  <td>{formatQuotient(r.points, r.played)}</td>
                  {showBuchholz && <td>{r.buchholz === null ? '–' : r.buchholz.toLocaleString('de-DE', { maximumFractionDigits: 2 })}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="print-note">Sortiert nach Punkten pro Spiel (Quote), danach nach Feinwertung.</p>
        </section>
      )}

      <footer className="print-foot">Stand: {new Intl.DateTimeFormat('de-DE', { timeZone: t.timeZone, dateStyle: 'short', timeStyle: 'short' }).format(new Date())} Uhr</footer>
    </div>
  );
}
