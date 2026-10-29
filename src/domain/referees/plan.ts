// Schiri-Einteilung: Vorschlag, wer welches Spiel pfeift. Rein rechnerisch, ändert nie den Spielplan.
//
// Regeln für den Vorschlag:
// - Ein Schiri pfeift nie zwei Spiele, die sich zeitlich überschneiden.
// - Alle Schiris bekommen möglichst gleich viele Spiele (auch mitgezählt: Spiele, die sie schon haben).
// - Bei Gleichstand kommt dran, wer am längsten nicht gepfiffen hat; so gibt es Pausen, wo es geht.
// - Spiele ohne Uhrzeit bekommen keinen Vorschlag (man weiß nicht, ob sich etwas überschneidet).
// - Gibt es zu einer Zeit mehr Spiele als freie Schiris, bleiben Spiele frei und werden gemeldet.

export interface RefMatch {
  id: string;
  startISO?: string;
  durationMinutes: number;
}

export interface RefPlanInput {
  matches: readonly RefMatch[];
  /** Schiris in fester Reihenfolge (z. B. Anmeldung); entscheidet nur den letzten Gleichstand. */
  refereeIds: readonly string[];
  /** Schon eingeteilt: Spiel → Schiri. Zählt bei Überschneidungen und für die Verteilung mit. */
  existing: ReadonlyMap<string, string>;
  /** Für diese Spiele einen Vorschlag machen. */
  scope: readonly string[];
  /** true: vorhandene Einteilungen im Bereich bleiben, nur freie Spiele werden verteilt. */
  keepExisting: boolean;
}

export interface RefPlan {
  /** Neue Einteilung für alle Spiele im Bereich (bei keepExisting nur die bisher freien). */
  assignments: Array<{ matchId: string; refereeId: string }>;
  /** Spiele im Bereich, für die zu der Zeit kein Schiri frei war, oder ohne Uhrzeit. */
  unassigned: string[];
  /** Spiele je Schiri nach dem Vorschlag (über das ganze Turnier). */
  counts: Record<string, number>;
}

interface Span {
  start: number;
  end: number;
}

function spanOf(m: RefMatch): Span | null {
  if (!m.startISO) return null;
  const start = new Date(m.startISO).getTime();
  if (!Number.isFinite(start)) return null;
  return { start, end: start + Math.max(1, m.durationMinutes) * 60_000 };
}

const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

export function planReferees(input: RefPlanInput): RefPlan {
  const byId = new Map(input.matches.map((m) => [m.id, m]));
  const scope = new Set(input.scope.filter((id) => byId.has(id)));
  const refs = [...new Set(input.refereeIds)];
  const known = new Set(refs);

  // Was bleibt fest: alles außerhalb des Bereichs, im Bereich nur bei keepExisting.
  const fixed = new Map<string, string>();
  for (const [matchId, refId] of input.existing) {
    if (!byId.has(matchId) || !known.has(refId)) continue;
    if (!scope.has(matchId) || input.keepExisting) fixed.set(matchId, refId);
  }

  const busy = new Map<string, Span[]>(refs.map((r) => [r, []]));
  const counts: Record<string, number> = Object.fromEntries(refs.map((r) => [r, 0]));
  const lastEnd = new Map<string, number>();
  const take = (refId: string, m: RefMatch) => {
    counts[refId] = (counts[refId] ?? 0) + 1;
    const span = spanOf(m);
    if (!span) return;
    busy.get(refId)!.push(span);
  };
  for (const [matchId, refId] of fixed) take(refId, byId.get(matchId)!);

  const todo = [...scope]
    .filter((id) => !fixed.has(id))
    .map((id) => byId.get(id)!)
    .sort((a, b) => (spanOf(a)?.start ?? Infinity) - (spanOf(b)?.start ?? Infinity) || a.id.localeCompare(b.id));

  const assignments: RefPlan['assignments'] = [];
  const unassigned: string[] = [];
  for (const m of todo) {
    const span = spanOf(m);
    if (!span) {
      unassigned.push(m.id);
      continue;
    }
    // „Zuletzt gepfiffen“ bezogen auf diese Anstoßzeit, inklusive fester Spiele davor.
    for (const r of refs) {
      const before = busy.get(r)!.filter((s) => s.end <= span.start);
      lastEnd.set(r, before.length ? Math.max(...before.map((s) => s.end)) : -Infinity);
    }
    const free = refs.filter((r) => !busy.get(r)!.some((s) => overlaps(s, span)));
    if (free.length === 0) {
      unassigned.push(m.id);
      continue;
    }
    free.sort((a, b) => counts[a]! - counts[b]! || lastEnd.get(a)! - lastEnd.get(b)! || refs.indexOf(a) - refs.indexOf(b));
    const pick = free[0]!;
    take(pick, m);
    assignments.push({ matchId: m.id, refereeId: pick });
  }
  return { assignments, unassigned, counts };
}

/** Ein Schiri hat zur selben Zeit schon ein anderes Spiel: die Spiel-ID, sonst null. */
export function refereeClash(
  matches: readonly RefMatch[],
  assigned: ReadonlyMap<string, string>,
  refereeId: string,
  matchId: string,
): string | null {
  const target = matches.find((m) => m.id === matchId);
  const span = target && spanOf(target);
  if (!span) return null;
  for (const m of matches) {
    if (m.id === matchId || assigned.get(m.id) !== refereeId) continue;
    const s = spanOf(m);
    if (s && overlaps(s, span)) return m.id;
  }
  return null;
}

/** Die übliche Spieldauer (am häufigsten), um abweichende Spiele hervorzuheben. */
export function usualDuration(matches: readonly Pick<RefMatch, 'durationMinutes'>[]): number | null {
  const count = new Map<number, number>();
  for (const m of matches) count.set(m.durationMinutes, (count.get(m.durationMinutes) ?? 0) + 1);
  let best: number | null = null;
  let bestCount = 0;
  for (const [d, c] of count) {
    if (c > bestCount || (c === bestCount && best !== null && d < best)) {
      best = d;
      bestCount = c;
    }
  }
  return best;
}
