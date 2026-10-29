// Zuschauerseite „Endrunde“ (Entwürfe „Endrunde Turnierbaum“, „Endrunde Spielplan“, „Gold/Silber/Bronze Übersicht“).
// Platzhalter zeigen, wer nach jetzigem Stand weiterkäme, kursiv und als „Stand jetzt“ markiert.
import { useState } from 'react';
import type { KnockoutStage, StageConfig } from '../../../domain/format';
import type { PublicMatch } from '../../data/types';
import { formatTime } from '../../format';
import { EmptyState, MatchStatusPill, Notice } from '../../components/ui';
import { Bracket, BracketCard, type BracketMatch, type BracketRound, type BracketSide } from '../../components/bracket/Bracket';
import { STAGE_COLORS, matchLabel, resultNote, roundTitle, treeRound, type Placement } from './stageView';
import { Dot, FavPicker, PublicMatchCard, TimeSlots } from './parts';
import { sidesOf, teamName, type Ctx } from './ctx';
import { useFavorite } from './favorite';

type FinalStage = Exclude<StageConfig, { kind: 'swiss' | 'groups' }>;

const isFinal = (s: StageConfig): s is FinalStage => s.kind === 'knockout' || s.kind === 'placement' || s.kind === 'final_group';

const offsetOf = (s: StageConfig) => (s.placeRange?.from ?? 1) - 1;

function stageMatches(ctx: Ctx, stageId: string): PublicMatch[] {
  return ctx.view.matches.filter((m) => m.stageId === stageId);
}

function label(stage: StageConfig, key: string | undefined): string {
  if (!key) return stage.name;
  return matchLabel(key, stage.kind === 'placement' ? 0 : offsetOf(stage));
}

/** Eine Spielseite für Baum und Übersicht. */
function bracketSide(ctx: Ctx, m: PublicMatch, s: 'A' | 'B', fav: string | null): BracketSide {
  const side = sidesOf(ctx, m)[s === 'A' ? 0 : 1];
  const winner = ctx.model!.winnerOf(m);
  const goals = ctx.scores && (m.status === 'completed' || m.status === 'live') ? (s === 'A' ? m.goalsA : m.goalsB) : undefined;
  return {
    name: side.teamId ? teamName(ctx, side.teamId) : (side.slotLabel ?? 'Noch offen'),
    ...(side.slotShort ? { short: side.slotShort } : {}),
    ...(goals !== undefined ? { goals } : {}),
    state: !side.teamId ? 'open' : side.provisional ? 'preview' : winner ? (winner === side.teamId ? 'win' : 'lose') : undefined,
    mine: !!fav && side.teamId === fav,
  };
}

function toBracketMatch(ctx: Ctx, m: PublicMatch, fav: string | null, title?: string): BracketMatch {
  const a = bracketSide(ctx, m, 'A', fav);
  const b = bracketSide(ctx, m, 'B', fav);
  const note = ctx.scores ? resultNote(m) : undefined;
  const preview = a.state === 'preview' || b.state === 'preview';
  return {
    id: m.id,
    meta: (
      <>
        {title && <b className="st-tx">{title} · </b>}
        <b className="st-tx">{ctx.field(m.fieldId)}</b> {formatTime(m.startISO, ctx.view.tournament.timeZone)}
      </>
    ),
    status: m.status === 'scheduled' ? preview ? <span className="pill y">Stand jetzt</span> : undefined : <MatchStatusPill status={m.status} />,
    a,
    b,
    ...(note ? { note } : {}),
    live: m.status === 'live',
    mine: a.mine || b.mine,
  };
}

function Tree({ ctx, stage, fav }: { ctx: Ctx; stage: KnockoutStage; fav: string | null }) {
  const ms = stageMatches(ctx, stage.id);
  const byKey = new Map(ms.map((m) => [m.matchKey, m]));
  const rounds: BracketRound[] = [];
  for (let size = stage.size; size >= 2; size /= 2) {
    const count = size / 2;
    const prefix = size === 32 ? 'R32_' : size === 16 ? 'R16_' : size === 8 ? 'QF' : 'SF';
    const keys = size === 2 ? ['F'] : Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);
    const matches = keys.map((k): BracketMatch => {
      const m = byKey.get(k);
      return m
        ? toBracketMatch(ctx, m, fav)
        : { id: `${stage.id}-${k}`, a: { name: 'Noch offen', state: 'open' }, b: { name: 'Noch offen', state: 'open' } };
    });
    const first = keys.map((k) => byKey.get(k)).find((m) => m?.startISO);
    rounds.push({ title: roundTitle(size), ...(first ? { sub: formatTime(first.startISO, ctx.view.tournament.timeZone) } : {}), matches });
  }
  const extra = ms.filter((m) => !treeRound(m.matchKey)).sort((a, b) => (a.startISO ?? '').localeCompare(b.startISO ?? ''));
  return (
    <>
      <div className="card st-card st-treecard">
        <Bracket rounds={rounds} label={`Turnierbaum ${stage.name}`} />
      </div>
      <p className="small-text ph-only">Zum Weiterblättern nach links wischen.</p>
      {extra.length > 0 && (
        <section className="section">
          <h2 className="section-title">Platzierungsspiele</h2>
          <div className="st-extra">
            {extra.map((m) => (
              <BracketCard key={m.id} m={toBracketMatch(ctx, m, fav, label(stage, m.matchKey))} />
            ))}
          </div>
        </section>
      )}
      <p className="small-text">Die nächsten Runden füllen sich von selbst, sobald die Ergebnisse eingetragen sind.</p>
    </>
  );
}

/** Reihenfolge in der Übersicht: Endspiele oben, frühe Runden unten. */
function overviewOrder(key: string | undefined): number {
  if (key === 'F') return 0;
  const p = /^P(\d+)$/.exec(key ?? '');
  if (p) return Number(p[1]);
  const r = treeRound(key);
  return r ? 1000 + r.size * 10 + r.index : 5000;
}

function StageCard({ ctx, stage, fav }: { ctx: Ctx; stage: FinalStage; fav: string | null }) {
  const ms = stageMatches(ctx, stage.id).sort((a, b) => overviewOrder(a.matchKey) - overviewOrder(b.matchKey));
  const offset = offsetOf(stage);
  const final = stage.kind === 'knockout' ? ms.find((m) => m.matchKey === 'F') : undefined;
  const champ = final ? ctx.model!.winnerOf(final) : null;
  const color = STAGE_COLORS[stage.color];
  const groups: Array<{ title: string; ms: PublicMatch[] }> = [];
  for (const m of ms) {
    const t = treeRound(m.matchKey) && m.matchKey !== 'F' ? label(stage, m.matchKey).replace(/ \d+(,.*)?$/, '$1') : label(stage, m.matchKey);
    const last = groups[groups.length - 1];
    if (last && last.title === t) last.ms.push(m);
    else groups.push({ title: t, ms: [m] });
  }
  return (
    <section className={`card st-card st-stagecard c-${stage.color}`} style={{ borderTopColor: stage.color === 'neutral' ? undefined : color }}>
      <div className="st-card-head">
        <h2 className="section-title">{stage.name}</h2>
        {stage.placeRange && (
          <span className="muted st-sub">
            Platz {stage.placeRange.from}–{stage.placeRange.to}
          </span>
        )}
      </div>
      {champ && (
        <div className={`st-champ c-${stage.color}`}>
          <span className="st-medal" aria-hidden>
            {offset + 1}
          </span>
          <div>
            <small>{offset === 0 ? 'Turniersieger' : `Sieger ${stage.name}`}</small>
            <b className={champ === fav ? 'st-fav' : undefined}>{teamName(ctx, champ)}</b>
          </div>
        </div>
      )}
      {stage.kind === 'final_group' ? (
        <p className="small-text">Jeder gegen jeden, die Tabelle steht unter „Gruppen“.</p>
      ) : (
        groups.map((g) => (
          <div key={g.title} className="st-ov-group">
            <div className="st-ov-title">{g.title}</div>
            {g.ms.map((m) => {
              const [a, b] = sidesOf(ctx, m);
              const w = ctx.model!.winnerOf(m);
              const name = (s: typeof a) => {
                const cls = [!s.teamId ? 'st-open' : s.provisional ? 'st-preview' : '', w && s.teamId === w ? 'st-win' : w ? 'muted' : '', s.teamId === fav ? 'st-fav' : '']
                  .filter(Boolean)
                  .join(' ');
                return <span className={cls}>{s.teamId ? teamName(ctx, s.teamId) : (s.slotLabel ?? 'Noch offen')}</span>;
              };
              const score =
                ctx.scores && m.goalsA !== undefined && (m.status === 'completed' || m.status === 'live') ? `${m.goalsA}:${m.goalsB}` : formatTime(m.startISO, ctx.view.tournament.timeZone);
              const note = ctx.scores ? resultNote(m) : undefined;
              return (
                <div key={m.id} className={m.status === 'live' ? 'st-ov-row live' : 'st-ov-row'}>
                  {name(a)}
                  <span className="st-ov-score">
                    {score}
                    {note && <small> {note.replace(/^\d+:\d+ /, '')}</small>}
                  </span>
                  <span className="st-ov-b">{name(b)}</span>
                </div>
              );
            })}
          </div>
        ))
      )}
    </section>
  );
}

function placeText(p: Placement): string {
  return p.placeFrom === p.placeTo ? `${p.placeFrom}.` : `${p.placeFrom}.–${p.placeTo}.`;
}

function FinalStandings({ ctx, fav }: { ctx: Ctx; fav: string | null }) {
  const { placements, eliminated } = ctx.model!.placements();
  if (placements.length === 0 && eliminated.length === 0) return null;
  const colorOf = (stageId: string) => {
    const s = ctx.model!.stageOf(stageId);
    return s && s.color !== 'neutral' ? STAGE_COLORS[s.color] : undefined;
  };
  const total = ctx.view.teams.filter((t) => t.status === 'active').length;
  const open = total - placements.length - eliminated.filter((id) => ctx.teams.get(id)?.status === 'active').length;
  return (
    <section className="card st-card">
      <h2 className="section-title">Endplatzierung</h2>
      <ol className="st-places">
        {placements.map((p) => {
          const c = colorOf(p.stageId);
          return (
            <li key={p.teamId} className={p.teamId === fav ? 'st-place mine' : 'st-place'}>
              <b>{placeText(p)}</b>
              <span>{teamName(ctx, p.teamId)}</span>
              {c && <Dot color={c} />}
            </li>
          );
        })}
      </ol>
      {open > 0 && <p className="small-text">Für {open} Teams steht der Platz noch nicht fest.</p>}
      {placements.some((p) => p.placeFrom !== p.placeTo) && <p className="small-text">Nicht ausgespielte Plätze teilen sich die Teams.</p>}
      {eliminated.length > 0 && (
        <>
          <h3 className="st-ov-title">Ausgeschieden</h3>
          <p className={eliminated.includes(fav ?? '') ? 'st-out mine' : 'st-out'}>{eliminated.map((id) => teamName(ctx, id)).join(', ')}</p>
        </>
      )}
    </section>
  );
}

function MyTeamFinal({ ctx, fav }: { ctx: Ctx; fav: string }) {
  const { placements, eliminated } = ctx.model!.placements();
  const p = placements.find((x) => x.teamId === fav);
  const stageName = p ? ctx.model!.stageOf(p.stageId)?.name : undefined;
  let text: string;
  let sub = '';
  if (p) {
    text = `${teamName(ctx, fav)}: Platz ${placeText(p).replace(/\./g, '')}`;
    sub = stageName ? (p.placeFrom === (ctx.model!.stageOf(p.stageId)?.placeRange?.from ?? 0) ? `Sieger der ${stageName}` : stageName) : '';
  } else if (eliminated.includes(fav)) {
    text = `${teamName(ctx, fav)} ist ausgeschieden`;
  } else {
    const next = ctx.view.matches
      .filter((m) => m.status === 'scheduled' || m.status === 'live')
      .filter((m) => ctx.model!.stageOf(m.stageId)?.phase)
      .find((m) => sidesOf(ctx, m).some((s) => s.teamId === fav));
    if (!next) return null;
    const stage = ctx.model!.stageOf(next.stageId)!;
    const provisional = sidesOf(ctx, next).some((s) => s.teamId === fav && s.provisional);
    text = `${teamName(ctx, fav)}: ${stage.name}`;
    sub = `${label(stage, next.matchKey)} um ${formatTime(next.startISO, ctx.view.tournament.timeZone)} Uhr${provisional ? ', Stand jetzt' : ''}`;
  }
  return (
    <section className="card st-card st-me">
      <b className="st-me-line">{text}</b>
      {sub && <span className="muted">{sub}</span>}
    </section>
  );
}

export function Finals({ ctx }: { ctx: Ctx }) {
  const model = ctx.model!;
  const stages = model.format.stages.filter(isFinal);
  const [fav, setFav] = useFavorite(ctx.view.tournament.id);
  const multi = stages.length > 1;
  const [which, setWhich] = useState<string>(multi ? 'all' : (stages[0]?.id ?? 'all'));
  const [mode, setMode] = useState<'tree' | 'plan'>('tree');
  if (stages.length === 0) return <EmptyState text="Dieses Turnier hat keine Endrunde." />;
  const stage = stages.find((s) => s.id === which);
  const finalsMatches = ctx.view.matches.filter((m) => stages.some((s) => s.id === m.stageId));
  const anyFixed = finalsMatches.some((m) => m.teamAId || m.teamBId);
  const anyPreview = finalsMatches.some((m) => sidesOf(ctx, m).some((s) => s.provisional));
  const finished = finalsMatches.length > 0 && finalsMatches.every((m) => m.status === 'completed' || m.status === 'not_played');
  const treeLabel = stage ? (stage.kind === 'knockout' ? 'Turnierbaum' : 'Übersicht') : 'Übersicht';

  return (
    <>
      <div className="st-head">
        <div className="st-head-title">
          <h1 className="page-title">{multi ? 'Endrunden' : stages[0]!.name}</h1>
          {finished && <span className="pill">Beendet</span>}
        </div>
        <FavPicker ctx={ctx} fav={fav} setFav={setFav} />
      </div>
      <div className="st-segs">
        {multi && (
          <div className="seg st-seg-wrap" role="group" aria-label="Endrunde wählen">
            <button type="button" aria-pressed={which === 'all'} onClick={() => setWhich('all')}>
              Alle
            </button>
            {stages.map((s) => (
              <button key={s.id} type="button" aria-pressed={which === s.id} onClick={() => setWhich(s.id)}>
                {s.color !== 'neutral' && <Dot color={STAGE_COLORS[s.color]} />}
                {s.name}
              </button>
            ))}
          </div>
        )}
        {stage?.kind !== 'final_group' && (
          <div className="seg" role="group" aria-label="Ansicht">
            <button type="button" aria-pressed={mode === 'tree'} onClick={() => setMode('tree')}>
              {treeLabel}
            </button>
            <button type="button" aria-pressed={mode === 'plan'} onClick={() => setMode('plan')}>
              Spielplan
            </button>
          </div>
        )}
      </div>

      {!anyFixed && anyPreview && (
        <Notice tone="hint" title="Stand jetzt, noch nicht fest">
          Die Endrunde füllt sich, sobald die Gruppen fertig sind. Kursive Namen zeigen, wer nach jetzigem Stand dabei wäre.
        </Notice>
      )}
      {!anyFixed && !anyPreview && <p className="muted">Die Teams stehen fest, sobald die Gruppenspiele gespielt sind.</p>}

      {fav && <MyTeamFinal ctx={ctx} fav={fav} />}

      {mode === 'plan' || stage?.kind === 'final_group' ? (
        <TimeSlots ctx={ctx} matches={stage ? stageMatches(ctx, stage.id) : finalsMatches} fav={fav} />
      ) : stage?.kind === 'knockout' ? (
        <Tree ctx={ctx} stage={stage} fav={fav} />
      ) : stage ? (
        <div className="grid">
          {stageMatches(ctx, stage.id).map((m) => (
            <PublicMatchCard key={m.id} ctx={ctx} m={m} fav={fav} />
          ))}
        </div>
      ) : (
        <>
          <div className="st-stagecards">
            {stages.map((s) => (
              <StageCard key={s.id} ctx={ctx} stage={s} fav={fav} />
            ))}
          </div>
        </>
      )}
      {mode === 'tree' && (!stage || !multi) && <FinalStandings ctx={ctx} fav={fav} />}
    </>
  );
}
