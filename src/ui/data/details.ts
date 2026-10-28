// Nachträgliches Ändern von Stammdaten und Mannschaften: gemeinsame Prüfungen für mockStore und
// firestoreStore, damit beide dieselben Fehlermeldungen liefern.
import { zonedLocalToISO } from '../../domain/schedule';
import type { TeamEdit, TournamentData, TournamentDetails } from './types';

/** Aktuelle Stammdaten als Ausgangswerte für das Formular. */
export function detailsOf(data: TournamentData): TournamentDetails {
  const t = data.tournament;
  const img = (assetId?: string) => (assetId ? data.assets[assetId] : undefined);
  return {
    title: t.title,
    organizerName: t.organizerName,
    venue: t.venue ?? '',
    localDate: t.localDate,
    organizerLogo: img(t.organizerAssetId),
    eventLogo: img(t.eventAssetId),
    sponsors: [...data.sponsors]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ id: s.id, name: s.name, url: s.url ?? '', logo: img(s.assetId) })),
  };
}

/** Datum lässt sich nur ändern, solange noch keine Runde ausgelost ist (danach stehen Anstoßzeiten fest). */
export function canChangeDate(data: TournamentData): boolean {
  return data.rounds.length === 0;
}

/** Feldname -> Meldung. Leer = alles in Ordnung. */
export function validateDetails(data: TournamentData, d: TournamentDetails): Record<string, string> {
  const e: Record<string, string> = {};
  if (!d.title.trim()) e.title = 'Gib dem Turnier einen Namen.';
  else if (d.title.trim().length > 120) e.title = 'Der Name ist zu lang (höchstens 120 Zeichen).';
  if (!d.organizerName.trim()) e.organizerName = 'Trag den Veranstalter ein.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.localDate)) e.localDate = 'Wähl ein Datum.';
  else if (d.localDate !== data.tournament.localDate && !canChangeDate(data)) {
    e.localDate = 'Das Datum lässt sich nicht mehr ändern, weil schon Runden mit Anstoßzeiten feststehen.';
  }
  d.sponsors.forEach((s, i) => {
    if (!s.name.trim()) e[`sponsor-${i}`] = `Sponsor ${i + 1} braucht einen Namen.`;
    else if (s.url.trim() && !/^https:\/\//i.test(s.url.trim())) e[`sponsor-${i}`] = `Der Link von Sponsor ${i + 1} muss mit https:// beginnen.`;
  });
  return e;
}

/** Wirft eine verständliche Meldung, wenn die Stammdaten nicht gespeichert werden können. */
export function assertDetails(data: TournamentData, d: TournamentDetails): void {
  const first = Object.values(validateDetails(data, d))[0];
  if (first) throw new Error(first);
}

/** Neue Startzeit des Turniers, wenn sich das Datum vor der ersten Runde ändert (Uhrzeit bleibt). */
export function movedStartISO(data: TournamentData, localDate: string): string | undefined {
  const t = data.tournament;
  if (localDate === t.localDate) return undefined;
  const time = new Intl.DateTimeFormat('de-DE', { timeZone: t.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(t.schedule.tournamentStartISO),
  );
  return zonedLocalToISO(localDate, time, t.timeZone);
}

/** Prüft Name einer Mannschaft (leer, doppelt) und liefert ihn bereinigt. */
export function checkedTeamName(data: TournamentData, teamId: string | null, team: TeamEdit): string {
  const name = team.name.trim();
  if (!name) throw new Error('Die Mannschaft braucht einen Namen.');
  if (name.length > 80) throw new Error('Der Name ist zu lang (höchstens 80 Zeichen).');
  const taken = data.teams.some((t) => t.id !== teamId && t.name.trim().toLowerCase() === name.toLowerCase());
  if (taken) throw new Error(`Es gibt schon eine Mannschaft „${name}“. Gib ihr einen eigenen Namen.`);
  if (teamId && !data.teams.some((t) => t.id === teamId)) throw new Error('Die Mannschaft wurde nicht gefunden.');
  if (!teamId && data.tournament.status === 'finished') throw new Error('Das Turnier ist beendet, es kann niemand mehr dazukommen.');
  return name;
}

/** Nächste freie Team-ID im Muster `<tid>-t<n>`. */
export function nextTeamId(data: TournamentData): string {
  const tid = data.tournament.id;
  const used = new Set(data.teams.map((t) => t.id));
  let n = data.teams.length + 1;
  while (used.has(`${tid}-t${n}`)) n++;
  return `${tid}-t${n}`;
}
