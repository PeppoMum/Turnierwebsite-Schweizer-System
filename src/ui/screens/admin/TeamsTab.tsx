// Teams verwalten: Nichtantritt und Rückzug mit Erklärung der Folgen vor dem Bestätigen.
import { useState } from 'react';
import type { Team } from '../../../domain';
import { useService } from '../../data/context';
import { formatTime } from '../../format';
import { Dialog, Notice, TeamName } from '../../components/ui';
import { Icon } from '../../components/Icon';
import type { AdminCtx } from './AdminTournament';
import { TeamDialog } from './EditDetails';
import { QualifiedWithdrawDialog, qualifiedOptions } from './stages/QualifiedWithdraw';

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
  const [editing, setEditing] = useState<Team | 'new' | null>(null);
  const active = data.teams.filter((t) => t.status === 'active').length;
  const present = data.teams.filter((t) => t.status === 'active' && t.checkedInAt).length;
  const running = data.tournament.status !== 'finished' && data.tournament.status !== 'archived';
  const [presentError, setPresentError] = useState<string | null>(null);
  const togglePresent = async (team: Team, on: boolean) => {
    setPresentError(null);
    try {
      await service.setTeamPresent(data.tournament.id, team.id, on);
    } catch (e) {
      setPresentError(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
    }
  };

  return (
    <>
      <div className="row">
        <span className="pill a">{active} aktive Teams</span>
        {running && <span className="pill">{present === active ? 'Alle sind da' : `${present} von ${active} sind da`}</span>}
        {active % 2 === 1 && !data.tournament.format && <span className="pill y">Ungerade Zahl: pro Runde ein Freilos</span>}
        {data.tournament.status !== 'finished' && data.tournament.status !== 'archived' && (
          <button type="button" className="btn" style={{ marginLeft: 'auto' }} onClick={() => setEditing('new')}>
            <Icon name="plus" />
            Mannschaft nachmelden
          </button>
        )}
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
      {running && (
        <span className="small-text">
          Hak „ist da“ ab, sobald eine Mannschaft am Platz ist. Rücken Spiele nach vorne, zum Beispiel beim Straffen des Plans, kommen diese
          Mannschaften zuerst dran, und bei den anderen weist dich die Seite darauf hin.
        </span>
      )}
      {presentError && <Notice tone="warn" title={presentError} />}
      <div className="list">
        {data.teams.map((t) => {
          const s = STATUS_LABEL[t.status];
          return (
            <div key={t.id} className="list-row">
              <span className="grow">
                <TeamName name={t.name} logo={ctx.teamLogo(t.id)} muted={t.status !== 'active'} />
              </span>
              {running && t.status === 'active' && (
                <label className="check">
                  <input type="checkbox" checked={Boolean(t.checkedInAt)} onChange={(e) => togglePresent(t, e.target.checked)} /> ist da
                </label>
              )}
              <span className={`pill ${s.tone}`}>{s.text}</span>
              <button type="button" className="btn" aria-label={`${t.name} ändern`} onClick={() => setEditing(t)}>
                Ändern
              </button>
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
      {editing && (
        <TeamDialog
          data={data}
          team={editing === 'new' ? null : { id: editing.id, name: editing.name, logo: ctx.teamLogo(editing.id) }}
          onClose={() => setEditing(null)}
        />
      )}
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
  // Baukasten: Steht das Team schon in der Endrunde, wählt die Turnierleitung kampflos oder Nachrücker.
  const finals = data.tournament.format ? qualifiedOptions(data, team.id) : [];
  if (finals.length > 0) return <QualifiedWithdrawDialog ctx={ctx} team={team} options={finals} onClose={onClose} onDone={onDone} />;
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
