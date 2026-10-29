// Qualifiziertes Team zieht vor seinem Endrunden-Spiel zurück: Die Turnierleitung wählt im Moment,
// ob der Gegner kampflos weiterkommt oder der Nächstbeste nachrückt (docs/turnier-baukasten.md).
import { useMemo, useState } from 'react';
import type { Team } from '../../../../domain';
import { withdrawalOptions, type WithdrawalOption } from '../../../../domain/format/resolve';
import { useService } from '../../../data/context';
import type { TournamentData } from '../../../data/types';
import { formatTime } from '../../../format';
import { Dialog } from '../../../components/ui';
import type { AdminCtx } from '../AdminTournament';
import { buildStageModel, matchTitle, resolveInput, sideText, stageById } from './model';

/** Offene Endrunden-Spiele des Teams mit Wahlmöglichkeiten; leer, wenn es keine gibt. */
export function qualifiedOptions(d: TournamentData, teamId: string): WithdrawalOption[] {
  const model = buildStageModel(d);
  if (!model) return [];
  return withdrawalOptions(resolveInput(d, model.format, model.standings), teamId).filter((o) => {
    const m = d.matches.find((x) => x.id === o.matchId);
    return Boolean(m && (m.teamAId === teamId || m.teamBId === teamId));
  });
}

export function QualifiedWithdrawDialog({
  ctx,
  team,
  options,
  onClose,
  onDone,
}: {
  ctx: AdminCtx;
  team: Team;
  options: WithdrawalOption[];
  onClose: () => void;
  onDone: () => void;
}) {
  const service = useService();
  const { data } = ctx;
  const format = data.tournament.format!;
  const replacement = options.find((o) => o.replacement)?.replacement ?? null;
  const [choice, setChoice] = useState<'walkover' | 'replace'>('walkover');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const games = useMemo(
    () =>
      options.flatMap((o) => {
        const m = data.matches.find((x) => x.id === o.matchId);
        if (!m) return [];
        const opp = sideText(m, o.side === 'A' ? 'B' : 'A', format, ctx.teamName);
        return [{ id: m.id, text: `${matchTitle(m, format)}, ${formatTime(m.startISO, data.tournament.timeZone)} Uhr gegen ${opp}`, opp }];
      }),
    [options, data, format, ctx.teamName],
  );
  const leaves = replacement?.leavesStageId ? stageById(format, replacement.leavesStageId)?.name : undefined;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await service.withdrawQualifiedTeam(
        data.tournament.id,
        team.id,
        choice === 'replace' && replacement ? { kind: 'replace', byTeamId: replacement.teamId } : { kind: 'walkover' },
      );
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
      setBusy(false);
    }
  };

  return (
    <Dialog title={`${team.name} zieht zurück`} onClose={onClose}>
      <p style={{ margin: 0 }}>{team.name} hat noch {games.length === 1 ? 'ein Endrunden-Spiel' : `${games.length} Endrunden-Spiele`}:</p>
      <ul className="stage-fill-list">
        {games.map((g) => (
          <li key={g.id}>{g.text}</li>
        ))}
      </ul>
      <div className="stack tight" role="radiogroup" aria-label="Was passiert mit dem Spiel?">
        <label className="check">
          <input type="radio" name="withdraw-choice" checked={choice === 'walkover'} onChange={() => setChoice('walkover')} />
          <span>
            <b>Gegner kommt kampflos weiter.</b> {games[0]?.opp ?? 'Der Gegner'} gewinnt das Spiel ohne Ergebnis.
          </span>
        </label>
        <label className="check">
          <input type="radio" name="withdraw-choice" disabled={!replacement} checked={choice === 'replace'} onChange={() => setChoice('replace')} />
          <span>
            <b>Nächstbester rückt nach.</b>{' '}
            {replacement
              ? `${ctx.teamName(replacement.teamId)} spielt statt ${team.name}.${leaves ? ` Dafür fehlt ${ctx.teamName(replacement.teamId)} dann im Abschnitt „${leaves}“.` : ''}`
              : 'Hier kann niemand mehr nachrücken.'}
          </span>
        </label>
      </div>
      <span className="small-text">Die Gruppenspiele von {team.name} zählen danach wie bei jedem Rückzug für niemanden mehr.</span>
      {error && <span className="field-error">{error}</span>}
      <div className="row">
        <button type="button" className="btn pri" disabled={busy} onClick={save}>
          {busy ? 'Speichert …' : 'Team zurückziehen'}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Abbrechen
        </button>
      </div>
    </Dialog>
  );
}
