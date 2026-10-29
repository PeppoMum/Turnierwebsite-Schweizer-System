// Turnierbaum: Runden nebeneinander, Linien verbinden je zwei Spiele mit dem nächsten.
// Reine Anzeige, die Daten bereitet die Seite auf (Zuschauerseite, Turnierleitung, Druck).
// Am Handy sind zwei Runden sichtbar, der Rest per Wischen; die Spalten rasten ein.
import type { ReactNode } from 'react';
import './bracket.css';

export interface BracketSide {
  name: string;
  /** Kurzer Platzhalter vor dem Namen, z. B. „1. A“. */
  short?: string;
  goals?: number;
  /** win/lose nach dem Spiel; open = Team steht noch nicht fest; preview = Stand jetzt, noch nicht fest. */
  state?: 'win' | 'lose' | 'open' | 'preview';
  mine?: boolean;
}

export interface BracketMatch {
  id: string;
  /** Feld und Uhrzeit. */
  meta?: ReactNode;
  status?: ReactNode;
  a: BracketSide;
  b: BracketSide;
  /** Zusatz unter dem Spiel, z. B. „4:3 n. N.“. */
  note?: string;
  live?: boolean;
  mine?: boolean;
}

export interface BracketRound {
  title: string;
  sub?: string;
  matches: BracketMatch[];
}

function Side({ s }: { s: BracketSide }) {
  const cls = ['bk-side', s.state ?? '', s.mine ? 'mine' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      {s.short !== undefined && <span className="bk-short">{s.short}</span>}
      <span className="bk-name">{s.name}</span>
      <b className="bk-goals">{s.goals ?? ''}</b>
    </div>
  );
}

export function BracketCard({ m }: { m: BracketMatch }) {
  const cls = ['bk-match', m.live ? 'live' : '', m.mine ? 'mine' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      {(m.meta || m.status) && (
        <div className="bk-meta">
          <span className="bk-meta-text">{m.meta}</span>
          {m.status}
        </div>
      )}
      <Side s={m.a} />
      <Side s={m.b} />
      {m.note && <div className="bk-note">{m.note}</div>}
    </div>
  );
}

export function Bracket({ rounds, label }: { rounds: BracketRound[]; label: string }) {
  return (
    <div className="bk-scroll" role="region" aria-label={label} tabIndex={0}>
      <div className="bk" style={{ ['--bk-cols' as string]: rounds.length }}>
        {rounds.map((r, ri) => (
          <section key={ri} className={ri === rounds.length - 1 ? 'bk-col last' : 'bk-col'} aria-label={r.title}>
            <h3 className="bk-title">
              {r.title}
              {r.sub && <span> · {r.sub}</span>}
            </h3>
            <div className="bk-cells">
              {r.matches.map((m) => (
                <div key={m.id} className="bk-cell">
                  <BracketCard m={m} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
