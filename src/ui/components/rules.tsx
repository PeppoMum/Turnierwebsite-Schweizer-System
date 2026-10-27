// Erklärungen und Bedienteile rund um Wertung und Paarung, im Assistenten und in den Einstellungen genutzt.
import type { PairingMode, TieBreaker } from '../../domain';
import { BUCHHOLZ_EXPLANATION, TIE_BREAKER_LABELS } from '../../domain/scoring';
import { Icon } from './Icon';
import { InfoButton } from './ui';

export const TIE_BREAKER_LABEL: Record<TieBreaker, string> = TIE_BREAKER_LABELS;

export const PAIRING_MODE_LABEL: Record<PairingMode, string> = {
  balanced: 'Ausgewogen',
  strict_no_rematch: 'Keine Wiederholung',
  performance_first: 'Leistung zuerst',
};

export function BuchholzInfo() {
  return (
    <InfoButton title="Buchholz erklärt">
      <p>{BUCHHOLZ_EXPLANATION}</p>
    </InfoButton>
  );
}

export function QuotientInfo() {
  return (
    <InfoButton title="Punktequotient erklärt">
      <p>Die Tabelle sortiert nach Punkten pro gespieltem Spiel: Sieg 3, Remis 1, Niederlage 0, geteilt durch die Zahl der Spiele.</p>
      <p>Beispiel: 17 Punkte aus 7 Spielen ergeben 2,429 und stehen damit vor 18 Punkten aus 8 Spielen (2,250).</p>
      <p className="muted">Ohne Spiel gibt es noch keinen Quotienten, dann steht dort „–“.</p>
    </InfoButton>
  );
}

export function PairingModeInfo() {
  return (
    <InfoButton title="Gegnerwahl erklärt">
      <p>
        <b>Ausgewogen</b> sucht Gegner mit ähnlichem Quotienten und vermeidet Wiederholungen, erzwingt aber keine sehr ungleichen
        Spiele wie Erster gegen Letzten.
      </p>
      <p>
        <b>Keine Wiederholung</b> schließt bekannte Duelle aus, solange das irgendwie geht. Wenn nicht, bekommst du einen Hinweis.
      </p>
      <p>
        <b>Leistung zuerst</b> gewichtet ähnliche Spielstärke noch stärker und nimmt dafür eher eine Wiederholung in Kauf.
      </p>
    </InfoButton>
  );
}

export function ByeInfo() {
  return (
    <InfoButton title="Freilos erklärt">
      <p>Bei ungerader Teamzahl setzt in jeder Runde ein Team aus. Das Freilos zählt nicht als Spiel und bringt weder Punkte noch Tore.</p>
      <p>Ein Team bekommt möglichst erst dann ein zweites Freilos, wenn alle anderen schon eins hatten.</p>
    </InfoButton>
  );
}

export function TieBreakerOrder({
  value,
  onChange,
  buchholz,
  onBuchholz,
}: {
  value: TieBreaker[];
  onChange: (v: TieBreaker[]) => void;
  buchholz: boolean;
  onBuchholz: (on: boolean) => void;
}) {
  const shown = value.filter((tb) => tb !== 'buchholz' || buchholz);
  const move = (i: number, d: -1 | 1) => {
    const next = [...shown];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(buchholz ? next : [...next, ...value.filter((tb) => tb === 'buchholz')]);
  };
  return (
    <div className="stack">
      <ol className="order-list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {shown.map((tb, i) => (
          <li key={tb} className="order-item">
            <span className="pos">{i + 1}</span>
            <span className="grow">
              {TIE_BREAKER_LABEL[tb]} {tb === 'buchholz' && <BuchholzInfo />}
            </span>
            <button type="button" className="btn sq" aria-label={`${TIE_BREAKER_LABEL[tb]} nach oben`} disabled={i === 0} onClick={() => move(i, -1)}>
              <Icon name="up" />
            </button>
            <button
              type="button"
              className="btn sq"
              aria-label={`${TIE_BREAKER_LABEL[tb]} nach unten`}
              disabled={i === shown.length - 1}
              onClick={() => move(i, 1)}
            >
              <Icon name="down" />
            </button>
          </li>
        ))}
      </ol>
      <label className="check">
        <input
          type="checkbox"
          checked={buchholz}
          onChange={(e) => {
            const on = e.target.checked;
            onBuchholz(on);
            if (on && !value.includes('buchholz')) onChange([...value, 'buchholz']);
          }}
        />
        <span>
          Buchholz als zusätzliche Feinwertung <BuchholzInfo />
        </span>
      </label>
    </div>
  );
}
