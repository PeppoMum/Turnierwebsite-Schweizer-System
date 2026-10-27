// Anzeigeformate für die Tabelle. Gerundet wird nur hier, nie beim Sortieren.

export const NO_QUOTIENT = '–';

/**
 * Quotient Punkte/Spiele mit deutschem Dezimalkomma, kaufmännisch gerundet.
 * Rechnet ganzzahlig, damit z. B. 17/7 exakt zu „2,429“ wird. Bei 0 Spielen „–“.
 */
export function formatQuotient(points: number, played: number, decimals = 3): string {
  if (played === 0) return NO_QUOTIENT;
  return formatRatio(points, played, decimals);
}

/** Positive Brüche ganzzahlig runden und mit Komma ausgeben. */
export function formatRatio(numerator: number, denominator: number, decimals = 3): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 10) {
    throw new RangeError('Nachkommastellen müssen zwischen 0 und 10 liegen');
  }
  const scale = 10n ** BigInt(decimals);
  const n = BigInt(numerator);
  const d = BigInt(denominator);
  const scaled = (2n * n * scale + d) / (2n * d);
  const intPart = scaled / scale;
  if (decimals === 0) return intPart.toString();
  const frac = (scaled % scale).toString().padStart(decimals, '0');
  return `${intPart},${frac}`;
}

/** Tordifferenz mit Vorzeichen, z. B. „+3“, „0“, „−2“. */
export function formatGoalDiff(diff: number): string {
  if (diff > 0) return `+${diff}`;
  if (diff < 0) return `−${Math.abs(diff)}`;
  return '0';
}
