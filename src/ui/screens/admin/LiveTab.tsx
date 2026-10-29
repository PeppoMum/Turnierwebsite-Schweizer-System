// Admin-Live-Cockpit (Spezifikation §4.3).
import { useMemo, useState } from 'react';
import type { Match } from '../../../domain';
import { useService } from '../../data/context';
import type { PairingPreview } from '../../data/types';
import { useNow } from '../../hooks';
import { formatMinutes, formatQuotient, formatTime } from '../../format';
import { formatQuotient as formatRatioQ } from '../../../domain/scoring/format';
import { href, publicUrl } from '../../router';
import { computeStandings } from '../../data/logic';
import { zonedLocalToISO } from '../../../domain/schedule';
import { Icon } from '../../components/Icon';
import { CopyButton, Dialog, EmptyState, Kpi, Notice, Seg, TeamName } from '../../components/ui';
import { MatchCard } from './MatchCard';
import type { AdminCtx } from './AdminTournament';

export function groupByWave(matches: Match[]): Array<{ wave: number; startISO?: string; matches: Match[] }> {
  const map = new Map<number, Match[]>();
  for (const m of matches) {
    const w = m.waveIndex ?? 0;
    map.set(w, [...(map.get(w) ?? []), m]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([wave, ms]) => ({ wave, startISO: ms[0]?.startISO, matches: ms.sort((a, b) => (a.fieldId ?? '').localeCompare(b.fieldId ?? '')) }));
}

export function LiveTab({ ctx }: { ctx: AdminCtx }) {
  const { data } = ctx;
  const t = data.tournament;
  const now = useNow();
  const [quick, setQuick] = useState(false);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [preview, setPreview] = useState<PairingPreview | null>(null);
  const service = useService();

  const round = data.rounds.find((r) => r.number === t.currentRound);
  const roundMatches = data.matches.filter((m) => m.roundNumber === t.currentRound);
  const decided = roundMatches.filter((m) => m.status === 'completed' || m.status === 'not_played' || m.status === 'cancelled').length;
  const allDecided = roundMatches.length > 0 && decided === roundMatches.length;
  const upcoming = data.matches.filter((m) => m.status === 'scheduled' && m.startISO).sort((a, b) => a.startISO!.localeCompare(b.startISO!));
  const next = upcoming[0];
  // Verzug nur zeigen, wenn das Turnier schon läuft.
  const delayMin = next?.startISO && t.status === 'running' ? Math.floor((now - new Date(next.startISO).getTime()) / 60000) : 0;
  const bye = round ? data.byes.find((b) => b.roundId === round.id) : undefined;
  const isLastRound = t.currentRound >= t.roundsTotal;
  const finished = t.status === 'finished' || t.status === 'archived';

  if (!round) {
    return (
      <EmptyState
        text={t.status === 'draft' ? 'Das Turnier ist noch ein Entwurf. Lose die erste Runde aus, um es zu starten.' : 'Noch keine Runde veröffentlicht.'}
        action={
          <button type="button" className="btn pri" onClick={() => setPreview(service.previewNextRound(t.id))}>
            Erste Runde auslosen
          </button>
        }
      />
    );
  }

  return (
    <>
      <div className="kpis">
        <Kpi value={formatTime(new Date(now).toISOString(), t.timeZone)} label="Uhrzeit" />
        <Kpi value={`${t.currentRound}/${t.roundsTotal}`} label="Runde" />
        <Kpi value={`${decided}/${roundMatches.length}`} label="Spiele entschieden" />
        <Kpi value={next ? formatTime(next.startISO, t.timeZone) : '–'} label="Nächster Anstoß" />
        <Kpi
          value={!next ? '–' : delayMin > 2 ? formatMinutes(delayMin) : 'Im Plan'}
          label={delayMin > 2 ? 'Verzug' : 'Zeitplan'}
          tone={next && delayMin > 2 ? 'warn' : undefined}
        />
      </div>

      <div className="row">
        <CopyButton text={publicUrl(t.id)} label="Öffentlichen Link kopieren" />
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

      {next && delayMin > 2 && (
        <Notice tone="hint" title={`Du bist ${delayMin} Minuten hinter dem Plan`}>
          Verschieb die noch nicht begonnenen Spiele, damit Zuschauer die richtigen Anstoßzeiten sehen.
        </Notice>
      )}

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">
            Runde {round.number}
            {round.mode === 'draw' ? ', ausgelost' : ''}
          </h2>
          {!finished && (
            <RoundAction
              allDecided={allDecided}
              isLast={isLastRound}
              closed={round.status === 'closed'}
              onClose={() => service.closeCurrentRound(t.id)}
              onNext={() => setPreview(service.previewNextRound(t.id))}
              onFinish={() => service.finishTournament(t.id)}
            />
          )}
        </div>
        {quick && <span className="small-text">Schnellmodus: Ergebnis eintragen und mit einem Klick beenden.</span>}
        {groupByWave(roundMatches).map((w) => (
          <WaveBlock key={w.wave} ctx={ctx} wave={w} quick={quick} locked={finished} />
        ))}
        {bye && (
          <div className="row">
            <span className="pill">Freilos</span>
            <TeamName name={ctx.teamName(bye.teamId)} logo={ctx.teamLogo(bye.teamId)} />
          </div>
        )}
      </section>

      {shiftOpen && <ShiftDialog ctx={ctx} onClose={() => setShiftOpen(false)} />}
      {preview && <RoundPreviewDialog ctx={ctx} preview={preview} setPreview={setPreview} onClose={() => setPreview(null)} />}
    </>
  );
}

/** Eine Anstoßzeit (Welle) mit allen Spielen und „Alle anpfeifen“. Auch in der Helferansicht. */
export function WaveBlock({
  ctx,
  wave,
  quick,
  locked,
  canCorrect,
}: {
  ctx: AdminCtx;
  wave: ReturnType<typeof groupByWave>[number];
  quick: boolean;
  locked: boolean;
  canCorrect?: boolean;
}) {
  const service = useService();
  const t = ctx.data.tournament;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const waiting = wave.matches.filter((m) => m.status === 'scheduled');
  const time = formatTime(wave.startISO, t.timeZone);

  const startAll = async () => {
    setBusy(true);
    setError(null);
    // Einzeln speichern: jedes Spiel hat seinen eigenen Stand. Fehler sammeln, den Rest trotzdem anpfeifen.
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
        <span>Welle {wave.wave + 1}</span>
        <span className="muted">{time} Uhr</span>
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
        {wave.matches.map((m) => (
          <MatchCard
            key={`${m.id}-${quick}`}
            tid={t.id}
            match={m}
            teamName={ctx.teamName}
            teamLogo={ctx.teamLogo}
            fieldName={ctx.fieldName(m.fieldId)}
            timeZone={t.timeZone}
            quickMode={quick}
            locked={locked}
            canCorrect={canCorrect}
          />
        ))}
      </div>
    </div>
  );
}

function RoundAction({
  allDecided,
  isLast,
  closed,
  onClose,
  onNext,
  onFinish,
}: {
  allDecided: boolean;
  isLast: boolean;
  closed: boolean;
  onClose: () => void;
  onNext: () => void;
  onFinish: () => void;
}) {
  if (!allDecided) {
    return (
      <button type="button" className="btn" disabled title="Erst wenn alle Spiele beendet oder als nicht ausgetragen markiert sind">
        Neue Runde berechnen
      </button>
    );
  }
  if (!closed) {
    return (
      <button type="button" className="btn pri" onClick={onClose}>
        Runde abschließen
      </button>
    );
  }
  if (isLast) {
    return (
      <button type="button" className="btn pri" onClick={onFinish}>
        Turnier abschließen
      </button>
    );
  }
  return (
    <button type="button" className="btn pri" onClick={onNext}>
      Neue Runde berechnen
    </button>
  );
}

export function ShiftDialog({ ctx, onClose }: { ctx: AdminCtx; onClose: () => void }) {
  const service = useService();
  const t = ctx.data.tournament;
  const [delta, setDelta] = useState(10);
  const affected = ctx.data.matches.filter((m) => m.status === 'scheduled' && m.startISO);
  const sample = affected.slice(0, 4);
  const shifted = (iso: string) => new Date(new Date(iso).getTime() + delta * 60000).toISOString();
  return (
    <Dialog title="Zeitplan verschieben" onClose={onClose}>
      <p>Es verschieben sich nur Spiele, die noch nicht angepfiffen sind. Laufende und beendete Spiele behalten ihre Zeit.</p>
      <div className="row">
        <button type="button" className="btn sq" aria-label="5 Minuten früher" onClick={() => setDelta((d) => d - 5)}>
          <Icon name="minus" />
        </button>
        <input className="input num" style={{ width: 90 }} type="number" step={5} aria-label="Minuten" value={delta} onChange={(e) => setDelta(Number(e.target.value) || 0)} />
        <button type="button" className="btn sq" aria-label="5 Minuten später" onClick={() => setDelta((d) => d + 5)}>
          <Icon name="plus" />
        </button>
        <span className="muted">Minuten {delta >= 0 ? 'später' : 'früher'}</span>
      </div>
      <div className="table-box">
        <table className="table">
          <thead>
            <tr>
              <th className="l">Spiel</th>
              <th>Bisher</th>
              <th>Neu</th>
            </tr>
          </thead>
          <tbody>
            {sample.map((m) => (
              <tr key={m.id}>
                <td className="l" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {m.teamAId ? ctx.teamName(m.teamAId) : 'offen'} – {m.teamBId ? ctx.teamName(m.teamBId) : 'offen'}
                </td>
                <td>{formatTime(m.startISO, t.timeZone)}</td>
                <td style={{ fontWeight: 700 }}>{formatTime(shifted(m.startISO!), t.timeZone)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span className="small-text">
        {affected.length} {affected.length === 1 ? 'Spiel ist' : 'Spiele sind'} betroffen. Felder bleiben gleich, es entstehen keine Überschneidungen.
      </span>
      <div className="row">
        <button
          type="button"
          className="btn pri"
          disabled={delta === 0}
          onClick={async () => {
            await service.shiftFutureMatches(t.id, delta);
            onClose();
          }}
        >
          {affected.length} Spiele verschieben
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Abbrechen
        </button>
      </div>
    </Dialog>
  );
}

function RoundPreviewDialog({
  ctx,
  preview,
  setPreview,
  onClose,
}: {
  ctx: AdminCtx;
  preview: PairingPreview;
  setPreview: (p: PairingPreview) => void;
  onClose: () => void;
}) {
  const service = useService();
  const t = ctx.data.tournament;
  const standings = useMemo(() => computeStandings(ctx.data), [ctx.data]);
  const q = new Map(standings.map((r) => [r.teamId, r]));
  const fmtQ = (r?: { points: number; played: number }) => (r ? formatRatioQ(r.points, r.played) : '–');
  const [time, setTime] = useState(() => {
    const lastEnd = ctx.data.matches
      .filter((m) => m.startISO)
      .reduce((max, m) => Math.max(max, new Date(m.startISO!).getTime() + m.durationMinutes * 60000), 0);
    const suggested = new Date(Math.max(lastEnd + t.schedule.roundBreakMinutes * 60000, Date.now() + 5 * 60000));
    return formatTime(suggested.toISOString(), t.timeZone);
  });
  const [busy, setBusy] = useState(false);
  const d = preview.diagnostics;

  const [error, setError] = useState<string | null>(null);
  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      // Anstoß in Ortszeit des Turniers, nicht des Geräts.
      await service.publishRound(t.id, preview, zonedLocalToISO(t.localDate, time, t.timeZone));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Die Runde ließ sich nicht veröffentlichen.');
      setBusy(false);
    }
  };

  return (
    <Dialog title={`Vorschau Runde ${preview.roundNumber}`} onClose={onClose}>
      <div className="row">
        <span className="pill a">{preview.mode === 'draw' ? 'Auslosung' : 'Nach Quotient'}</span>
        <span className={d.repeats > 0 ? 'pill y' : 'pill g'}>
          {d.repeats === 0 ? 'Keine Wiederholung' : `${d.repeats} ${d.repeats === 1 ? 'Wiederholung' : 'Wiederholungen'}`}
        </span>
        {preview.mode === 'swiss' && <span className="pill">Größter Abstand {formatQuotient(d.maxQuotientGap, 2)}</span>}
      </div>
      {d.warnings.map((w) => (
        <Notice key={w} tone="hint" title={w} />
      ))}
      <div className="list">
        {preview.pairs.map((p) => (
          <div key={p.teamAId} className="list-row" style={{ flexWrap: 'wrap' }}>
            <span className="grow" style={{ display: 'grid', gap: 4 }}>
              <span className="row" style={{ flexWrap: 'nowrap', justifyContent: 'space-between' }}>
                <TeamName name={ctx.teamName(p.teamAId)} logo={ctx.teamLogo(p.teamAId)} />
                <span className="small-text">{fmtQ(q.get(p.teamAId))}</span>
              </span>
              <span className="row" style={{ flexWrap: 'nowrap', justifyContent: 'space-between' }}>
                <TeamName name={ctx.teamName(p.teamBId)} logo={ctx.teamLogo(p.teamBId)} />
                <span className="small-text">{fmtQ(q.get(p.teamBId))}</span>
              </span>
            </span>
            {p.repeat > 0 && <span className="pill y">{p.repeat + 1}. Duell</span>}
          </div>
        ))}
        {preview.byeTeamId && (
          <div className="list-row">
            <span className="pill">Freilos</span>
            <span className="grow">{ctx.teamName(preview.byeTeamId)}</span>
          </div>
        )}
      </div>
      <div className="inline-field">
        <span className="label">Anstoß</span>
        <input className="input" type="time" aria-label="Anstoß der Runde" value={time} onChange={(e) => setTime(e.target.value)} style={{ width: 130 }} />
      </div>
      {error && <Notice tone="warn" title="Nicht veröffentlicht">{error}</Notice>}
      <span className="small-text">Erst mit „Runde veröffentlichen“ sehen Zuschauer die Paarungen. Danach ändern sie sich nicht mehr von selbst.</span>
      <div className="row">
        <button type="button" className="btn pri" disabled={busy} onClick={publish}>
          {busy ? 'Speichert …' : 'Runde veröffentlichen'}
        </button>
        {preview.mode === 'draw' && (
          <button type="button" className="btn" onClick={() => setPreview(service.previewNextRound(t.id, Date.now()))}>
            <Icon name="shuffle" />
            Neu auslosen
          </button>
        )}
        <button type="button" className="btn" onClick={onClose}>
          Abbrechen
        </button>
      </div>
    </Dialog>
  );
}
