// Spielplan eingrenzen: eine Runde und/oder eine Mannschaft.
import { useId, useState } from 'react';
import { TeamPicker, type PickerTeam } from './TeamPicker';

export interface ScheduleFilterValue {
  round: number | null;
  teamId: string | null;
}

export function useScheduleFilter() {
  return useState<ScheduleFilterValue>({ round: null, teamId: null });
}

/** Passt ein Spiel zum Filter? */
export function matchesFilter(f: ScheduleFilterValue, m: { roundNumber: number; teamAId: string; teamBId: string }): boolean {
  return (f.round === null || m.roundNumber === f.round) && (f.teamId === null || m.teamAId === f.teamId || m.teamBId === f.teamId);
}

export function ScheduleFilter({
  rounds,
  teams,
  value,
  onChange,
}: {
  rounds: number[];
  teams: PickerTeam[];
  value: ScheduleFilterValue;
  onChange: (v: ScheduleFilterValue) => void;
}) {
  const roundId = useId();
  return (
    <div className="filters no-print">
      <div className="field">
        <label className="label" htmlFor={roundId}>
          Runde
        </label>
        <select
          id={roundId}
          className="select"
          value={value.round ?? ''}
          onChange={(e) => onChange({ ...value, round: e.target.value === '' ? null : Number(e.target.value) })}
        >
          <option value="">Alle Runden</option>
          {rounds.map((n) => (
            <option key={n} value={n}>
              Runde {n}
            </option>
          ))}
        </select>
      </div>
      <TeamPicker label="Mannschaft" allLabel="Alle Mannschaften" teams={teams} value={value.teamId} onChange={(teamId) => onChange({ ...value, teamId })} />
    </div>
  );
}
