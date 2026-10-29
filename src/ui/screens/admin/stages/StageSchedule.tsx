// Spielplan für Turniere mit Gruppen und Endrunde. Die Turnierleitung kann hier noch nicht angepfiffene
// Spiele tauschen (Uhrzeit und Feld), Gegner tauschen und Feld oder Uhrzeit ändern: per Ziehen am
// Computer oder mit „Tauschen“ und dann das Ziel antippen. Warnungen statt Verbote, alles im Verlauf.
import { useMemo, useState, type DragEvent } from 'react';
import type { Match } from '../../../../domain';
import { checkStageSchedule, moveMatch, swapMatchTimes, swapOpponents, zonedLocalToISO, type EditResult } from '../../../../domain/schedule';
import { useService } from '../../../data/context';
import { isOpen } from '../../../data/stages';
import { formatTime } from '../../../format';
import { href } from '../../../router';
import { Icon } from '../../../components/Icon';
import { Dialog, EmptyState, MatchStatusPill, Notice } from '../../../components/ui';
import type { AdminCtx } from '../AdminTournament';

import { STAGE_COLOR, buildStageModel, editableMatches, groupByTime, useFieldOrder, matchTitle, resultText, scheduleCheckOptions, sideText, stageById, winnerSide } from './model';
import './stages.css';

type Pick = { kind: 'match'; matchId: string } | { kind: 'side'; matchId: string; side: 'A' | 'B' } | null;

type Pending =
  | { kind: 'match'; a: string; b: string; result: EditResult }
  | { kind: 'side'; a: { matchId: string; side: 'A' | 'B' }; b: { matchId: string; side: 'A' | 'B' }; result: EditResult };

export function StageSchedule({ ctx }: { ctx: AdminCtx }) {
  const { data } = ctx;
  const t = data.tournament;
  const model = useMemo(() => buildStageModel(data), [data]);
  const fieldOrder = useFieldOrder(ctx.data.fields);
  const [stageFilter, setStageFilter] = useState<string>('');
  const [teamFilter, setTeamFilter] = useState<string>('');
  const [pick, setPick] = useState<Pick>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [moving, setMoving] = useState<Match | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  if (!model) return null;
  const format = model.format;
  const canEdit = t.status !== 'finished' && t.status !== 'archived';

  const all = data.matches.filter((m) => m.stageId);
  const shown = all.filter(
    (m) =>
      (!stageFilter || m.stageId === stageFilter) &&
      (!teamFilter || m.teamAId === teamFilter || m.teamBId === teamFilter),
  );
  const warned = new Map<string, string[]>();
  for (const issue of model.issues) for (const id of issue.matchIds) warned.set(id, [...(warned.get(id) ?? []), issue.message]);

  const editable = editableMatches(data);
  const options = scheduleCheckOptions(data);
  const name = (m: Match, side: 'A' | 'B') => sideText(m, side, format, ctx.teamName);
  const byId = (id: string) => data.matches.find((m) => m.id === id)!;

  const proposeMatchSwap = (a: string, b: string) => {
    setPick(null);
    if (a === b) return;
    setPending({ kind: 'match', a, b, result: swapMatchTimes(editable, a, b, options) });
  };
  const proposeSideSwap = (a: { matchId: string; side: 'A' | 'B' }, b: { matchId: string; side: 'A' | 'B' }) => {
    setPick(null);
    setPending({ kind: 'side', a, b, result: swapOpponents(editable, a, b, options) });
  };

  const pickedText =
    pick?.kind === 'match'
      ? `Tippe das Spiel an, mit dem ${name(byId(pick.matchId), 'A')} – ${name(byId(pick.matchId), 'B')} Uhrzeit und Feld tauschen soll.`
      : pick?.kind === 'side'
        ? `Tippe das Team in einem anderen Spiel an, mit dem ${name(byId(pick.matchId), pick.side)} tauschen soll.`
        : '';

  const stages = format.stages.filter((s) => all.some((m) => m.stageId === s.id));
  const teams = [...data.teams].sort((a, b) => a.name.localeCompare(b.name, 'de'));

  return (
    <>
      <div className="row no-print">
        <a className="btn" href={href({ name: 'print', id: t.id })}>
          <Icon name="print" />
          Drucken oder PDF
        </a>
        <select className="select" style={{ width: 'auto', maxWidth: '100%' }} aria-label="Abschnitt" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
          <option value="">Alle Abschnitte</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select className="select" style={{ width: 'auto', maxWidth: '100%' }} aria-label="Mannschaft" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
          <option value="">Alle Mannschaften</option>
          {teams.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </div>

      {canEdit && (
        <span className="small-text">
          Tauschen geht bei Spielen, die noch nicht angepfiffen sind: am Computer ein Spiel auf ein anderes ziehen, oder auf „Tauschen“ drücken
          und das Ziel antippen. Tippst du ein Team an, tauschst du nur dieses Team mit einem Team aus einem anderen Spiel.
        </span>
      )}

      {model.issues.length > 0 && (
        <Notice tone="hint" title={model.issues.length === 1 ? 'Eine Warnung' : `${model.issues.length} Warnungen`}>
          <ul className="stage-fill-list">
            {model.issues.map((i) => (
              <li key={i.kind + i.matchIds.join()}>{i.message}</li>
            ))}
          </ul>
          Das ist erlaubt, aber prüf, ob es so gewollt ist.
        </Notice>
      )}

      {pick && (
        <div className="notice info swap-bar">
          <b>{pickedText}</b>
          <span>
            <button type="button" className="btn" onClick={() => setPick(null)}>
              Abbrechen
            </button>
          </span>
        </div>
      )}

      {shown.length === 0 && <EmptyState text="Keine Spiele für diese Auswahl." />}

      {groupByTime(shown, fieldOrder).map((slot) => (
        <section key={slot.startISO ?? 'ohne'} className="section">
          <div className="slot-head">
            <b>{slot.startISO ? `${formatTime(slot.startISO, t.timeZone)} Uhr` : 'Ohne Uhrzeit'}</b>
          </div>
          <div className="sched-grid">
            {slot.matches.map((m) => {
              const open = canEdit && isOpen(m) && m.decidedBy !== 'walkover';
              const stage = stageById(format, m.stageId);
              const win = winnerSide(m, format);
              const res = resultText(m, format);
              const isPicked = pick?.kind === 'match' && pick.matchId === m.id;
              const isTarget = open && pick?.kind === 'match' && pick.matchId !== m.id;
              const cls = [
                'sched-card',
                m.status === 'live' ? 'live' : '',
                isPicked ? 'picked' : '',
                isTarget ? 'target' : '',
                dropId === m.id ? 'drop' : '',
                warned.has(m.id) ? 'warn' : '',
              ]
                .filter(Boolean)
                .join(' ');
              const sideCls = (side: 'A' | 'B') => {
                const id = side === 'A' ? m.teamAId : m.teamBId;
                if (!id) return 'open';
                return win === side ? 'win' : win ? 'lose' : '';
              };
              const sideEl = (side: 'A' | 'B') => {
                const text = name(m, side);
                if (!open) return <span className={sideCls(side)}>{text}</span>;
                const picked = pick?.kind === 'side' && pick.matchId === m.id && pick.side === side;
                const target = pick?.kind === 'side' && pick.matchId !== m.id;
                return (
                  <button
                    type="button"
                    className={[sideCls(side), picked ? 'pick' : '', target ? 'target' : ''].filter(Boolean).join(' ')}
                    aria-label={target ? `${text} zum Tauschen wählen` : `${text} tauschen`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (pick?.kind === 'side' && pick.matchId !== m.id) proposeSideSwap({ matchId: pick.matchId, side: pick.side }, { matchId: m.id, side });
                      else if (pick?.kind === 'match') proposeMatchSwap(pick.matchId, m.id);
                      else setPick(picked ? null : { kind: 'side', matchId: m.id, side });
                    }}
                  >
                    {text}
                  </button>
                );
              };
              const drag = open
                ? {
                    draggable: true,
                    onDragStart: (e: DragEvent) => {
                      e.dataTransfer.setData('text/plain', m.id);
                      e.dataTransfer.effectAllowed = 'move';
                      setDragId(m.id);
                    },
                    onDragEnd: () => {
                      setDragId(null);
                      setDropId(null);
                    },
                    onDragOver: (e: DragEvent) => {
                      if (dragId && dragId !== m.id) {
                        e.preventDefault();
                        setDropId(m.id);
                      }
                    },
                    onDragLeave: () => setDropId((v) => (v === m.id ? null : v)),
                    onDrop: (e: DragEvent) => {
                      e.preventDefault();
                      const from = e.dataTransfer.getData('text/plain') || dragId;
                      setDragId(null);
                      setDropId(null);
                      if (from && from !== m.id) proposeMatchSwap(from, m.id);
                    },
                  }
                : {};
              return (
                <article
                  key={m.id}
                  className={cls}
                  {...drag}
                  onClick={isTarget ? () => proposeMatchSwap(pick!.matchId, m.id) : undefined}
                  aria-label={`${name(m, 'A')} gegen ${name(m, 'B')}`}
                >
                  <div className="t">
                    <b style={{ color: 'var(--tx)' }}>{ctx.fieldName(m.fieldId)}</b>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {stage && stage.color !== 'neutral' && <i className="stage-dot" style={{ background: STAGE_COLOR[stage.color] }} />}
                      {matchTitle(m, format)}
                    </span>
                  </div>
                  <div className="r">
                    {sideEl('A')}
                    <b>{m.status === 'completed' || m.status === 'live' ? (m.goalsA ?? 0) : ''}</b>
                  </div>
                  <div className="r">
                    {sideEl('B')}
                    <b>{m.status === 'completed' || m.status === 'live' ? (m.goalsB ?? 0) : ''}</b>
                  </div>
                  {res && res !== `${m.goalsA ?? 0}:${m.goalsB ?? 0}` && <span className="small-text result-note">{res}</span>}
                  {warned.get(m.id)?.map((w) => (
                    <span key={w} className="small-text" style={{ color: 'var(--o)' }}>
                      {w}
                    </span>
                  ))}
                  <div className="t">
                    <MatchStatusPill status={m.status} />
                    {m.manual && <span>von Hand geändert</span>}
                  </div>
                  {open && !pick && (
                    <div className="acts">
                      <button type="button" className="btn compact" onClick={() => setPick({ kind: 'match', matchId: m.id })}>
                        <Icon name="shuffle" />
                        Tauschen mit …
                      </button>
                      <button type="button" className="btn compact" onClick={() => setMoving(m)}>
                        <Icon name="clock" />
                        Zeit oder Feld
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ))}

      {pending && <SwapDialog ctx={ctx} pending={pending} name={name} byId={byId} onClose={() => setPending(null)} />}
      {moving && <MoveDialog ctx={ctx} match={moving} onClose={() => setMoving(null)} />}
    </>
  );
}

/** Neue Warnungen durch eine Änderung (die schon vorher bestanden, zählen nicht noch einmal). */
function newIssues(ctx: AdminCtx, result: EditResult): string[] {
  if (!result.ok) return [];
  const before = new Set(checkStageSchedule(editableMatches(ctx.data), scheduleCheckOptions(ctx.data)).map((i) => i.message));
  return result.issues.map((i) => i.message).filter((m) => !before.has(m));
}

function SwapDialog({
  ctx,
  pending,
  name,
  byId,
  onClose,
}: {
  ctx: AdminCtx;
  pending: Pending;
  name: (m: Match, side: 'A' | 'B') => string;
  byId: (id: string) => Match;
  onClose: () => void;
}) {
  const service = useService();
  const t = ctx.data.tournament;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const warnings = newIssues(ctx, pending.result);
  const where = (m: Match) => `${formatTime(m.startISO, t.timeZone)} Uhr, ${ctx.fieldName(m.fieldId)}`;
  const label = (m: Match) => `${name(m, 'A')} – ${name(m, 'B')}`;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (pending.kind === 'match') await service.swapMatches(t.id, pending.a, pending.b);
      else await service.swapTeams(t.id, pending.a, pending.b);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
      setBusy(false);
    }
  };

  let body;
  if (pending.kind === 'match') {
    const a = byId(pending.a);
    const b = byId(pending.b);
    body = (
      <ul className="stage-fill-list">
        <li>
          <b>{label(a)}</b> spielt dann um {where(b)}.
        </li>
        <li>
          <b>{label(b)}</b> spielt dann um {where(a)}.
        </li>
      </ul>
    );
  } else {
    const a = byId(pending.a.matchId);
    const b = byId(pending.b.matchId);
    const na = name(a, pending.a.side);
    const nb = name(b, pending.b.side);
    body = (
      <ul className="stage-fill-list">
        <li>
          <b>{nb}</b> spielt dann um {where(a)} gegen {name(a, pending.a.side === 'A' ? 'B' : 'A')}.
        </li>
        <li>
          <b>{na}</b> spielt dann um {where(b)} gegen {name(b, pending.b.side === 'A' ? 'B' : 'A')}.
        </li>
      </ul>
    );
  }

  return (
    <Dialog title={pending.kind === 'match' ? 'Spiele tauschen?' : 'Teams tauschen?'} onClose={onClose}>
      {pending.result.ok ? body : <Notice tone="warn" title={pending.result.error} />}
      {warnings.length > 0 && (
        <Notice tone="hint" title="Achtung">
          <ul className="stage-fill-list">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          Du kannst trotzdem tauschen.
        </Notice>
      )}
      <span className="small-text">Die Änderung steht im Verlauf und lässt sich dort rückgängig machen.</span>
      {error && <span className="field-error">{error}</span>}
      <div className="row">
        <button type="button" className="btn pri" disabled={busy || !pending.result.ok} onClick={save}>
          {busy ? 'Speichert …' : 'Tauschen'}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Abbrechen
        </button>
      </div>
    </Dialog>
  );
}

function MoveDialog({ ctx, match, onClose }: { ctx: AdminCtx; match: Match; onClose: () => void }) {
  const service = useService();
  const t = ctx.data.tournament;
  const [fieldId, setFieldId] = useState(match.fieldId ?? ctx.data.fields[0]?.id ?? '');
  const [time, setTime] = useState(formatTime(match.startISO, t.timeZone));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validTime = /^\d{2}:\d{2}$/.test(time);
  const startISO = validTime ? zonedLocalToISO(t.localDate, time, t.timeZone) : undefined;
  const result =
    match.startISO && match.fieldId && startISO
      ? moveMatch(editableMatches(ctx.data), match.id, { fieldId, startISO }, scheduleCheckOptions(ctx.data))
      : null;
  const warnings = result ? newIssues(ctx, result) : [];
  const format = t.format!;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await service.moveMatch(t.id, match.id, { fieldId, ...(startISO ? { startISO } : {}) });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
      setBusy(false);
    }
  };

  return (
    <Dialog title="Uhrzeit oder Feld ändern" onClose={onClose}>
      <p style={{ margin: 0 }}>
        <b>
          {sideText(match, 'A', format, ctx.teamName)} – {sideText(match, 'B', format, ctx.teamName)}
        </b>
        <br />
        <span className="small-text">{matchTitle(match, format)}</span>
      </p>
      <div className="form-grid">
        <label className="field">
          <span className="label">Feld</span>
          <select className="select" value={fieldId} onChange={(e) => setFieldId(e.target.value)}>
            {[...ctx.data.fields]
              .sort((a, b) => a.order - b.order)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span className="label">Anstoß</span>
          <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>
      {warnings.length > 0 && (
        <Notice tone="hint" title="Achtung">
          <ul className="stage-fill-list">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          Du kannst trotzdem speichern.
        </Notice>
      )}
      {error && <span className="field-error">{error}</span>}
      <div className="row">
        <button type="button" className="btn pri" disabled={busy || !validTime} onClick={save}>
          {busy ? 'Speichert …' : 'Speichern'}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Abbrechen
        </button>
      </div>
    </Dialog>
  );
}
