// Anzeigeformate nach Style Guide: Komma als Dezimalzeichen, Datum kurz „Sa 10.01.“, Uhrzeit „19:00“.
import type { MatchStatus, TournamentStatus, Visibility } from '../domain';

const TZ_DEFAULT = 'Europe/Berlin';

export function formatTime(iso: string | undefined, timeZone = TZ_DEFAULT): string {
  if (!iso) return '–';
  return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(iso));
}

export function formatDateShort(localDate: string): string {
  const [y, m, d] = localDate.split('-').map(Number);
  if (!y || !m || !d) return localDate;
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const wd = new Intl.DateTimeFormat('de-DE', { weekday: 'short', timeZone: 'UTC' }).format(date).replace('.', '');
  return `${wd} ${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
}

export function formatQuotient(q: number | null, digits = 3): string {
  if (q === null) return '–';
  return q.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatSigned(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return '0';
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${min} Min.`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} Std.` : `${h} Std. ${m} Min.`;
}

export const tournamentStatusLabel: Record<TournamentStatus, string> = {
  draft: 'Entwurf',
  published: 'Veröffentlicht',
  running: 'Läuft',
  finished: 'Abgeschlossen',
  archived: 'Archiviert',
};

export const tournamentStatusTone: Record<TournamentStatus, string> = {
  draft: '',
  published: '',
  running: 'g',
  finished: '',
  archived: '',
};

export const matchStatusLabel: Record<MatchStatus, string> = {
  draft: 'Entwurf',
  scheduled: 'Geplant',
  live: 'Läuft',
  completed: 'Beendet',
  not_played: 'Nicht ausgetragen',
  cancelled: 'Abgesagt',
};

export const visibilityLabel: Record<Visibility, string> = {
  full: 'Vollständig',
  no_standings: 'Ohne Tabelle',
  kids: 'Kinderfußball',
};

export const visibilityHelp: Record<Visibility, string> = {
  full: 'Zuschauer sehen Spielplan, Ergebnisse und Tabelle.',
  no_standings: 'Zuschauer sehen Spielplan und Ergebnisse, aber keine Tabelle.',
  kids: 'Zuschauer sehen nur Paarungen, Felder und Anstoßzeiten. Ergebnisse und Tabelle werden gar nicht erst veröffentlicht.',
};

export function initials(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
