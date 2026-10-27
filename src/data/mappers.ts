// Umwandlung Firestore-Dokument -> Domänentyp (Timestamp -> ISO-String).
import type { Timestamp } from 'firebase/firestore';
import type { Match, RoleGrant, Round, Tournament } from '../domain';
import type { MatchDoc, RoleGrantDoc, RoundDoc, TournamentDoc } from './model';

/** Timestamp (oder noch ausstehender serverTimestamp = null) -> ISO-String. */
export function iso(ts: Timestamp | null | undefined): string | undefined {
  return ts ? ts.toDate().toISOString() : undefined;
}

export function toTournament(id: string, d: TournamentDoc): Tournament & { resultsRevision: number } {
  return {
    ...d,
    id,
    publishedAt: iso(d.publishedAt),
    finishedAt: iso(d.finishedAt),
    createdAt: iso(d.createdAt) ?? '',
    updatedAt: iso(d.updatedAt) ?? '',
  };
}

export function toMatch(id: string, d: MatchDoc): Match {
  const { lastAuditId: _audit, updatedBy: _by, ...rest } = d;
  void _audit;
  void _by;
  return {
    ...rest,
    id,
    goalsA: d.goalsA ?? undefined,
    goalsB: d.goalsB ?? undefined,
    notPlayedReason: d.notPlayedReason ?? undefined,
    completedAt: iso(d.completedAt),
    createdAt: iso(d.createdAt) ?? '',
    updatedAt: iso(d.updatedAt) ?? '',
  };
}

export function toRound(id: string, d: RoundDoc): Round & { matchIds: string[] } {
  const { updatedAt: _u, ...rest } = d;
  void _u;
  return {
    ...rest,
    id,
    publishedAt: iso(d.publishedAt),
    closedAt: iso(d.closedAt),
  };
}

export function toRoleGrant(d: RoleGrantDoc): RoleGrant & {
  allowedFieldIds: string[] | null;
  canPublishRounds: boolean;
  email: string | null;
} {
  return {
    tournamentId: d.tournamentId,
    uid: d.uid,
    role: d.role,
    expiresAt: iso(d.expiresAt),
    revokedAt: iso(d.revokedAt),
    allowedFieldIds: d.allowedFieldIds ?? null,
    canPublishRounds: d.canPublishRounds ?? false,
    email: d.email ?? null,
  };
}

/** Grant aktiv = nicht widerrufen und nicht abgelaufen (wie in den Regeln). */
export function isGrantActive(d: RoleGrantDoc, now: Date = new Date()): boolean {
  if (d.revokedAt) return false;
  return !d.expiresAt || d.expiresAt.toMillis() > now.getTime();
}
