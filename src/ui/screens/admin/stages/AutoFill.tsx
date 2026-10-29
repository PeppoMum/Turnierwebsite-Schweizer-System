// Endrunde automatisch füllen (docs/turnier-baukasten.md, „Endrunde füllen“): Sobald Teams fest
// weiterkommen (Gruppe fertig, Los gezogen, K.-o.-Spiel entschieden), trägt die Turnierleitung sie
// ohne Klick ein und bekommt einen Hinweis. Korrekturen, die schon eingetragene Teams austauschen,
// bestätigt sie weiterhin selbst (StageNotices).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useService } from '../../../data/context';
import { href } from '../../../router';
import { Notice } from '../../../components/ui';
import type { AdminCtx } from '../AdminTournament';
import { buildStageModel, changeText } from './model';

export function AutoFill({ ctx }: { ctx: AdminCtx }) {
  const service = useService();
  const { data } = ctx;
  const model = useMemo(() => buildStageModel(data), [data]);
  const fills = useMemo(() => (model ? model.resolution.changes.filter((c) => !c.fromTeamId) : []), [model]);
  const [shown, setShown] = useState<string[]>([]);
  // Pro Vorschlag nur ein Versuch, auch wenn mehrere Ansichten neu rechnen, bis das Ergebnis zurückkommt.
  const tried = useRef(new Set<string>());

  useEffect(() => {
    if (!model) return;
    const todo = fills.filter((c) => !tried.current.has(`${c.matchId}|${c.side}|${c.toTeamId}`));
    if (todo.length === 0) return;
    for (const c of todo) tried.current.add(`${c.matchId}|${c.side}|${c.toTeamId}`);
    const lines = todo.map((c) => changeText(c, data, model.format, ctx.teamName));
    service
      .confirmSlotFills(
        data.tournament.id,
        todo.map((c) => ({ matchId: c.matchId, side: c.side, teamId: c.toTeamId })),
      )
      .then(() => setShown((prev) => [...prev, ...lines]))
      // Klappt es nicht (z. B. gleichzeitig in einem zweiten Fenster eingetragen), bleibt der Vorschlag sichtbar.
      .catch(() => {
        for (const c of todo) tried.current.delete(`${c.matchId}|${c.side}|${c.toTeamId}`);
      });
  }, [fills, model, data, ctx.teamName, service]);

  if (shown.length === 0) return null;
  return (
    <Notice tone="hint" title="Endrunde eingetragen" onClose={() => setShown([])}>
      <ul className="stage-fill-list">
        {shown.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <a href={href({ name: 'admin', id: data.tournament.id, tab: 'spielplan' })}>Im Spielplan tauschen</a>
    </Notice>
  );
}
