// Tabellen, Endrunden-Übersicht und Endplatzierung für Turniere mit Gruppen und Endrunde.
// Wird in der Turnierleitung (Reiter „Tabelle“) gezeigt; die Druckansicht hat eine eigene, schlichte Fassung.
import { useMemo } from 'react';
import type { Match } from '../../../../domain';
import type { StageConfig } from '../../../../domain/format';
import type { GroupStageStandings } from '../../../../domain/groups';
import { matchLabel } from '../../../../domain/knockout';
import { formatGoalDiff } from '../../../../domain/scoring/format';
import { href } from '../../../router';
import { Icon } from '../../../components/Icon';
import { EmptyState } from '../../../components/ui';
import type { AdminCtx } from '../AdminTournament';
import { StageNotices } from './StageNotices';
import {
  STAGE_COLOR,
  advanceColors,
  buildStageModel,
  groupName,
  isFinalsStage,
  placementText,
  resultText,
  sideText,
  winnerSide,
  type StageModel,
} from './model';
import './stages.css';

export function StageTables({ ctx }: { ctx: AdminCtx }) {
  const model = useMemo(() => buildStageModel(ctx.data), [ctx.data]);
  if (!model) return null;
  const finals = model.format.stages.filter(isFinalsStage);
  return (
    <>
      <div className="row no-print">
        <a className="btn" href={href({ name: 'print', id: ctx.data.tournament.id })}>
          <Icon name="print" />
          Drucken oder PDF
        </a>
      </div>
      <StageNotices ctx={ctx} model={model} />
      {model.format.stages.map((stage) => {
        const st = model.standings[stage.id];
        return st ? <GroupSection key={stage.id} ctx={ctx} model={model} stage={stage} st={st} /> : null;
      })}
      {finals.length > 0 && (
        <section className="section">
          <h2 className="section-title">Endrunde</h2>
          <div className="finals-grid-cards">
            {finals.map((s) => (
              <FinalsCard key={s.id} ctx={ctx} model={model} stage={s} />
            ))}
          </div>
        </section>
      )}
      <PlacementSection ctx={ctx} model={model} />
    </>
  );
}

function GroupSection({ ctx, model, stage, st }: { ctx: AdminCtx; model: StageModel; stage: StageConfig; st: GroupStageStandings }) {
  const colors = advanceColors(model.format, stage.id);
  const single = st.tables.length === 1;
  const legend = model.format.stages.filter((s) => s.entry?.fromStageId === stage.id);
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">{stage.name}</h2>
        {legend.length > 0 && (
          <span className="small-text" style={{ display: 'inline-flex', gap: 12, flexWrap: 'wrap' }}>
            {legend.map((s) => (
              <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <i className="stage-dot" style={{ background: STAGE_COLOR[s.color === 'neutral' && s.kind === 'knockout' ? 'gold' : s.color] }} />
                {s.name}
              </span>
            ))}
          </span>
        )}
      </div>
      {st.tables.every((t) => t.rows.length === 0 && t.unranked.length === 0) ? (
        <EmptyState text="Die Gruppen sind noch nicht ausgelost." />
      ) : (
        <div className="group-grid">
          {st.tables.map((table, gi) => {
            const lots = table.openLots.flat();
            return (
              <div key={gi} className="card stack tight" style={{ padding: '14px 16px', minWidth: 0 }}>
                <div className="section-head">
                  <h3 className="card-title" style={{ margin: 0 }}>
                    {single ? stage.name : groupName(model.format, stage.id, gi)}
                  </h3>
                  <span className={st.groupComplete[gi] ? 'pill' : 'pill g'}>{st.groupComplete[gi] ? 'Fertig' : 'Läuft'}</span>
                </div>
                <div className="table-box" style={{ border: 0 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th className="l">Pl.</th>
                        <th className="l">Team</th>
                        <th>Sp</th>
                        <th>S</th>
                        <th>U</th>
                        <th>N</th>
                        <th>Tore</th>
                        <th>Diff</th>
                        <th>Pkt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map((r) => {
                        const color = colors.get(r.place);
                        return (
                          <tr key={r.teamId}>
                            <td className="l">
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <i className="stage-dot" style={{ background: color ? STAGE_COLOR[color] : 'transparent' }} />
                                {r.place}.
                              </span>
                            </td>
                            <td className="l">
                              {ctx.teamName(r.teamId)}
                              {r.decidedBy === 'lot' && <span className="small-text"> (Los)</span>}
                              {lots.includes(r.teamId) && <span className="small-text"> (Los fehlt)</span>}
                            </td>
                            <td>{r.played}</td>
                            <td>{r.won}</td>
                            <td>{r.drawn}</td>
                            <td>{r.lost}</td>
                            <td>
                              {r.goalsFor}:{r.goalsAgainst}
                            </td>
                            <td>{formatGoalDiff(r.goalsFor - r.goalsAgainst)}</td>
                            <td style={{ fontWeight: 800 }}>{r.points}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {table.unranked.length > 0 && (
                  <span className="small-text">
                    Zurückgezogen: {table.unranked.map(ctx.teamName).join(', ')}. Ihre Spiele zählen für niemanden.
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Überschrift einer Runde aus dem Spielnamen: „Halbfinale 1“ → „Halbfinale“. */
function roundHeading(label: string): string {
  return label.replace(/^(Sechzehntelfinale|Achtelfinale|Viertelfinale|Halbfinale) \d+/, '$1');
}

function stageLabel(stage: StageConfig, key: string): string {
  return matchLabel(key, stage.kind === 'knockout' ? (stage.placeRange?.from ?? 1) - 1 : 0);
}

/** Spiele einer Endrunde nach Runden, die spätesten (Finale) zuerst. */
export function finalsRounds(stage: StageConfig, matches: readonly Match[]): Array<{ heading: string; matches: Match[] }> {
  const own = matches.filter((m) => m.stageId === stage.id).sort((a, b) => (b.startISO ?? '').localeCompare(a.startISO ?? '') || (a.matchKey ?? '').localeCompare(b.matchKey ?? ''));
  const out: Array<{ heading: string; matches: Match[] }> = [];
  for (const m of own) {
    const heading = roundHeading(stageLabel(stage, m.matchKey ?? ''));
    const group = out.find((g) => g.heading === heading);
    if (group) group.matches.push(m);
    else out.push({ heading, matches: [m] });
  }
  for (const g of out) g.matches.sort((a, b) => (a.matchKey ?? '').localeCompare(b.matchKey ?? '', 'de', { numeric: true }));
  return out;
}

function FinalsCard({ ctx, model, stage }: { ctx: AdminCtx; model: StageModel; stage: StageConfig }) {
  const rounds = finalsRounds(stage, ctx.data.matches);
  const final = ctx.data.matches.find((m) => m.stageId === stage.id && m.matchKey === 'F');
  const fw = final ? winnerSide(final, model.format) : null;
  const champion = final && fw ? (fw === 'A' ? final.teamAId : final.teamBId) : null;
  const color = stage.color === 'neutral' ? 'var(--ac)' : STAGE_COLOR[stage.color];
  return (
    <section className="card finals-card" style={{ padding: '16px 18px', borderTopColor: color }}>
      <div className="section-head">
        <h3 className="card-title" style={{ margin: 0 }}>
          {stage.name}
        </h3>
        {stage.placeRange && (
          <span className="small-text">
            Platz {stage.placeRange.from}–{stage.placeRange.to}
          </span>
        )}
      </div>
      {champion && (
        <div className="row" style={{ marginTop: 10, padding: 12, borderRadius: 12, background: 'var(--soft)', flexWrap: 'nowrap' }}>
          <Icon name="trophy" />
          <span className="stack tight" style={{ minWidth: 0 }}>
            <span className="small-text">{stage.placeRange?.from === 1 ? 'Turniersieger' : `Sieger ${stage.name}`}</span>
            <b style={{ fontSize: 18, overflowWrap: 'anywhere' }}>{ctx.teamName(champion)}</b>
          </span>
        </div>
      )}
      {rounds.length === 0 && <span className="muted">Noch keine Spiele geplant.</span>}
      {rounds.map((r) => (
        <div key={r.heading}>
          <div className="round-head">{r.heading}</div>
          {r.matches.map((m) => (
            <ResultLine key={m.id} ctx={ctx} model={model} match={m} />
          ))}
        </div>
      ))}
    </section>
  );
}

export function ResultLine({ ctx, model, match: m }: { ctx: AdminCtx; model: StageModel; match: Match }) {
  const win = winnerSide(m, model.format);
  const res = resultText(m, model.format);
  const [main, ...rest] = res.split(', ');
  const extra = rest.join(', ');
  const cls = (side: 'A' | 'B') => {
    const id = side === 'A' ? m.teamAId : m.teamBId;
    if (!id) return 'open';
    return win === side ? 'win' : win ? 'lose' : '';
  };
  return (
    <div className="result-line">
      <span className={cls('A')}>{sideText(m, 'A', model.format, ctx.teamName)}</span>
      <span className="s">
        {main || '–'}
        {extra && (
          <>
            {' '}
            <small>{extra}</small>
          </>
        )}
      </span>
      <span className={`rt ${cls('B')}`}>{sideText(m, 'B', model.format, ctx.teamName)}</span>
    </div>
  );
}

function PlacementSection({ ctx, model }: { ctx: AdminCtx; model: StageModel }) {
  const { placements, open } = model.placements;
  const placed = placements.filter((p) => 'placeFrom' in p);
  const out = placements.filter((p) => !('placeFrom' in p));
  if (placed.length === 0 && out.length === 0) return null;
  const shared = placed.some((p) => 'placeFrom' in p && p.placeFrom !== p.placeTo);
  return (
    <section className="card stack tight" style={{ padding: '16px 18px' }}>
      <h2 className="section-title">Endplatzierung</h2>
      <div className="placement-grid">
        {placed.map((p) => (
          <div key={p.teamId} className="placement-row">
            <b>{placementText(p)}</b>
            <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{ctx.teamName(p.teamId)}</span>
          </div>
        ))}
      </div>
      {out.length > 0 && (
        <>
          <div className="round-head">Ausgeschieden</div>
          <span>{out.map((p) => ctx.teamName(p.teamId)).join(', ')}</span>
        </>
      )}
      {open.length > 0 && <span className="small-text">Noch offen: {open.length} {open.length === 1 ? 'Team spielt' : 'Teams spielen'} noch um ihren Platz.</span>}
      {shared && <span className="small-text">Nicht ausgespielte Plätze werden geteilt, zum Beispiel „5.–8.“.</span>}
    </section>
  );
}
