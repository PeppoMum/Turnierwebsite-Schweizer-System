// Nach einem Ausfall: frei gewordene Spielzeiten nutzen. Die Seite schlägt vor, spätere Spiele nach vorne
// zu ziehen („Plan straffen“) und, wenn eine Gruppe nur noch 3 Teams hat, dass sie stattdessen länger
// spielt (Haken, standardmäßig aus). Die Turnierleitung sieht vorher, was sich ändert; alles im Verlauf.
import { useMemo, useState } from 'react';
import type { Match } from '../../../../domain';
import {
  compactStagePlan,
  longerGroupOptions,
  longerGroupPlacements,
  type CompactMatch,
  type CompactResult,
  type LongerGroupOption,
  type MatchPlacement,
} from '../../../../domain/schedule';
import { finalsMismatches } from '../../../../domain/format/reshape';
import { useService } from '../../../data/context';
import type { TournamentData } from '../../../data/types';
import { formatTime } from '../../../format';
import { useNow } from '../../../hooks';
import { Dialog, Notice } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import type { AdminCtx } from '../AdminTournament';
import { groupName, sideText } from './model';
import './stages.css';

function compactMatchesOf(d: TournamentData): CompactMatch[] {
  return d.matches
    .filter((m) => m.stageId)
    .map((m) => ({
      id: m.id,
      stageId: m.stageId!,
      groupIndex: m.groupIndex,
      matchKey: m.matchKey,
      teamAId: m.teamAId || undefined,
      teamBId: m.teamBId || undefined,
      slotA: m.slotA,
      slotB: m.slotB,
      fieldId: m.fieldId,
      startISO: m.startISO,
      durationMinutes: m.durationMinutes,
      waveIndex: m.waveIndex,
      status: m.status,
      manual: m.manual,
    }));
}

function presentTeamIds(d: TournamentData): Set<string> {
  return new Set(d.teams.filter((t) => t.checkedInAt).map((t) => t.id));
}

/** Aktive Teams je Gruppe (`stageId|groupIndex`), für „Dreiergruppe spielt länger“. */
function activeGroups(d: TournamentData): Map<string, string[]> {
  const active = new Set(d.teams.filter((t) => t.status === 'active').map((t) => t.id));
  const out = new Map<string, string[]>();
  for (const draw of d.groupDraws ?? []) {
    draw.groups.forEach((teams, g) => out.set(`${draw.stageId}|${g}`, teams.filter((id) => active.has(id))));
  }
  return out;
}

interface Proposal {
  result: CompactResult;
  longer: LongerGroupOption[];
}

function propose(d: TournamentData, nowISO: string, extend: ReadonlyMap<string, number> = new Map()): Proposal & { longerPlacements: MatchPlacement[] } {
  const format = d.tournament.format!;
  const s = d.tournament.schedule;
  const base = compactMatchesOf(d);
  const longer = longerGroupOptions(base, activeGroups(d), { format, turnoverMinutes: s.turnoverMinutes });
  const longerPlacements: MatchPlacement[] = [];
  const keep = new Set<string>();
  for (const o of longer) {
    const minutes = extend.get(keyOf(o));
    if (minutes === undefined || !fits(o, minutes)) continue;
    longerPlacements.push(...longerGroupPlacements(base, o, minutes));
    for (const id of o.matchIds) keep.add(id);
  }
  const byId = new Map(longerPlacements.map((p) => [p.matchId, p]));
  const working = base.map((m) => (byId.has(m.id) ? { ...m, durationMinutes: byId.get(m.id)!.durationMinutes! } : m));
  const result = compactStagePlan(working, {
    format,
    nowISO,
    turnoverMinutes: s.turnoverMinutes,
    desiredRestMinutes: s.matchMinutes,
    presentTeamIds: presentTeamIds(d),
    teamNames: new Map(d.teams.map((t) => [t.id, t.name])),
    keepIds: keep,
  });
  return { result, longer, longerPlacements };
}

const keyOf = (o: LongerGroupOption) => `${o.stageId}|${o.groupIndex}`;
const fits = (o: LongerGroupOption, minutes: number) => Number.isInteger(minutes) && minutes > o.currentMinutes && minutes <= o.maxMinutes;

/** Hinweis in Cockpit und Spielplan, sobald sich nach einem Ausfall etwas straffen lässt. */
export function CompactNotice({ ctx }: { ctx: AdminCtx }) {
  const { data } = ctx;
  const t = data.tournament;
  const now = useNow();
  // Minutengenau reicht; so rechnet die Vorschau nicht bei jedem Sekundentakt neu.
  const minute = Math.floor(now / 60_000) * 60_000;
  const proposal = useMemo(() => (t.format ? propose(data, new Date(minute).toISOString()) : null), [data, t.format, minute]);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  if (!proposal || hidden || t.status === 'finished' || t.status === 'archived') return null;
  const { result, longer } = proposal;
  if (result.moves.length === 0 && longer.length === 0) return null;
  const tz = t.timeZone;
  const n = result.moves.length;
  return (
    <Notice tone="info" title="Durch einen Ausfall sind Spielzeiten frei geworden" onClose={() => setHidden(true)}>
      {n > 0 ? (
        <>
          Du kannst den Plan straffen: {n === 1 ? 'ein Spiel rückt' : `${n} Spiele rücken`} nach vorne
          {result.newEndISO && result.oldEndISO && result.newEndISO !== result.oldEndISO
            ? `, das letzte Spiel endet dann um ${formatTime(result.newEndISO, tz)} statt ${formatTime(result.oldEndISO, tz)} Uhr`
            : ''}
          .
        </>
      ) : (
        'Nach vorne ziehen lässt sich gerade nichts.'
      )}{' '}
      {longer.map((o) => `${groupName(t.format!, o.stageId, o.groupIndex)} hat nur noch 3 Teams und könnte stattdessen länger spielen.`).join(' ')}
      <span className="row" style={{ marginTop: 6 }}>
        <button type="button" className="btn pri" onClick={() => setOpen(true)}>
          <Icon name="clock" />
          Vorschau ansehen
        </button>
      </span>
      {open && <CompactDialog ctx={ctx} onClose={() => setOpen(false)} />}
    </Notice>
  );
}

function CompactDialog({ ctx, onClose }: { ctx: AdminCtx; onClose: () => void }) {
  const service = useService();
  const { data } = ctx;
  const t = data.tournament;
  const tz = t.timeZone;
  const format = t.format!;
  const [nowISO] = useState(() => new Date().toISOString());
  const [extend, setExtend] = useState<Map<string, number>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { result, longer, longerPlacements } = useMemo(() => propose(data, nowISO, extend), [data, nowISO, extend]);
  const options = useMemo(() => propose(data, nowISO).longer, [data, nowISO]);
  const byId = (id: string) => data.matches.find((m) => m.id === id) as Match;
  const label = (m: Match) => `${sideText(m, 'A', format, ctx.teamName)} – ${sideText(m, 'B', format, ctx.teamName)}`;
  const nothing = result.moves.length === 0 && longerPlacements.length === 0;
  const invalid = options.some((o) => extend.has(keyOf(o)) && !fits(o, extend.get(keyOf(o))!));

  const setMinutes = (o: LongerGroupOption, minutes: number | null) => {
    const next = new Map(extend);
    if (minutes === null) next.delete(keyOf(o));
    else next.set(keyOf(o), minutes);
    setExtend(next);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (longerPlacements.length > 0) await service.placeMatches(t.id, 'longer', longerPlacements);
      if (result.moves.length > 0) {
        await service.placeMatches(
          t.id,
          'compact',
          result.moves.map(({ matchId, fieldId, startISO, waveIndex }) => ({ matchId, fieldId, startISO, ...(waveIndex !== undefined ? { waveIndex } : {}) })),
        );
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
      setBusy(false);
    }
  };

  return (
    <Dialog title="Plan straffen" onClose={onClose}>
      <span className="small-text">
        Spätere Spiele rücken in die frei gewordenen Zeiten. Wer schon früh dran war, bleibt ungefähr früh. Mannschaften, die als „ist da“
        abgehakt sind, kommen zuerst dran. Wenn es geht, hat jede Mannschaft mindestens ein Spiel Pause; Pausen werden aber nie extra
        eingebaut. Laufende, beendete und von Hand verschobene Spiele bleiben, wo sie sind.
      </span>

      {options.map((o) => {
        const on = extend.has(keyOf(o));
        const minutes = extend.get(keyOf(o)) ?? o.suggestedMinutes;
        const valid = fits(o, minutes);
        return (
          <div key={keyOf(o)} className="stack tight">
            <label className="check">
              <input type="checkbox" checked={on} onChange={(e) => setMinutes(o, e.target.checked ? o.suggestedMinutes : null)} />
              <span>
                {groupName(format, o.stageId, o.groupIndex)} hat nur noch 3 Teams: stattdessen länger spielen
              </span>
            </label>
            {on && (
              <label className="field">
                <span className="label">
                  Spielzeit in Minuten (bisher {o.currentMinutes}, höchstens {o.maxMinutes})
                </span>
                <input
                  className="input"
                  type="number"
                  inputMode="numeric"
                  min={o.currentMinutes + 1}
                  max={o.maxMinutes}
                  value={minutes}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setMinutes(o, Number.isFinite(v) ? Math.round(v) : 0);
                  }}
                />
                {!valid && <span className="field-error">Bitte zwischen {o.currentMinutes + 1} und {o.maxMinutes} Minuten.</span>}
                <span className="small-text">
                  Die Spiele dieser Gruppe nutzen die frei gewordene Zeit auf ihrem Feld. Für alle anderen bleiben Zeiten und Pausen gleich. Die
                  Wertung bleibt, wie sie ist. Die längere Spielzeit steht im Spielplan, bei den Helfern und auf der Zuschauerseite.
                </span>
              </label>
            )}
          </div>
        );
      })}

      {nothing ? (
        <Notice tone="info" title="Gerade lässt sich nichts nach vorne ziehen." />
      ) : (
        <>
          {result.moves.length > 0 && (
            <ul className="stage-fill-list">
              {result.moves.map((mv) => {
                const m = byId(mv.matchId);
                const field = mv.fieldId !== mv.fromFieldId ? `, jetzt ${ctx.fieldName(mv.fieldId)}` : '';
                return (
                  <li key={mv.matchId}>
                    <b>{label(m)}</b>: {formatTime(mv.startISO, tz)} statt {formatTime(mv.fromStartISO, tz)} Uhr{field}
                  </li>
                );
              })}
            </ul>
          )}
          {longer
            .filter((o) => extend.has(keyOf(o)) && fits(o, extend.get(keyOf(o))!))
            .map((o) => (
              <span key={keyOf(o)}>
                {groupName(format, o.stageId, o.groupIndex)} spielt {extend.get(keyOf(o))} statt {o.currentMinutes} Minuten ({o.matchIds.length}{' '}
                {o.matchIds.length === 1 ? 'Spiel' : 'Spiele'}).
              </span>
            ))}
          {result.newEndISO && result.oldEndISO && (
            <span>
              Letztes Spiel endet um <b>{formatTime(result.newEndISO, tz)} Uhr</b>
              {result.newEndISO !== result.oldEndISO ? ` (bisher ${formatTime(result.oldEndISO, tz)} Uhr)` : ' (wie bisher)'}.
            </span>
          )}
        </>
      )}

      {result.hints.length > 0 && (
        <Notice tone="hint" title="Vielleicht noch nicht da">
          <ul className="stage-fill-list">
            {result.hints.map((h) => (
              <li key={h.matchId + h.teamId}>{h.message}</li>
            ))}
          </ul>
          Hak unter „Teams“ ab, wer schon da ist; dann rechnet die Seite neu.
        </Notice>
      )}
      {result.restWarnings.length > 0 && (
        <Notice tone="hint" title="Kürzere Pausen">
          <ul className="stage-fill-list">
            {result.restWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Notice>
      )}
      <span className="small-text">Ist das Turnier veröffentlicht, sehen Zuschauer die neuen Zeiten sofort. Die Änderung steht im Verlauf und lässt sich dort rückgängig machen.</span>
      {error && <span className="field-error">{error}</span>}
      <div className="row">
        <button type="button" className="btn pri" disabled={busy || nothing || invalid} onClick={save}>
          {busy ? 'Speichert …' : 'Übernehmen'}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Abbrechen
        </button>
      </div>
    </Dialog>
  );
}

/**
 * Ausfall in der Gruppenphase: Hat eine Gruppe dadurch weniger Teams, bekommt eine Endrunde womöglich zu
 * wenige (z. B. Bronzerunde nur noch 3). Die Seite sagt das und führt zum Umstellen (Dreiergruppe oder
 * streichen; Logik in src/domain/format/reshape.ts). `onReshape` öffnet den Dialog dafür.
 */
export function GroupLossNotice({ ctx, onReshape }: { ctx: AdminCtx; onReshape?: () => void }) {
  const { data } = ctx;
  const t = data.tournament;
  const format = t.format;
  const first = format?.stages[0];
  const mismatches = useMemo(() => {
    if (!format || first?.kind !== 'groups') return [];
    const draw = data.groupDraws?.find((g) => g.stageId === first.id);
    if (!draw) return [];
    const active = new Set(data.teams.filter((x) => x.status === 'active').map((x) => x.id));
    const sizes = draw.groups.map((g) => g.filter((id) => active.has(id)).length);
    if (sizes.every((n, i) => n === draw.groups[i]!.length)) return [];
    // Nur Endrunden, die noch nicht angefangen haben, lassen sich anpassen.
    return finalsMismatches(format, sizes).filter((x) => data.matches.every((m) => m.stageId !== x.stageId || m.status === 'scheduled' || m.status === 'draft'));
  }, [data, format, first]);
  if (mismatches.length === 0 || t.status === 'finished' || t.status === 'archived') return null;
  return (
    <Notice tone="hint" title="Durch den Ausfall ändert sich die Endrunde">
      <ul className="stage-fill-list">
        {mismatches.map((x) => (
          <li key={x.stageId}>
            {x.name}: nur noch {x.count} statt {x.capacity} Teams.
            {x.count === 3 ? ' Du kannst daraus eine Dreiergruppe machen oder sie streichen (dann teilen sich die Teams die Plätze).' : ''}
          </li>
        ))}
      </ul>
      {onReshape && (
        <span className="row" style={{ marginTop: 6 }}>
          <button type="button" className="btn pri" onClick={onReshape}>
            <Icon name="shuffle" />
            Endrunde anpassen
          </button>
        </span>
      )}
    </Notice>
  );
}
