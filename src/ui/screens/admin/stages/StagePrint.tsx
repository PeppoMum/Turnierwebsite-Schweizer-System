// Druckansicht für Turniere mit Gruppen und Endrunde: Spielplan, Gruppentabellen, Endrunde und
// Endplatzierung als schlichtes Blatt. Die Auswahl oben wird nicht mitgedruckt.
import { useMemo, useState } from 'react';
import type { Match } from '../../../../domain';
import { formatGoalDiff } from '../../../../domain/scoring/format';
import type { TournamentData } from '../../../data/types';
import { formatDateShort, formatTime } from '../../../format';
import { href } from '../../../router';
import { Icon } from '../../../components/Icon';
import { finalsRounds } from './StageTables';
import { buildStageModel, groupByTime, groupName, isFinalsStage, matchTitle, placementText, resultText, sideText, winnerSide } from './model';
import '../../../styles/print.css';

type Scores = 'with' | 'blank';

export function StagePrint({ data }: { data: TournamentData }) {
  const t = data.tournament;
  const model = useMemo(() => buildStageModel(data), [data]);
  const teams = useMemo(() => [...data.teams].filter((x) => x.status !== 'inactive').sort((a, b) => a.name.localeCompare(b.name, 'de')), [data.teams]);
  const anyResult = data.matches.some((m) => m.status === 'completed');
  const [showSchedule, setShowSchedule] = useState(true);
  const [showGroups, setShowGroups] = useState(anyResult);
  const [showFinals, setShowFinals] = useState(anyResult);
  const [showPlacement, setShowPlacement] = useState(t.status === 'finished' || t.status === 'archived');
  const [scores, setScores] = useState<Scores>(t.visibility === 'kids' ? 'blank' : 'with');
  const [stageId, setStageId] = useState('');
  const [teamId, setTeamId] = useState('');
  if (!model) return null;
  const format = model.format;

  const name = (id: string) => data.teams.find((x) => x.id === id)?.name ?? 'Unbekannt';
  const fieldName = (id?: string) => (id ? (data.fields.find((f) => f.id === id)?.name ?? 'Feld') : '–');
  const fieldOrder = (id?: string) => data.fields.find((f) => f.id === id)?.order ?? 99;
  const logo = (assetId?: string) => (assetId ? data.assets[assetId] : undefined);
  const crest = logo(t.organizerAssetId);
  const eventLogo = logo(t.eventAssetId);
  const ofTeam = (m: Match) => !teamId || m.teamAId === teamId || m.teamBId === teamId;
  const matches = data.matches.filter((m) => m.stageId && (!stageId || m.stageId === stageId) && ofTeam(m));
  const score = (m: Match) => {
    if (m.decidedBy === 'walkover') return resultText(m, format);
    if (m.status === 'not_played') return 'n. a.';
    if (scores === 'blank') return '___ : ___';
    return resultText(m, format) || '–';
  };
  const bold = (m: Match, side: 'A' | 'B') => {
    const id = side === 'A' ? m.teamAId : m.teamBId;
    return (teamId && id === teamId) || (scores === 'with' && winnerSide(m, format) === side && isFinalsStage(format.stages.find((s) => s.id === m.stageId)));
  };
  const stagesWithMatches = format.stages.filter((s) => data.matches.some((m) => m.stageId === s.id));

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
          <input type="checkbox" checked={showGroups} onChange={(e) => setShowGroups(e.target.checked)} /> Gruppen
        </label>
        <label className="check">
          <input type="checkbox" checked={showFinals} onChange={(e) => setShowFinals(e.target.checked)} /> Endrunde
        </label>
        <label className="check">
          <input type="checkbox" checked={showPlacement} onChange={(e) => setShowPlacement(e.target.checked)} /> Endplatzierung
        </label>
        <label className="check">
          Ergebnisse
          <select className="select" value={scores} onChange={(e) => setScores(e.target.value as Scores)}>
            <option value="with">eintragen wie gespielt</option>
            <option value="blank">leer zum Ausfüllen</option>
          </select>
        </label>
        <label className="check">
          Abschnitt
          <select className="select" value={stageId} onChange={(e) => setStageId(e.target.value)}>
            <option value="">alle</option>
            {stagesWithMatches.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
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

      {showSchedule && (
        <section className="print-round">
          <h2>Spielplan</h2>
          {matches.length === 0 ? (
            <p>Für diese Auswahl gibt es keine Spiele.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Zeit</th>
                  <th>Feld</th>
                  <th className="l">Spiel</th>
                  <th className="l">Heim</th>
                  <th>Ergebnis</th>
                  <th className="l">Gast</th>
                </tr>
              </thead>
              <tbody>
                {groupByTime(matches, fieldOrder).flatMap((s) =>
                  s.matches.map((m) => (
                    <tr key={m.id}>
                      <td>{formatTime(m.startISO, t.timeZone)}</td>
                      <td>{fieldName(m.fieldId)}</td>
                      <td className="l print-small">{matchTitle(m, format)}</td>
                      <td className={`l${bold(m, 'A') ? ' b' : ''}${m.teamAId ? '' : ' print-slot'}`}>{sideText(m, 'A', format, name)}</td>
                      <td className="score">{score(m)}</td>
                      <td className={`l${bold(m, 'B') ? ' b' : ''}${m.teamBId ? '' : ' print-slot'}`}>{sideText(m, 'B', format, name)}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          )}
        </section>
      )}

      {showGroups &&
        format.stages.map((stage) => {
          const st = model.standings[stage.id];
          if (!st || (stageId && stageId !== stage.id)) return null;
          return (
            <section key={stage.id} className="print-round">
              <h2>{stage.name}</h2>
              <div className="print-groups">
                {st.tables.map((table, gi) => (
                  <div key={gi} className="print-group">
                    <h3>
                      {st.tables.length === 1 ? stage.name : groupName(format, stage.id, gi)} <span>{st.groupComplete[gi] ? '' : '(läuft noch)'}</span>
                    </h3>
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
                        </tr>
                      </thead>
                      <tbody>
                        {table.rows.map((r) => (
                          <tr key={r.teamId} className={r.teamId === teamId ? 'b' : undefined}>
                            <td>{r.place}</td>
                            <td className="l">{name(r.teamId)}</td>
                            <td>{r.played}</td>
                            <td>{r.won}</td>
                            <td>{r.drawn}</td>
                            <td>{r.lost}</td>
                            <td>
                              {r.goalsFor}:{r.goalsAgainst}
                            </td>
                            <td>{formatGoalDiff(r.goalsFor - r.goalsAgainst)}</td>
                            <td>{r.points}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {table.unranked.length > 0 && <p className="print-note">Zurückgezogen: {table.unranked.map(name).join(', ')}</p>}
                  </div>
                ))}
              </div>
            </section>
          );
        })}

      {showFinals &&
        format.stages.filter(isFinalsStage).map((stage) => {
          if (stageId && stageId !== stage.id) return null;
          // Auf dem Blatt von links nach rechts in Spielreihenfolge.
          const first = (r: { matches: Match[] }) => r.matches[0];
          const rounds = finalsRounds(stage, data.matches).sort(
            (a, b) =>
              (first(a)?.startISO ?? '').localeCompare(first(b)?.startISO ?? '') ||
              (first(a)?.matchKey ?? '').localeCompare(first(b)?.matchKey ?? '', 'de', { numeric: true }),
          );
          if (rounds.length === 0) return null;
          return (
            <section key={stage.id} className="print-round">
              <h2>
                {stage.name}
                {stage.placeRange && (
                  <span>
                    {' '}
                    Platz {stage.placeRange.from}–{stage.placeRange.to}
                  </span>
                )}
              </h2>
              <div className="print-bracket">
                {rounds.map((r) => (
                  <div key={r.heading} className="print-bracket-col">
                    <h3>{r.heading}</h3>
                    {r.matches.map((m) => (
                      <div key={m.id} className="print-bracket-match">
                        <div className={bold(m, 'A') ? 'b' : m.teamAId ? '' : 'print-slot'}>{sideText(m, 'A', format, name)}</div>
                        <div className={bold(m, 'B') ? 'b' : m.teamBId ? '' : 'print-slot'}>{sideText(m, 'B', format, name)}</div>
                        <div className="print-small">
                          {formatTime(m.startISO, t.timeZone)} · {fieldName(m.fieldId)} · {score(m)}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          );
        })}

      {showPlacement && model.placements.placements.length > 0 && (
        <section className="print-round">
          <h2>Endplatzierung</h2>
          <table>
            <thead>
              <tr>
                <th>Platz</th>
                <th className="l">Mannschaft</th>
              </tr>
            </thead>
            <tbody>
              {model.placements.placements.map((p) => (
                <tr key={p.teamId} className={p.teamId === teamId ? 'b' : undefined}>
                  <td>{'placeFrom' in p ? placementText(p) : 'ausgeschieden'}</td>
                  <td className="l">{name(p.teamId)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {model.placements.open.length > 0 && <p className="print-note">Noch offen: {model.placements.open.map(name).join(', ')}</p>}
        </section>
      )}

      <footer className="print-foot">Stand: {new Intl.DateTimeFormat('de-DE', { timeZone: t.timeZone, dateStyle: 'short', timeStyle: 'short' }).format(new Date())} Uhr</footer>
    </div>
  );
}
