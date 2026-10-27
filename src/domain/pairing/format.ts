/** Deutsche Zahlendarstellung, z. B. 2,429. */
export function formatNumber(value: number, digits = 3): string {
  return value.toFixed(digits).replace('.', ',');
}

export function teamLabel(names: ReadonlyMap<string, string>, id: string): string {
  return names.get(id) ?? id;
}
