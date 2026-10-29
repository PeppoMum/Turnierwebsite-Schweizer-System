// Helferansicht für Turniere mit Gruppen und Endrunde: die laufenden und nächsten Spiele über alle
// Abschnitte, mit Anpfiff und Ergebnis (in der Endrunde auch Verlängerung und Neunmeterschießen).
// Korrigieren, Tauschen und Endrunde füllen macht die Turnierleitung.
import { useMemo, useState } from 'react';
import type { TournamentData } from '../../data/types';
import { formatDateShort } from '../../format';
import { EmptyState, Seg, TournamentStatusPill } from '../../components/ui';
import { useAdminCtx } from '../admin/AdminTournament';
import { TimeSlot } from '../admin/stages/StageLive';
import { groupByTime, isDecided, useFieldOrder } from '../admin/stages/model';

export function StageHelper({ data }: { data: TournamentData }) {
  const ctx = useAdminCtx(data);
  const t = data.tournament;
  const fieldOrder = useFieldOrder(data.fields);
  const [quick, setQuick] = useState(false);
  const [more, setMore] = useState(false);
  const locked = t.status === 'finished' || t.status === 'archived';
  const active = useMemo(
    () => groupByTime(data.matches.filter((m) => m.stageId), fieldOrder).filter((s) => s.matches.some((m) => !isDecided(m))),
    [data.matches, fieldOrder],
  );
  const shown = more ? active : active.slice(0, 2);

  return (
    <div className="page">
      <div className="page-head">
        <div className="stack tight" style={{ minWidth: 0 }}>
          <span className="small-text">
            {t.title} · {formatDateShort(t.localDate)}
          </span>
          <h1 className="page-title">Spiele</h1>
        </div>
        <TournamentStatusPill status={t.status} />
      </div>
      {active.length === 0 ? (
        <EmptyState text={locked ? 'Das Turnier ist vorbei. Danke fürs Helfen!' : 'Gerade sind keine Spiele offen.'} />
      ) : (
        <>
          <div className="row">
            <span className="small-text">
              Du hilfst ohne Anmeldung. Beendete Spiele korrigiert die Turnierleitung. Steht ein Endrunden-Spiel unentschieden, fragt die Seite
              nach dem Neunmeterschießen.
            </span>
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
          {shown.map((s) => (
            <TimeSlot key={s.startISO ?? 'ohne'} ctx={ctx} slot={s} quick={quick} locked={locked} canCorrect={false} />
          ))}
          {active.length > 2 && (
            <div className="row">
              <button type="button" className="btn" onClick={() => setMore((v) => !v)}>
                {more ? 'Weniger anzeigen' : 'Spätere Spiele anzeigen'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
