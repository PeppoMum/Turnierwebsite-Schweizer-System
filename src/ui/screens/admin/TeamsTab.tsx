// Teams verwalten: Nichtantritt und Rückzug mit Erklärung der Folgen vor dem Bestätigen.
import { useState } from 'react';
import type { Team } from '../../../domain';
import { useService } from '../../data/context';
import { formatTime } from '../../format';
import { Dialog, Notice, TeamName } from '../../components/ui';
import type { AdminCtx } from './AdminTournament';

const STATUS_LABEL: Record<Team['status'], { text: string; tone: string }> = {
  active: { text: 'Aktiv', tone: 'g' },
  no_show: { text: 'Nicht erschienen', tone: 'o' },
  withdrawn: { text: 'Zurückgezogen', tone: 'o' },
  inactive: { text: 'Inaktiv', tone: '' },
};

export function TeamsTab({ ctx }: { ctx: AdminCtx }) {
  const service = useService();
  const { data } = ctx;
  const [target, setTarget] = useState<Team | null>(null);
  const [undo, setUndo] = useState<Team | null>(null);
  const active = data.teams.filter((t) => t.status === 'active').length;

  return (
    <>
      <div className="row">
        <span className="pill a">{active} aktive Teams</span>
        {active % 2 === 1 && <span className="pill y">Ungerade Zahl: pro Runde ein Freilos</span>}
      </div>
      {undo && (
        <Notice
          title={`${undo.name} ist raus`}
          onClose={() => setUndo(null)}
        >
          Falsch geklickt?{' '}
          <button
            type="button"
            className="btn compact"
            onClick={async () => {
              await service.restoreTeam(data.tournament.id, undo.id);
              setUndo(null);
            }}
          >
            Rückgängig
          </button>
        </Notice>
      )}
      <div className="list">
        {data.teams.map((t) => {
          const s = STATUS_LABEL[t.status];
          return (
            <div key={t.id} className="list-row">
              <span className="grow">
                <TeamName name={t.name} logo={ctx.teamLogo(t.id)} muted={t.status !== 'active'} />
              </span>
              <span className={`pill ${s.tone}`}>{s.text}</span>
              {t.status === 'active' ? (
                <button type="button" className="btn" onClick={() => setTarget(t)}>
                  Abmelden
                </button>
              ) : t.status !== 'inactive' ? (
                <button type="button" className="btn" onClick={() => service.restoreTeam(data.tournament.id, t.id)}>
                  Wieder aufnehmen
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {target && (
        <WithdrawDialog
          ctx={ctx}
          team={target}
          onClose={() => setTarget(null)}
          onDone={() => {
            setUndo(target);
            setTarget(null);
          }}
        />
      )}
    </>
  );
}

function WithdrawDialog({ ctx, team, onClose, onDone }: { ctx: AdminCtx; team: Team; onClose: () => void; onDone: () => void }) {
  const service = useService();
  const { data } = ctx;
  const own = data.matches.filter((m) => m.teamAId === team.id || m.teamBId === team.id);
  const started = own.some((m) => m.status !== 'scheduled');
  const open = own.filter((m) => m.status === 'scheduled');
  const playedCount = own.filter((m) => m.status === 'completed').length;
  return (
    <Dialog title={started ? `${team.name} zurückziehen` : `${team.name} ist nicht erschienen`} onClose={onClose}>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
        {started && (
          <li>
            Die {playedCount} bisher gespielten Spiele von {team.name} fallen aus der Tabelle, für alle Teams. Die Gegner stehen so da, als hätten sie diese Spiele nie gespielt.
          </li>
        )}
        <li>{team.name} kann das Turnier nicht mehr gewinnen.</li>
        {open.length > 0 && (
          <li>
            {open.length} {open.length === 1 ? 'geplantes Spiel fällt' : 'geplante Spiele fallen'} aus:{' '}
            {open.map((m) => `${formatTime(m.startISO, data.tournament.timeZone)} gegen ${ctx.teamName(m.teamAId === team.id ? m.teamBId : m.teamAId)}`).join(', ')}.
          </li>
        )}
        <li>Ab der nächsten Runde wird {team.name} nicht mehr gepaart.</li>
      </ul>
      <div className="row">
        <button
          type="button"
          className="btn pri"
          onClick={async () => {
            await service.withdrawTeam(data.tournament.id, team.id);
            onDone();
          }}
        >
          {started ? 'Team zurückziehen' : 'Als nicht erschienen markieren'}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Abbrechen
        </button>
      </div>
    </Dialog>
  );
}
