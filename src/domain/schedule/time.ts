// Zeitrechnung: intern immer Zeitpunkte (UTC-ISO), Eingabe/Anzeige in der Turnier-Zeitzone.
// Minuten werden auf Zeitpunkte addiert, dadurch ist die Sommerzeitumstellung automatisch korrekt.

export const MINUTE_MS = 60_000;

export function addMinutes(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * MINUTE_MS).toISOString();
}

export function minutesBetween(fromISO: string, toISO: string): number {
  return (Date.parse(toISO) - Date.parse(fromISO)) / MINUTE_MS;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Abstand der Zeitzone zu UTC in Minuten zum Zeitpunkt `epochMs` (Berlin Sommer: +120). */
export function timeZoneOffsetMinutes(epochMs: number, timeZone: string): number {
  const parts = Object.fromEntries(partsFormatter(timeZone).formatToParts(new Date(epochMs)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - Math.floor(epochMs / 1000) * 1000) / MINUTE_MS);
}

/**
 * Lokale Uhrzeit in der Turnier-Zeitzone → ISO-Zeitpunkt.
 * Bei einer Zeit in der Lücke der Sommerzeitumstellung wird auf die gültige Zeit danach
 * verschoben; bei doppelt vorkommender Zeit (Herbst) gilt das erste Vorkommen.
 */
export function zonedLocalToISO(localDate: string, localTime: string, timeZone: string): string {
  const [y, mo, d] = localDate.split('-').map(Number);
  const [h, mi] = localTime.split(':').map(Number);
  if ([y, mo, d, h, mi].some((x) => x === undefined || Number.isNaN(x))) {
    throw new Error(`Ungültiges Datum oder Uhrzeit: ${localDate} ${localTime}`);
  }
  const wall = Date.UTC(y!, mo! - 1, d!, h!, mi!);
  // Kandidaten mit den Offsets kurz vor und nach dem Termin prüfen.
  const offsets = [...new Set([-12, 0, 12].map((hours) => timeZoneOffsetMinutes(wall + hours * 3_600_000, timeZone)))];
  const valid = offsets
    .map((off) => wall - off * MINUTE_MS)
    .filter((t) => timeZoneOffsetMinutes(t, timeZone) * MINUTE_MS === wall - t)
    .sort((a, b) => a - b);
  if (valid.length > 0) return new Date(valid[0]!).toISOString();
  // Lücke (Uhr wird vorgestellt): mit dem Offset vor der Umstellung rechnen ergibt die Zeit danach.
  const before = timeZoneOffsetMinutes(wall - 12 * 3_600_000, timeZone);
  return new Date(wall - before * MINUTE_MS).toISOString();
}

/** Anzeige „HH:MM“ in der Turnier-Zeitzone. */
export function formatLocalTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(iso),
  );
}
