// Bausteine nach Phils Style Guide.
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import qrcode from 'qrcode-generator';
import type { MatchStatus, TournamentStatus } from '../../domain';
import { initials, matchStatusLabel, tournamentStatusLabel, tournamentStatusTone } from '../format';
import { Icon } from './Icon';

/* Umschalter / Reiter */
export function Seg<T extends string>({
  options,
  value,
  onChange,
  label,
  full,
}: {
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  value: T;
  onChange: (v: T) => void;
  label: string;
  full?: boolean;
}) {
  const cls = ['seg', full ? 'full' : '', options.length >= 4 ? 'wrap4' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} disabled={o.disabled} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* Feld mit Beschriftung darüber */
export function Field({
  label,
  error,
  info,
  className,
  children,
}: {
  label: string;
  error?: string;
  info?: ReactNode;
  className?: string;
  children: (id: string, describedBy?: string) => ReactNode;
}) {
  const id = useId();
  const errId = `${id}-err`;
  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      <span className="label">
        <label htmlFor={id}>{label}</label>
        {info}
      </span>
      {children(id, error ? errId : undefined)}
      {error && (
        <span id={errId} className="field-error">
          {error}
        </span>
      )}
    </div>
  );
}

/* Hinweis, optional mit ✕ */
export function Notice({
  title,
  children,
  tone,
  onClose,
}: {
  title: string;
  children?: ReactNode;
  tone?: 'warn' | 'info' | 'hint';
  onClose?: () => void;
}) {
  return (
    <div className={['notice', tone, onClose ? '' : 'no-close'].filter(Boolean).join(' ')} role={tone === 'warn' ? 'alert' : undefined}>
      <b>{title}</b>
      {children && <span>{children}</span>}
      {onClose && (
        <button type="button" className="x-close" aria-label="Schließen" onClick={onClose}>
          ✕
        </button>
      )}
    </div>
  );
}

export function TournamentStatusPill({ status }: { status: TournamentStatus }) {
  return (
    <span className={`pill ${tournamentStatusTone[status]}`}>
      {status === 'running' && <i className="live-dot" aria-hidden />}
      {tournamentStatusLabel[status]}
    </span>
  );
}

const MATCH_TONE: Record<MatchStatus, string> = {
  draft: '',
  scheduled: '',
  live: 'g',
  completed: '',
  not_played: 'o',
  cancelled: 'o',
};

export function MatchStatusPill({ status }: { status: MatchStatus }) {
  return (
    <span className={`pill ${MATCH_TONE[status]}`}>
      {status === 'live' && <i className="live-dot" aria-hidden />}
      {matchStatusLabel[status]}
    </span>
  );
}

export function Kpi({ value, label, tone }: { value: ReactNode; label: string; tone?: 'warn' | 'good' }) {
  return (
    <div className={['kpi', tone].filter(Boolean).join(' ')}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

export function Crest({ name, logo, large }: { name: string; logo?: string; large?: boolean }) {
  return <span className={large ? 'crest lg' : 'crest'} aria-hidden>{logo ? <img src={logo} alt="" /> : initials(name)}</span>;
}

export function TeamName({ name, logo, muted }: { name: string; logo?: string; muted?: boolean }) {
  return (
    <span className="team">
      <Crest name={name} logo={logo} />
      <span className={muted ? 'name muted' : 'name'}>{name}</span>
    </span>
  );
}

export function EmptyState({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="muted">{text}</span>
      {action}
    </div>
  );
}

/* Fenster: am Handy als Blatt von unten, sonst mittig */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.x-close), [href]');
    (first ?? ref.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, []);
  // Ins <body> hängen, damit das Fenster nichts vom Aufrufer erbt (z. B. Tabellenkopf ohne Zeilenumbruch)
  return createPortal(
    <div className="scrim sheet-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <h2 id={titleId} className="dialog-title">
          {title}
        </h2>
        <button type="button" className="x-close" aria-label="Schließen" onClick={onClose}>
          ✕
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/* Kleiner Info-Knopf, der eine Erklärung öffnet (Tooltips funktionieren am Handy nicht) */
export function InfoButton({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="info-btn" aria-label={`${title}: Erklärung`} title={title} onClick={() => setOpen(true)}>
        i
      </button>
      {open && (
        <Dialog title={title} onClose={() => setOpen(false)}>
          <div className="stack">{children}</div>
          <div className="row">
            <button type="button" className="btn pri" onClick={() => setOpen(false)}>
              Verstanden
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

export function QrCode({ text, size = 176 }: { text: string; size?: number }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [text]);
  return (
    <div
      role="img"
      aria-label="QR-Code zur öffentlichen Turnierseite"
      style={{ width: size, height: size, background: '#fff', borderRadius: 10, padding: 6, border: '1px solid var(--ln)' }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/* Knopf mit kurzem Speichern-Zustand */
export function useSaveState(): [string | null, (label: string, run: () => Promise<unknown>) => Promise<void>] {
  const [state, setState] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setState('Speichert …');
    try {
      await fn();
      setState(label);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setState(null), 1600);
    } catch (e) {
      setState(e instanceof Error ? e.message : 'Speichern fehlgeschlagen');
    }
  };
  return [state, run];
}

export function CopyButton({ text, label = 'Link kopieren', compact }: { text: string; label?: string; compact?: boolean }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      window.setTimeout(() => setDone(false), 1600);
    } catch {
      window.prompt('Link kopieren:', text);
    }
  };
  return (
    <button type="button" className={compact ? 'btn compact' : 'btn'} onClick={copy}>
      <Icon name={done ? 'check' : 'link'} />
      {done ? 'Kopiert' : label}
    </button>
  );
}

/** Teilen über das Handy-Menü; ohne diese Möglichkeit wird daraus „Link kopieren“, außer fallback ist aus. */
export function ShareButton({ url, title, fallback = true }: { url: string; title: string; fallback?: boolean }) {
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  if (!canShare) return fallback ? <CopyButton text={url} /> : null;
  return (
    <button type="button" className="btn" onClick={() => navigator.share({ title, url }).catch(() => undefined)}>
      <Icon name="share" />
      Teilen
    </button>
  );
}
