// Vorschau einer Schweizer-System-Runde: Paarungen, Freilos, Feld und Uhrzeit vor dem Veröffentlichen anpassen.
import { useMemo, useState } from 'react';
import { useService } from '../../data/context';
import type { PairingPreview } from '../../data/types';
import { formatQuotient, formatTime } from '../../format';
import { formatQuotient as formatRatioQ } from '../../../domain/scoring/format';
import { computeStandings } from '../../data/logic';
import {
  EDITED_NOTE,
  hadByeBefore,
  planRound,
  renumberWaves,
  sameSpot,
  slotClashes,
  swapInPreview,
  teamAt,
  type PreviewSpot,
  type RoundSlot,
} from '../../data/roundEdit';
import { zonedLocalToISO } from '../../../domain/schedule';
import { Icon } from '../../components/Icon';
import { Dialog, Notice, TeamName } from '../../components/ui';
import type { AdminCtx } from './AdminTournament';
import './roundPreview.css';

type Override = { fieldId: string; startISO: string };

export function RoundPreviewDialog({
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
  const tz = t.timeZone;
  const standings = useMemo(() => computeStandings(ctx.data), [ctx.data]);
  const q = new Map(standings.map((r) => [r.teamId, r]));
  const fmtQ = (r?: { points: number; played: number }) => (r ? formatRatioQ(r.points, r.played) : '–');
  const [time, setTime] = useState(() => {
    const lastEnd = ctx.data.matches
      .filter((m) => m.startISO)
      .reduce((max, m) => Math.max(max, new Date(m.startISO!).getTime() + m.durationMinutes * 60000), 0);
    const suggested = new Date(Math.max(lastEnd + t.schedule.roundBreakMinutes * 60000, Date.now() + 5 * 60000));
    return formatTime(suggested.toISOString(), tz);
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<PreviewSpot | null>(null);
  // Von Hand gesetztes Feld/Anstoß je Spiel (Index in preview.pairs).
  const [overrides, setOverrides] = useState<Record<number, Override>>({});
  const d = preview.diagnostics;
  const edited = d.warnings.includes(EDITED_NOTE);
  const fields = [...ctx.data.fields].filter((f) => f.active).sort((a, b) => a.order - b.order);

  const validTime = /^\d{2}:\d{2}$/.test(time);
  const startISO = validTime ? zonedLocalToISO(t.localDate, time, tz) : null;
  let planError: string | null = null;
  let slots: RoundSlot[] = [];
  if (startISO) {
    try {
      const auto = planRound(ctx.data, preview, startISO);
      slots = renumberWaves(auto.map((a, i) => overrides[i] ?? a));
    } catch (e) {
      planError = e instanceof Error ? e.message : 'Die Runde ließ sich nicht planen.';
    }
  }
  const label = (i: number) => {
    const p = preview.pairs[i]!;
    return `${ctx.teamName(p.teamAId)} – ${ctx.teamName(p.teamBId)}`;
  };
  const clashes = slots.length ? slotClashes(ctx.data, slots, label) : [];
  const manual = Object.keys(overrides).length > 0;

  const tap = (spot: PreviewSpot) => {
    if (!pick) return setPick(spot);
    if (sameSpot(pick, spot)) return setPick(null);
    const next = swapInPreview(ctx.data, preview, pick, spot);
    setPick(null);
    if (next !== preview) setPreview(next);
  };

  const setSlot = (i: number, change: Partial<Override>) => {
    const cur = slots[i];
    if (!cur) return;
    setOverrides((o) => ({ ...o, [i]: { fieldId: cur.fieldId, startISO: cur.startISO, ...change } }));
  };

  const publish = async () => {
    if (!startISO) return;
    setBusy(true);
    setError(null);
    try {
      // Anstoß in Ortszeit des Turniers, nicht des Geräts.
      await service.publishRound(t.id, preview, startISO, manual ? slots : undefined);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Die Runde ließ sich nicht veröffentlichen.');
      setBusy(false);
    }
  };

  const teamBtn = (spot: PreviewSpot) => {
    const id = teamAt(preview, spot)!;
    const picked = pick && sameSpot(pick, spot);
    const target = pick && !picked;
    const name = ctx.teamName(id);
    return (
      <button
        type="button"
        className={['pv-team', picked ? 'pick' : '', target ? 'target' : ''].filter(Boolean).join(' ')}
        aria-pressed={!!picked}
        aria-label={picked ? `${name} gewählt, nochmal tippen zum Abwählen` : target ? `Mit ${name} tauschen` : `${name} tauschen`}
        onClick={() => tap(spot)}
      >
        <TeamName name={name} logo={ctx.teamLogo(id)} />
        <span className="small-text">{fmtQ(q.get(id))}</span>
      </button>
    );
  };

  return (
    <Dialog title={`Vorschau Runde ${preview.roundNumber}`} onClose={onClose}>
      <div className="row">
        <span className="pill a">{preview.mode === 'draw' ? 'Auslosung' : 'Nach Quotient'}</span>
        <span className={d.repeats > 0 ? 'pill y' : 'pill g'}>
          {d.repeats === 0 ? 'Keine Wiederholung' : `${d.repeats} ${d.repeats === 1 ? 'Wiederholung' : 'Wiederholungen'}`}
        </span>
        {edited ? (
          <span className="pill">Von Hand geändert</span>
        ) : (
          preview.mode === 'swiss' && <span className="pill">Größter Abstand {formatQuotient(d.maxQuotientGap, 2)}</span>
        )}
      </div>
      {!edited &&
        d.warnings.map((w) => (
          <Notice key={w} tone="hint" title={w} />
        ))}

      <div className="inline-field">
        <span className="label">Anstoß der Runde</span>
        <input
          className="input"
          type="time"
          aria-label="Anstoß der Runde"
          value={time}
          onChange={(e) => {
            setTime(e.target.value);
            setOverrides({});
          }}
          style={{ width: 130 }}
        />
      </div>

      {pick ? (
        <div className="notice info pv-bar">
          <b>{ctx.teamName(teamAt(preview, pick)!)} gewählt. Tipp das Team an, mit dem es tauschen soll.</b>
          <button type="button" className="btn compact" onClick={() => setPick(null)}>
            Abbrechen
          </button>
        </div>
      ) : (
        <span className="small-text">
          Gegner ändern: ein Team antippen, dann das Team, mit dem es den Platz tauscht. Feld und Uhrzeit kannst du bei jedem Spiel ändern.
        </span>
      )}

      <div className="list">
        {preview.pairs.map((p, i) => {
          const slot = slots[i];
          return (
            <div key={i} className="list-row pv-row">
              <div className="pv-teams">
                {teamBtn({ pair: i, side: 'A' })}
                {teamBtn({ pair: i, side: 'B' })}
              </div>
              <div className="pv-slot">
                {p.repeat > 0 && <span className="pill y">{p.repeat + 1}. Duell</span>}
                {slot && (
                  <>
                    <select
                      className="select"
                      aria-label={`Feld für ${label(i)}`}
                      value={slot.fieldId}
                      onChange={(e) => setSlot(i, { fieldId: e.target.value })}
                    >
                      {fields.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                    <input
                      className="input"
                      type="time"
                      aria-label={`Anstoß für ${label(i)}`}
                      value={formatTime(slot.startISO, tz)}
                      onChange={(e) => {
                        if (/^\d{2}:\d{2}$/.test(e.target.value)) setSlot(i, { startISO: zonedLocalToISO(t.localDate, e.target.value, tz) });
                      }}
                    />
                  </>
                )}
              </div>
            </div>
          );
        })}
        {preview.byeTeamId && (
          <div className="list-row pv-row">
            <span className="pill">Freilos</span>
            <div className="pv-teams">{teamBtn({ pair: 'bye' })}</div>
          </div>
        )}
      </div>

      {hadByeBefore(ctx.data, preview.byeTeamId) && (
        <Notice tone="hint" title={`${ctx.teamName(preview.byeTeamId!)} hatte schon ein Freilos.`}>
          Das ist erlaubt, aber prüf, ob es so gewollt ist.
        </Notice>
      )}
      {planError && <Notice tone="warn" title="Spielplan passt so nicht">{planError}</Notice>}
      {clashes.length > 0 && (
        <Notice tone="warn" title="Feld doppelt belegt">
          <ul className="pv-list">
            {clashes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          Ändere Feld oder Uhrzeit, dann kannst du veröffentlichen.
        </Notice>
      )}
      {manual && (
        <button type="button" className="btn compact" onClick={() => setOverrides({})}>
          Felder und Zeiten wieder automatisch planen
        </button>
      )}
      {error && <Notice tone="warn" title="Nicht veröffentlicht">{error}</Notice>}
      <span className="small-text">Erst mit „Runde veröffentlichen“ sehen Zuschauer die Paarungen. Danach ändern sie sich nicht mehr von selbst.</span>
      <div className="row">
        <button type="button" className="btn pri" disabled={busy || !startISO || !!planError || clashes.length > 0} onClick={publish}>
          {busy ? 'Speichert …' : 'Runde veröffentlichen'}
        </button>
        {preview.mode === 'draw' && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setOverrides({});
              setPreview(service.previewNextRound(t.id, Date.now()));
            }}
          >
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
