// Gruppengrößen: so gleichmäßig wie möglich, die größeren Gruppen zuerst (18 Teams / 4 Gruppen = 5-5-4-4).

/** Gleichmäßige Verteilung von `teamCount` Teams auf `groupCount` Gruppen. */
export function evenGroupSizes(teamCount: number, groupCount: number): number[] {
  if (!Number.isInteger(groupCount) || groupCount < 1) throw new RangeError('Es braucht mindestens eine Gruppe.');
  if (!Number.isInteger(teamCount) || teamCount < 0) throw new RangeError('Ungültige Teamzahl.');
  const base = Math.floor(teamCount / groupCount);
  const extra = teamCount % groupCount;
  return Array.from({ length: groupCount }, (_, g) => base + (g < extra ? 1 : 0));
}

/** Fehlertexte für eigene Gruppengrößen; leer = in Ordnung. */
export function checkGroupSizes(teamCount: number, groupCount: number, sizes: readonly number[]): string[] {
  const errors: string[] = [];
  if (sizes.length !== groupCount) errors.push(`Es sind ${sizes.length} Gruppengrößen angegeben, aber ${groupCount} Gruppen.`);
  sizes.forEach((size, g) => {
    if (!Number.isInteger(size) || size < 2) errors.push(`Gruppe ${groupLetter(g)} braucht mindestens 2 Teams.`);
  });
  const sum = sizes.reduce((a, b) => a + b, 0);
  if (sum !== teamCount) errors.push(`Die Gruppen fassen ${sum} Teams, angemeldet sind ${teamCount}.`);
  return errors;
}

/** Eigene Größen, falls angegeben und gültig, sonst die gleichmäßige Verteilung. */
export function groupSizesFor(teamCount: number, stage: { groupCount: number; groupSizes?: readonly number[] }): number[] {
  if (stage.groupSizes && checkGroupSizes(teamCount, stage.groupCount, stage.groupSizes).length === 0) return [...stage.groupSizes];
  return evenGroupSizes(teamCount, stage.groupCount);
}

/** 0 = A, 1 = B, … 25 = Z, danach AA, AB … */
export function groupLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}
