// „Turnier umstellen“: Die Turnierleitung hakt an, welche Teams fehlen, und bekommt zwei oder drei fertige
// Vorschläge mit Zahl der Spiele und neuer Endzeit. Ein Klick übernimmt einen Vorschlag; er steht im Verlauf
// und lässt sich dort zurücknehmen. Nach dem ersten Anpfiff in der Vorrunde passt sich nur noch die Endrunde an.
import { useMemo, useState } from 'react';
import type { ThreeTeamChoice } from '../../../../domain/format';
import { groupLetter } from '../../../../domain/groups';
import { useService } from '../../../data/context';
import type { TournamentData } from '../../../data/types';
import { formatTime } from '../../../format';
import { Dialog, Notice } from '../../../components/ui';
import { currentEndISO, currentGroups, groupsStarted, inactiveTeamIds, reshapeOptions, type ReshapeOption } from './reshape';

export function ReshapeDialog({ data, onClose }: { data: TournamentData; onClose: () => void }) {
  const service = useService();
  const t = data.tournament;
  const started = groupsStarted(data);
  const groups = currentGroups(data);
  const teamName = (id: string) => data.teams.find((x) => x.id === id)?.name ?? 'Unbekannt';
  const alreadyOut = inactiveTeamIds(data);
  const [missing, setMissing] = useState<string[]>([]);
  const [choices, setChoices] = useState<Record<string, ThreeTeamChoice>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(() => reshapeOptions(data, missing, choices), [data, missing, choices]);
  const endBefore = currentEndISO(data);
  const time = (iso?: string) => (iso ? formatTime(iso, t.timeZone) : '–');

  const toggle = (id: string) => setMissing((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  const apply = async (o: ReshapeOption) => {
    setBusy(o.suggestion.kind);
    setError(null);
    try {
      await service.reshapeTournament(t.id, {
        title: o.suggestion.title,
        format: o.suggestion.format,
        ...(o.suggestion.kind === 'finals' ? {} : { groups: o.suggestion.groups }),
        missingTeamIds: started ? [] : missing,
        plan: o.plan,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
      setBusy(null);
    }
  };

  return (
    <Dialog title="Turnier umstellen" onClose={onClose}>
      {started ? (
        <p style={{ margin: 0 }}>
          In den Gruppen wird schon gespielt. Gespielt ist gespielt: Die Gruppen bleiben, nur die Endrunde passt sich an die Teams an, die noch dabei
          sind.
          {alreadyOut.length > 0 && <> Ausgefallen: {alreadyOut.map(teamName).join(', ')}.</>}
        </p>
      ) : (
        <>
          <p style={{ margin: 0 }}>Welche Teams fehlen? Die Seite schlägt dir dann vor, wie das Turnier weiterläuft.</p>
          <div className="reshape-groups">
            {groups.map((g, gi) => (
              <fieldset key={gi} className="reshape-group">
                <legend>Gruppe {groupLetter(gi)}</legend>
                {g.map((id) => {
                  const out = alreadyOut.includes(id);
                  const present = !!(data.teams.find((x) => x.id === id) as { checkedInAt?: string } | undefined)?.checkedInAt;
                  return (
                    <label key={id} className="check">
                      <input type="checkbox" checked={out || missing.includes(id)} disabled={out} onChange={() => toggle(id)} />
                      <span>
                        {teamName(id)}
                        {out && <span className="pill o">fehlt schon</span>}
                        {present && !out && <span className="pill g">ist da</span>}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            ))}
          </div>
        </>
      )}

      {error && <Notice tone="warn" title={error} />}
      {options.length === 0 ? (
        <span className="small-text">
          {started
            ? 'Die Endrunde passt so, wie sie ist. Fällt ein Team aus, zieh es zuerst unter „Teams“ zurück.'
            : 'Hake an, welche Teams fehlen.'}
        </span>
      ) : (
        <div className="stack">
          {options.map((o, i) => (
            <div key={o.suggestion.kind} className="card reshape-option">
              <div className="row">
                <b>{o.suggestion.title}</b>
                {i === 0 && options.length > 1 && <span className="pill a">Vorschlag</span>}
              </div>
              <span>{o.suggestion.summary}</span>
              <div className="reshape-facts">
                <span>
                  <b>{o.matchCount}</b> Spiele
                </span>
                <span>
                  Ende ca. <b>{time(o.endISO)}</b> Uhr{endBefore && endBefore !== o.endISO ? ` (bisher ${time(endBefore)} Uhr)` : ''}
                </span>
              </div>
              {o.suggestion.notes.length > 0 && (
                <ul className="stage-fill-list">
                  {o.suggestion.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
              {o.suggestion.threeTeamStages.map((s) => (
                <div key={s.stageId} className="stack tight" role="radiogroup" aria-label={`${s.name} mit 3 Teams`}>
                  <span className="small-text">
                    {s.name} hat nur 3 Teams. Wie soll es weitergehen?
                  </span>
                  <label className="check">
                    <input
                      type="radio"
                      name={`three-${o.suggestion.kind}-${s.stageId}`}
                      checked={(choices[s.stageId] ?? 'group') === 'group'}
                      onChange={() => setChoices((c) => ({ ...c, [s.stageId]: 'group' }))}
                    />
                    <span>Dreiergruppe, jeder gegen jeden (3 Spiele)</span>
                  </label>
                  <label className="check">
                    <input
                      type="radio"
                      name={`three-${o.suggestion.kind}-${s.stageId}`}
                      checked={choices[s.stageId] === 'drop'}
                      onChange={() => setChoices((c) => ({ ...c, [s.stageId]: 'drop' }))}
                    />
                    <span>
                      Streichen, die drei teilen sich Platz {s.placeFrom} bis {s.placeTo}
                    </span>
                  </label>
                </div>
              ))}
              {o.earlyTeamIds.length > 0 && (
                <Notice tone="hint" title="Vielleicht noch nicht da">
                  Früher dran als geplant: {o.earlyTeamIds.map(teamName).join(', ')}. Hake unter „Teams“ an, wer schon da ist.
                </Notice>
              )}
              {o.problems.length > 0 && <Notice tone="warn" title={o.problems.join(' ')} />}
              <div className="row">
                <button
                  type="button"
                  className={i === 0 ? 'btn pri' : 'btn'}
                  disabled={busy !== null || o.problems.length > 0}
                  onClick={() => apply(o)}
                >
                  {busy === o.suggestion.kind ? 'Stellt um …' : 'Diesen Vorschlag übernehmen'}
                </button>
              </div>
            </div>
          ))}
          <span className="small-text">
            Du kannst das Umstellen im Verlauf jederzeit zurücknehmen, solange danach noch nicht gespielt wurde.
            {t.status === 'draft' ? ' Zuschauer sehen den neuen Plan, sobald du veröffentlichst.' : ' Zuschauer sehen den neuen Plan sofort.'}
          </span>
        </div>
      )}
    </Dialog>
  );
}
