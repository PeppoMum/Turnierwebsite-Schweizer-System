// Schiri-Einteilung und Ergebnis-Meldungen, für Schiris (Schiri-Link) und die Turnierleitung (Reiter „Schiris“).
// Alles hier ist ein Angebot: Es ändert nie Spielplan, Spiele oder Tabelle. Nur „Übernehmen“ der
// Turnierleitung trägt ein gemeldetes Ergebnis als echtes Ergebnis ein.
import { useMemo, useState } from 'react';
import type { Match } from '../../../domain';
import { refereeClash, usualDuration } from '../../../domain/referees';
import { useService } from '../../data/context';
import { refereeMatches, reportState, reportText } from '../../data/referees';
import type { Refereeing } from '../../data/types';
import { formatTime } from '../../format';
import { MatchStatusPill, Seg, TeamName } from '../../components/ui';
import type { AdminCtx } from '../admin/AdminTournament';
import { stageCardProps } from '../admin/stages/cardProps';
import { groupByTime, isDecided, useFieldOrder } from '../admin/stages/model';
import { PlanDialog } from './PlanDialog';
import { ReportDialog } from './ReportDialog';
import './referee.css';

export type BoardMode = { kind: 'referee'; myId: string } | { kind: 'admin' };

type View = 'mine' | 'all' | 'free';


export function RefereeBoard({ ctx, mode }: { ctx: AdminCtx; mode: BoardMode }) {
  const data = ctx.data;
  const t = data.tournament;
  const refs = data.referees ?? [];
  const fieldOrder = useFieldOrder(data.fields);
  const matches = useMemo(() => refereeMatches(data), [data]);
  const entries = useMemo(() => new Map((data.refereeing ?? []).map((e) => [e.matchId, e])), [data.refereeing]);
  const assigned = useMemo(
    () => new Map([...entries.values()].filter((e) => e.refereeId).map((e) => [e.matchId, e.refereeId!])),
    [entries],
  );
  const usual = useMemo(() => usualDuration(matches), [matches]);
  const [view, setView] = useState<View>(mode.kind === 'referee' ? 'mine' : 'all');
  const [showDone, setShowDone] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const locked = t.status === 'finished' || t.status === 'archived';

  const inView = (m: Match) =>
    view === 'all' || (view === 'free' ? !assigned.has(m.id) : mode.kind === 'referee' && assigned.get(m.id) === mode.myId);
  // Beendete Spiele mit offener Meldung bleiben sichtbar, sonst nur auf Wunsch.
  const waiting = (m: Match) => {
    const r = entries.get(m.id)?.report;
    return r ? reportState(m, r) === 'open' : false;
  };
  const shown = matches.filter((m) => inView(m) && (showDone || !isDecided(m) || waiting(m)));
  const doneCount = matches.filter((m) => inView(m) && isDecided(m) && !waiting(m)).length;
  const slots = groupByTime(shown, fieldOrder);
  const free = matches.filter((m) => !isDecided(m) && !assigned.has(m.id)).length;
  const mine = mode.kind === 'referee' ? matches.filter((m) => assigned.get(m.id) === mode.myId) : [];

  const viewOptions: Array<{ value: View; label: string }> =
    mode.kind === 'referee'
      ? [
          { value: 'mine', label: `Meine Spiele (${mine.filter((m) => !isDecided(m)).length})` },
          { value: 'all', label: 'Alle Spiele' },
          { value: 'free', label: `Noch frei (${free})` },
        ]
      : [
          { value: 'all', label: 'Alle Spiele' },
          { value: 'free', label: `Noch ohne Schiri (${free})` },
        ];

  return (
    <div className="stack">
      <div className="row">
        <Seg<View> label="Welche Spiele" value={view} onChange={setView} options={viewOptions} />
        <span className="spacer" />
        {!locked && (
          <button type="button" className="btn pri" disabled={refs.length === 0} onClick={() => setPlanOpen(true)}>
            Einteilung vorschlagen
          </button>
        )}
      </div>
      {refs.length === 0 && (
        <span className="small-text">Sobald sich Schiris mit dem Schiri-Link eingetragen haben, kann die Seite eine Einteilung vorschlagen.</span>
      )}

      {slots.length === 0 ? (
        <div className="empty">
          {view === 'mine'
            ? 'Du hast gerade keine Spiele. Nimm dir unter „Noch frei“ welche mit „Pfeife ich“ oder lass dir eine Einteilung vorschlagen.'
            : view === 'free'
              ? 'Alle offenen Spiele haben einen Schiri.'
              : 'Gerade sind keine Spiele offen.'}
        </div>
      ) : (
        slots.map((s) => (
          <div className="stack" key={s.startISO ?? 'ohne'}>
            <div className="wave-head">
              <span>{s.startISO ? `${formatTime(s.startISO, t.timeZone)} Uhr` : 'Ohne Uhrzeit'}</span>
            </div>
            <div className="grid">
              {s.matches.map((m) => (
                <RefMatchCard
                  key={m.id}
                  ctx={ctx}
                  match={m}
                  mode={mode}
                  entry={entries.get(m.id)}
                  usual={usual}
                  clashWith={assigned.get(m.id) ? refereeClash(matches, assigned, assigned.get(m.id)!, m.id) : null}
                  locked={locked}
                />
              ))}
            </div>
          </div>
        ))
      )}

      {doneCount > 0 && (
        <div className="row">
          <button type="button" className="btn" onClick={() => setShowDone((v) => !v)}>
            {showDone ? 'Beendete Spiele ausblenden' : `Beendete Spiele zeigen (${doneCount})`}
          </button>
        </div>
      )}

      {planOpen && <PlanDialog ctx={ctx} matches={matches} assigned={assigned} onClose={() => setPlanOpen(false)} />}
    </div>
  );
}

function RefMatchCard({
  ctx,
  match: m,
  mode,
  entry,
  usual,
  clashWith,
  locked,
}: {
  ctx: AdminCtx;
  match: Match;
  mode: BoardMode;
  entry?: Refereeing;
  usual: number | null;
  clashWith: string | null;
  locked: boolean;
}) {
  const service = useService();
  const data = ctx.data;
  const t = data.tournament;
  const refs = data.referees ?? [];
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const extra = stageCardProps(data, m, ctx.teamName);
  const nameA = extra?.nameA ?? ctx.teamName(m.teamAId);
  const nameB = extra?.nameB ?? ctx.teamName(m.teamBId);
  const title = extra?.title ?? `Runde ${m.roundNumber}`;
  const refId = entry?.refereeId;
  const refName = (id: string) => refs.find((r) => r.id === id)?.name ?? 'Unbekannt';
  const report = entry?.report;
  const state = report ? reportState(m, report) : null;
  const decided = isDecided(m);
  const teamsKnown = Boolean(m.teamAId && m.teamBId);
  const isMine = mode.kind === 'referee' && refId === mode.myId;
  const longer = usual !== null && m.durationMinutes !== usual;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
    } finally {
      setBusy(false);
    }
  };
  const assign = (id: string | null) => run(() => service.assignReferees(t.id, [{ matchId: m.id, refereeId: id }]));

  const decider = extra?.finals
    ? extra.finals.penaltyOnly
      ? 'Nur Neunmeterschießen.'
      : extra.finals.extraTime
        ? 'Bei Unentschieden: Verlängerung, dann Neunmeterschießen.'
        : 'Bei Unentschieden: direkt Neunmeterschießen.'
    : null;

  const canReport = mode.kind === 'referee' && !locked && teamsKnown && !decided && (isMine || !refId);

  return (
    <article className={['match', 'ref-card', isMine ? 'mine' : ''].filter(Boolean).join(' ')} aria-label={`${nameA} gegen ${nameB}`}>
      <span className="match-title">{title}</span>
      <div className="match-meta">
        <span style={{ fontWeight: 600, color: 'var(--tx)' }}>{ctx.fieldName(m.fieldId)}</span>
        <span>{formatTime(m.startISO, t.timeZone)}</span>
        <span className={longer ? 'pill o' : 'pill'}>{m.durationMinutes} Min.</span>
        <span className="spacer" />
        <MatchStatusPill status={m.status} />
      </div>
      {longer && (
        <div className="ref-duration" role="note">
          Achtung: Dieses Spiel dauert {m.durationMinutes} Minuten, sonst {usual}.
        </div>
      )}
      <div className="match-teams">
        <TeamName name={nameA} logo={ctx.teamLogo(m.teamAId)} muted={!m.teamAId} />
        <span className="score">{m.status === 'completed' || m.status === 'live' ? (m.goalsA ?? 0) : ''}</span>
        <TeamName name={nameB} logo={ctx.teamLogo(m.teamBId)} muted={!m.teamBId} />
        <span className="score">{m.status === 'completed' || m.status === 'live' ? (m.goalsB ?? 0) : ''}</span>
      </div>
      {extra?.resultLabel && m.status === 'completed' && extra.resultLabel !== `${m.goalsA}:${m.goalsB}` && (
        <span className="small-text result-note">{extra.resultLabel}</span>
      )}
      {decider && !decided && <span className="small-text">{decider}</span>}

      <div className="ref-line">
        <span className="ref-who">
          Schiri: <b>{refId ? (isMine ? `Du (${refName(refId)})` : refName(refId)) : 'noch frei'}</b>
        </span>
        <span className="spacer" />
        {!locked && !decided && mode.kind === 'referee' && !refId && (
          <button type="button" className="btn" disabled={busy} onClick={() => assign(mode.myId)}>
            Pfeife ich
          </button>
        )}
        {!locked && !decided && isMine && (
          <button type="button" className="btn" disabled={busy} onClick={() => assign(null)}>
            Abgeben
          </button>
        )}
        {!locked && !decided && mode.kind === 'admin' && (
          <select
            className="select"
            aria-label={`Schiri für ${nameA} gegen ${nameB}`}
            value={refId ?? ''}
            disabled={busy}
            onChange={(e) => void assign(e.target.value || null)}
          >
            <option value="">Noch frei</option>
            {refs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
            {refId && !refs.some((r) => r.id === refId) && <option value={refId}>Unbekannt</option>}
          </select>
        )}
      </div>
      {clashWith && !decided && (
        <span className="field-error">
          {isMine ? 'Du pfeifst' : `${refName(refId!)} pfeift`} zur gleichen Zeit schon ein anderes Spiel.
        </span>
      )}

      {report && (
        <div className={`ref-report ${state}`}>
          <span>
            {mode.kind === 'referee' && report.refereeId === mode.myId ? 'Du hast gemeldet' : `Gemeldet von ${refName(report.refereeId)}`}:{' '}
            <b>{reportText(report)}</b>
          </span>
          <span className="small-text">
            {state === 'open'
              ? 'Wartet auf die Turnierleitung.'
              : state === 'accepted'
                ? 'Von der Turnierleitung übernommen.'
                : 'Die Turnierleitung hat ein anderes Ergebnis eingetragen.'}
          </span>
          {mode.kind === 'admin' && state === 'open' && !locked && (
            <div className="row">
              <button type="button" className="btn pri" disabled={busy || !teamsKnown} onClick={() => run(() => service.acceptRefereeReport(t.id, m.id))}>
                Übernehmen
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => run(() => service.reportRefereeResult(t.id, m.id, null))}>
                Verwerfen
              </button>
            </div>
          )}
        </div>
      )}

      {error && <span className="field-error">{error}</span>}

      {canReport && (
        <div className="match-actions">
          <button type="button" className={report ? 'btn' : 'btn pri'} disabled={busy} onClick={() => setReportOpen(true)}>
            {report ? 'Meldung ändern' : 'Ergebnis melden'}
          </button>
          {report && mode.kind === 'referee' && report.refereeId === mode.myId && (
            <button type="button" className="btn" disabled={busy} onClick={() => run(() => service.reportRefereeResult(t.id, m.id, null))}>
              Meldung zurücknehmen
            </button>
          )}
        </div>
      )}

      {reportOpen && mode.kind === 'referee' && (
        <ReportDialog
          tid={t.id}
          match={m}
          myId={mode.myId}
          nameA={nameA}
          nameB={nameB}
          finals={extra?.finals}
          initial={report}
          onClose={() => setReportOpen(false)}
        />
      )}
    </article>
  );
}
