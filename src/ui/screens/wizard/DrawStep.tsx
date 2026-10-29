// Schritt „Gruppen auslosen“: Zufall, Lostöpfe oder von Hand. Mannschaften lassen sich am Computer
// mit der Maus in eine andere Gruppe ziehen; auf dem Handy erst antippen, dann die Zielgruppe wählen.
// Entwurf „Gruppen auslosen“, Seite „Ausgearbeitet“.
import { useState } from 'react';
import type { DrawMode } from '../../../domain/format';
import { checkGroupAssignment, groupLetter } from '../../../domain/groups';
import type { WizardDraft } from '../../data/types';
import { initials } from '../../format';
import { Icon } from '../../components/Icon';
import { Notice, Seg } from '../../components/ui';
import { groupSizeText, prelimSizes, type BuilderState } from './builder';
import { groupMatchCount, moveTeam, potLists, swapTeams, type DrawState } from './draw';
import { activeTeams } from './preview';

interface DrawStepProps {
  draft: WizardDraft;
  builder: BuilderState;
  draw: DrawState;
  setDraw: (d: DrawState) => void;
  groups: string[][];
}

const MODE_HELP: Record<DrawMode, string> = {
  random: 'Der Computer lost alle Mannschaften zufällig in die Gruppen.',
  pots: 'Leg Favoriten in Topf 1, die nächsten in Topf 2 usw. Aus jedem Topf kommt je eine Mannschaft in jede Gruppe, so weit es geht.',
  manual:
    'Du teilst selbst ein, zum Beispiel nach einer Auslosung vor Ort. Zieh die Mannschaften in ihre Gruppe oder tipp erst eine Mannschaft an und dann die Gruppe.',
};

export function DrawStep({ draft, builder, draw, setDraw, groups }: DrawStepProps) {
  const teams = activeTeams(draft);
  const name = new Map(teams.map((t) => [t.id, t.name.trim()]));
  const [picked, setPicked] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const sizes = prelimSizes(builder, teams.length);
  const pots = potLists(
    draw,
    teams.map((t) => t.id),
  );
  const check = checkGroupAssignment(groups, {
    teamIds: teams.map((t) => t.id),
    groupCount: builder.groupCount,
    groupSizes: builder.groupSizes ?? undefined,
    pots,
    teamNames: name,
  });
  const potCount = Math.max(2, ...sizes);
  const largest = Math.max(...groups.map((g) => g.length));

  const setMode = (mode: DrawMode) => {
    setPicked(null);
    setDraw({
      ...draw,
      mode,
      manual: mode === 'manual' ? groups.map((g) => [...g]) : null,
    });
  };
  const handEdit = (next: string[][]) => {
    setPicked(null);
    setDraw({ ...draw, mode: 'manual', manual: next });
  };
  const pickTeam = (id: string) => {
    if (picked && picked !== id) handEdit(swapTeams(groups, picked, id));
    else setPicked(picked === id ? null : id);
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="wz-draw-bar">
        <div className="row">
          <Seg<DrawMode>
            label="Art der Auslosung"
            value={draw.mode}
            onChange={setMode}
            options={[
              { value: 'random', label: 'Zufall' },
              { value: 'pots', label: 'Lostöpfe' },
              { value: 'manual', label: 'Von Hand' },
            ]}
          />
          {draw.mode !== 'manual' && (
            <button type="button" className="btn" onClick={() => setDraw({ ...draw, seed: draw.seed + 1, manual: null })}>
              <Icon name="shuffle" />
              Neu auslosen
            </button>
          )}
        </div>
        <b>{groupSizeText(groups.map((g) => g.length))} Mannschaften</b>
      </div>
      <span className="small-text">{MODE_HELP[draw.mode]}</span>

      {draw.mode === 'pots' && (
        <div className="stack tight">
          <h3 className="card-title">Lostöpfe</h3>
          <div className="wz-pots">
            {teams.map((t) => (
              <div key={t.id} className="list-row">
                <span
                  className="grow"
                  style={{
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t.name}
                </span>
                <select
                  className="select"
                  aria-label={`Lostopf für ${t.name}`}
                  value={draw.pots[t.id] ?? 0}
                  onChange={(e) => {
                    const pot = Number(e.target.value);
                    const nextPots = { ...draw.pots };
                    if (pot === 0) delete nextPots[t.id];
                    else nextPots[t.id] = pot;
                    setDraw({ ...draw, pots: nextPots, manual: null });
                  }}
                >
                  <option value={0}>Kein Topf</option>
                  {Array.from({ length: potCount }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      Topf {i + 1}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="wz-groups">
        {groups.map((g, gi) => {
          const target = picked !== null && !g.includes(picked);
          return (
            <section
              key={gi}
              className={`wz-group${dragOver === gi ? ' target' : ''}`}
              aria-label={`Gruppe ${groupLetter(gi)}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(gi);
              }}
              onDragLeave={() => setDragOver((x) => (x === gi ? null : x))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const id = e.dataTransfer.getData('text/plain');
                if (id && !g.includes(id)) handEdit(moveTeam(groups, id, gi));
              }}
            >
              <div className="wz-group-head">
                <b>Gruppe {groupLetter(gi)}</b>
                <span className={`pill${g.length === largest ? ' a' : ''}`}>
                  {g.length} Teams · {groupMatchCount(g.length, builder.doubleRoundRobin)} Spiele
                </span>
              </div>
              {g.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="wz-team"
                  draggable
                  aria-pressed={picked === id}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => setDragOver(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOver(null);
                    const other = e.dataTransfer.getData('text/plain');
                    if (other && other !== id) handEdit(swapTeams(groups, other, id));
                  }}
                  onClick={() => pickTeam(id)}
                >
                  <span className="crest" aria-hidden="true">
                    {initials(name.get(id) ?? '')}
                  </span>
                  <span className="name">{name.get(id)}</span>
                  {draw.pots[id] && <span className="pill">Topf {draw.pots[id]}</span>}
                  <span className="grip" aria-hidden="true">
                    ⋮⋮
                  </span>
                </button>
              ))}
              {target && (
                <button type="button" className="wz-drop" onClick={() => handEdit(moveTeam(groups, picked!, gi))}>
                  {name.get(picked!)} hierher verschieben
                </button>
              )}
            </section>
          );
        })}
      </div>
      {picked && <span className="small-text">Tipp eine Mannschaft in einer anderen Gruppe an, um beide zu tauschen, oder wähl „hierher verschieben“.</span>}
      {!picked && <span className="small-text">Mannschaften lassen sich mit der Maus in eine andere Gruppe ziehen. Die Spielzahl passt sich sofort an.</span>}
      {check.errors.length > 0 && (
        <Notice tone="warn" title="Die Einteilung passt noch nicht">
          {check.errors.join(' ')}
        </Notice>
      )}
      {check.warnings.length > 0 && (
        <Notice tone="hint" title="Gut zu wissen">
          {check.warnings.join(' ')}
        </Notice>
      )}
    </div>
  );
}
