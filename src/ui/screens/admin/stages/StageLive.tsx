// Live-Cockpit für Turniere mit Gruppen und Endrunde: Spiele nach Anstoßzeit über alle Abschnitte,
// Hinweise zum Füllen der Endrunde, Lose und Warnungen. Auch die Helferansicht nutzt die Zeitblöcke.
import { useMemo, useState } from 'react';
import type { Match } from '../../../../domain';

import { useService } from '../../../data/context';
import { useNow } from '../../../hooks';
import { formatMinutes, formatTime } from '../../../format';
import { href, publicUrl } from '../../../router';
import { Icon } from '../../../components/Icon';
import { CopyButton, Kpi, Notice, Seg } from '../../../components/ui';
import { MatchCard } from '../MatchCard';
import { ShiftDialog } from '../LiveTab';
import type { AdminCtx } from '../AdminTournament';
import { stageCardProps } from './cardProps';
import { buildStageModel, groupByTime, isDecided, stageById, useFieldOrder, type StageModel } from './model';
import { StageNotices } from './StageNotices';
import './stages.css';

export function StageLive({ ctx }: { ctx: AdminCtx }) {
  const { data } = ctx;
  const t = data.tournament;
  const service = useService();
  const now = useNow();
  const model = useMemo(() => buildStageModel(data), [data]);
  const fieldOrder = useFieldOrder(ctx.data.fields);
  const [quick, setQuick] = useState(false);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!model) return null;

  const matches = data.matches.filter((m) => m.stageId);
  const decided = matches.filter(isDecided).length;
  const upcoming = matches.filter((m) => m.status === 'scheduled' && m.startISO && !isDecided(m)).sort((a, b) => a.startISO!.localeCompare(b.startISO!));
  const next = upcoming[0];
  const delayMin = next?.startISO && t.status === 'running' ? Math.floor((now - new Date(next.startISO).getTime()) / 60000) : 0;
  const current = matches.find((m) => m.status === 'live') ?? next;
  const currentStage = current && stageById(model.format, current.stageId);
  const finished = t.status === 'finished' || t.status === 'archived';
  const allDecided = matches.length > 0 && decided === matches.length;

  const slots = groupByTime(matches, fieldOrder);
  const active = slots.filter((s) => s.matches.some((m) => !isDecided(m)));
  const shownActive = more ? active : active.slice(0, 3);
  const done = slots.filter((s) => s.matches.every(isDecided));

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
    }
  };

  return (
    <>
      <div className="kpis">
        <Kpi value={formatTime(new Date(now).toISOString(), t.timeZone)} label="Uhrzeit" />
        <Kpi value={currentStage?.name ?? (allDecided ? 'Fertig' : '–')} label="Abschnitt" />
        <Kpi value={`${decided}/${matches.length}`} label="Spiele entschieden" />
        <Kpi value={next ? formatTime(next.startISO, t.timeZone) : '–'} label="Nächster Anstoß" />
        <Kpi
          value={!next ? '–' : delayMin > 2 ? formatMinutes(delayMin) : 'Im Plan'}
          label={delayMin > 2 ? 'Verzug' : 'Zeitplan'}
          tone={next && delayMin > 2 ? 'warn' : undefined}
        />
      </div>

      <div className="row">
        {t.status === 'draft' ? (
          <button type="button" className="btn pri" onClick={() => run(() => service.publishTournament(t.id))}>
            <Icon name="eye" />
            Veröffentlichen
          </button>
        ) : (
          <CopyButton text={publicUrl(t.id)} label="Öffentlichen Link kopieren" />
        )}
        <a className="btn" href={href({ name: 'public', id: t.id, tab: 'aktuell' })}>
          <Icon name="eye" />
          Öffentliche Seite
        </a>
        <button type="button" className="btn" onClick={() => setShiftOpen(true)} disabled={upcoming.length === 0}>
          <Icon name="clock" />
          Zeitplan verschieben
        </button>
        <span className="spacer" />
        <Seg
          label="Eingabe"
          value={quick ? 'quick' : 'normal'}
          onChange={(v) => setQuick(v === 'quick')}
          options={[
            { value: 'normal', label: 'Live' },
            { value: 'quick', label: 'Schnell' },
          ]}
        />
      </div>

      {t.status === 'draft' && (
        <Notice tone="hint" title="Noch nicht veröffentlicht">
          Zuschauer sehen Gruppen und Spielplan erst, wenn du auf „Veröffentlichen“ drückst.
        </Notice>
      )}
      {error && <Notice tone="warn" title={error} />}
      {next && delayMin > 2 && (
        <Notice tone="hint" title={`Du bist ${delayMin} Minuten hinter dem Plan`}>
          Verschieb die noch nicht begonnenen Spiele, damit Zuschauer die richtigen Anstoßzeiten sehen.
        </Notice>
      )}
      <StageNotices ctx={ctx} model={model} />
      <IssueNotice ctx={ctx} model={model} />

      {quick && <span className="small-text">Schnellmodus: Ergebnis eintragen und mit einem Klick beenden.</span>}
      {shownActive.map((s) => (
        <TimeSlot key={s.startISO ?? 'ohne'} ctx={ctx} slot={s} quick={quick} locked={finished} />
      ))}
      {active.length > 3 && (
        <div className="row">
          <button type="button" className="btn" onClick={() => setMore((v) => !v)}>
            {more ? 'Weniger anzeigen' : active.length - 3 === 1 ? 'Eine weitere Anstoßzeit anzeigen' : `${active.length - 3} weitere Anstoßzeiten anzeigen`}
          </button>
        </div>
      )}
      {allDecided && !finished && (
        <Notice tone="info" title="Alle Spiele sind entschieden">
          <span className="row" style={{ marginTop: 6 }}>
            <button type="button" className="btn pri" onClick={() => run(() => service.finishTournament(t.id))}>
              Turnier abschließen
            </button>
          </span>
        </Notice>
      )}
      {done.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Beendet</h2>
            <button type="button" className="btn" onClick={() => setShowDone((v) => !v)}>
              {showDone ? 'Ausblenden' : `${done.reduce((n, s) => n + s.matches.length, 0)} Spiele zum Korrigieren anzeigen`}
            </button>
          </div>
          {showDone && done.map((s) => <TimeSlot key={s.startISO ?? 'ohne'} ctx={ctx} slot={s} quick={false} locked={finished} />)}
        </section>
      )}

      {shiftOpen && <ShiftDialog ctx={ctx} onClose={() => setShiftOpen(false)} />}
    </>
  );
}

function IssueNotice({ ctx, model }: { ctx: AdminCtx; model: StageModel }) {
  if (model.issues.length === 0) return null;
  return (
    <Notice tone="hint" title={model.issues.length === 1 ? 'Eine Warnung im Spielplan' : `${model.issues.length} Warnungen im Spielplan`}>
      {model.issues[0]!.message}
      {model.issues.length > 1 ? ' …' : ''}{' '}
      <a href={href({ name: 'admin', id: ctx.data.tournament.id, tab: 'spielplan' })}>Im Spielplan ansehen</a>
    </Notice>
  );
}

/** Ein Anstoßzeitpunkt mit allen Spielen und „Alle anpfeifen“. */
export function TimeSlot({
  ctx,
  slot,
  quick,
  locked,
  canCorrect,
}: {
  ctx: AdminCtx;
  slot: { startISO?: string; matches: Match[] };
  quick: boolean;
  locked: boolean;
  canCorrect?: boolean;
}) {
  const service = useService();
  const t = ctx.data.tournament;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const waiting = slot.matches.filter((m) => m.status === 'scheduled' && m.teamAId && m.teamBId && !isDecided(m));
  const time = formatTime(slot.startISO, t.timeZone);

  const startAll = async () => {
    setBusy(true);
    setError(null);
    const results = await Promise.allSettled(waiting.map((m) => service.setMatchStatus(t.id, m.id, 'live')));
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      setError(
        failed === waiting.length
          ? 'Die Spiele ließen sich nicht anpfeifen. Bitte versuch es noch einmal.'
          : `${failed} von ${waiting.length} Spielen ließen sich nicht anpfeifen. Bitte pfeif sie einzeln an.`,
      );
    }
    setBusy(false);
  };

  return (
    <div className="stack">
      <div className="wave-head">
        <span>{slot.startISO ? `${time} Uhr` : 'Ohne Uhrzeit'}</span>
        {!locked && waiting.length > 1 && (
          <>
            <span className="spacer" />
            <button type="button" className="btn pri" disabled={busy} onClick={startAll}>
              <Icon name="live" />
              {busy ? 'Pfeift an …' : `Alle ${time}-Spiele anpfeifen`}
            </button>
          </>
        )}
      </div>
      {error && <Notice tone="warn" title={error} />}
      <div className="grid">
        {slot.matches.map((m) => {
          const extra = stageCardProps(ctx.data, m, ctx.teamName);
          return (
          <MatchCard
            key={`${m.id}-${quick}-${m.teamAId}-${m.teamBId}`}
            tid={t.id}
            match={m}
            teamName={ctx.teamName}
            teamLogo={ctx.teamLogo}
            fieldName={ctx.fieldName(m.fieldId)}
            timeZone={t.timeZone}
            quickMode={quick}
            locked={locked}
            canCorrect={canCorrect}
            {...extra}
            correctWarning={canCorrect === false ? null : extra?.correctWarning}
            lateTeamData={canCorrect === false ? undefined : ctx.data}
          />
          );
        })}
      </div>
    </div>
  );
}
