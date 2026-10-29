// Gemeinsame Bausteine der Zuschauerseite: Ansichtsdaten, Spielkarte, Uhrzeit-Blöcke, Team-Auswahl.
import { useState, type ReactNode } from 'react';
import type { PublicMatch } from '../../data/types';
import { formatTime } from '../../format';
import { MatchStatusPill, TeamName } from '../../components/ui';
import { TeamPicker } from '../../components/TeamPicker';
import { matchTitle, resultNote, type SideView } from './stageView';
import { durationOf, pickerTeams, sidesOf, stageColorOf, teamName, type Ctx } from './ctx';
import './stages.css';

export function Dot({ color, label }: { color: string; label?: string }) {
  return <i className="st-dot" style={{ background: color }} aria-label={label} role={label ? 'img' : undefined} />;
}

export function PublicMatchCard({ ctx, m, showRound, fav, hint }: { ctx: Ctx; m: PublicMatch; showRound?: boolean; fav?: string | null; hint?: ReactNode }) {
  const [sa, sb] = sidesOf(ctx, m);
  const hasScore = ctx.scores && m.goalsA !== undefined && m.goalsB !== undefined;
  const done = m.status === 'completed';
  const winner = ctx.model?.winnerOf(m);
  const lose = (id: string | null) => done && !!id && (winner ? winner !== id : false);
  const mine = !!fav && (sa.teamId === fav || sb.teamId === fav);
  const color = stageColorOf(ctx, m);
  const note = ctx.scores ? resultNote(m, true) : undefined;
  const cls = ['match', m.status === 'live' ? 'live' : '', mine ? 'st-mine' : ''].filter(Boolean).join(' ');
  const side = (s: SideView, goals: number | undefined, isA: boolean) => (
    <>
      {s.teamId ? (
        <span className={['st-team', s.provisional ? 'st-preview' : '', s.teamId === fav ? 'st-fav' : ''].filter(Boolean).join(' ')}>
          <TeamName name={teamName(ctx, s.teamId) || '?'} logo={ctx.teams.get(s.teamId)?.logo} />
          {s.provisional && <span className="st-hint">Stand jetzt</span>}
        </span>
      ) : (
        <span className="st-open">{s.slotLabel ?? 'Noch offen'}</span>
      )}
      {hasScore ? (
        <span className={`score ${lose(s.teamId) || (!winner && done && (isA ? m.goalsA! < m.goalsB! : m.goalsB! < m.goalsA!)) ? 'lose' : ''}`}>{goals}</span>
      ) : (
        <span />
      )}
    </>
  );
  return (
    <article className={cls}>
      <div className="match-meta">
        <span style={{ fontWeight: 600, color: 'var(--tx)' }}>{ctx.field(m.fieldId)}</span>
        <span>{formatTime(m.startISO, ctx.view.tournament.timeZone)}</span>
        {durationOf(ctx, m) && <span className="pill y">{durationOf(ctx, m)}</span>}
        {ctx.model ? (
          (showRound || m.stageId) && (
            <span className="st-round">
              {color && <Dot color={color} />}
              {matchTitle(ctx.model, m)}
            </span>
          )
        ) : (
          showRound && <span>Runde {m.roundNumber}</span>
        )}
        <span className="spacer" />
        <MatchStatusPill status={m.status} />
      </div>
      <div className="match-teams">
        {side(sa, m.goalsA, true)}
        {side(sb, m.goalsB, false)}
      </div>
      {note && <div className="small-text">{note}</div>}
      {hint}
    </article>
  );
}

type SlotState = 'done' | 'live' | 'next' | 'planned';

const SLOT_PILL: Record<SlotState, ReactNode> = {
  done: <span className="pill">Beendet</span>,
  live: (
    <span className="pill g">
      <i className="live-dot" aria-hidden />
      Läuft
    </span>
  ),
  next: <span className="pill a">Als Nächstes</span>,
  planned: <span className="pill">Geplant</span>,
};

/**
 * Spiele nach Anstoßzeit, wie im Entwurf „Endrunde Spielplan“. Beendete Blöcke lassen sich am Handy
 * einklappen, damit das Laufende oben steht.
 */
export function TimeSlots({ ctx, matches, fav }: { ctx: Ctx; matches: PublicMatch[]; fav?: string | null }) {
  const [showDone, setShowDone] = useState(false);
  const tz = ctx.view.tournament.timeZone;
  const byTime = new Map<string, PublicMatch[]>();
  for (const m of [...matches].sort((a, b) => (a.startISO ?? '').localeCompare(b.startISO ?? '') || (a.fieldId ?? '').localeCompare(b.fieldId ?? ''))) {
    const k = m.startISO ?? '';
    byTime.set(k, [...(byTime.get(k) ?? []), m]);
  }
  const slots = [...byTime.entries()].map(([iso, ms]) => {
    const done = ms.every((m) => m.status !== 'scheduled' && m.status !== 'live' && m.status !== 'draft');
    const live = ms.some((m) => m.status === 'live');
    return { iso, ms, state: (done ? 'done' : live ? 'live' : 'planned') as SlotState };
  });
  const lastLive = slots.map((s) => s.state).lastIndexOf('live');
  const nextIdx = slots.findIndex((s, i) => i > lastLive && s.state === 'planned');
  if (nextIdx >= 0) slots[nextIdx]!.state = 'next';
  // Am Handy: die schon gespielten Blöcke vorn einklappen (nur solange noch etwas offen ist).
  const collapsible = Math.max(0, slots.findIndex((s) => s.state !== 'done'));
  const allDone = slots.every((s) => s.state === 'done');

  if (slots.length === 0) return <span className="muted">Keine Spiele.</span>;
  return (
    <div className="st-slots">
      {collapsible > 0 && (
        <button type="button" className="st-collapse ph-only" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>
          <span>
            <b>{slots.slice(0, collapsible).map((s) => formatTime(s.iso, tz)).join(', ')}</b>{' '}
            <span className="muted">
              · {slots.slice(0, collapsible).reduce((n, s) => n + s.ms.length, 0)} Spiele beendet
            </span>
          </span>
          <span aria-hidden>{showDone ? '⌃' : '⌄'}</span>
        </button>
      )}
      {slots.map((s, i) => (
        <section key={s.iso || i} className={i < collapsible && !showDone ? 'st-slot ph-hide' : 'st-slot'}>
          <div className="st-slot-head">
            <h2 className="section-title">{s.iso ? `${formatTime(s.iso, tz)} Uhr` : 'Ohne Uhrzeit'}</h2>
            {SLOT_PILL[s.state]}
          </div>
          <div className="grid">
            {s.ms.map((m) => (
              <PublicMatchCard key={m.id} ctx={ctx} m={m} fav={fav} />
            ))}
          </div>
        </section>
      ))}
      {allDone && <span className="small-text">Alle Spiele sind gespielt.</span>}
    </div>
  );
}

/** Kleine Auswahl „Mein Team“ in den Kopfzeilen von Gruppen und Endrunde. */
export function FavPicker({ ctx, fav, setFav }: { ctx: Ctx; fav: string | null; setFav: (id: string | null) => void }) {
  return (
    <div className="st-favpick">
      <TeamPicker label="Mein Team" teams={pickerTeams(ctx.view)} value={fav} onChange={setFav} placeholder="Team wählen" />
    </div>
  );
}
