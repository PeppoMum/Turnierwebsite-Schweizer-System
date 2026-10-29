// Änderungsverlauf in Alltagssprache: Audit-Einträge (src/data/audit.ts bzw. mockStore) werden
// mit den aktuellen Turnierdaten zu lesbaren Sätzen. Einträge ohne Bedeutung für die
// Turnierleitung (z. B. interne Vorschauen) liefern null und werden ausgeblendet.
import type { TournamentStatus, Visibility } from '../../domain';
import { tournamentStatusLabel, visibilityLabel } from '../format';
import type { HistoryEntry, TournamentData } from './types';
import { matchLabelOf, matchStateText, undoneIds } from './undo';

export interface HistoryLine {
  id: string;
  atISO: string;
  who: string;
  text: string;
  /** Für den Filter „Nur Ergebnisse“. */
  isResult: boolean;
  /** Dieser Schritt wurde später über „Rückgängig“ zurückgenommen. */
  undone: boolean;
  /** Dieser Schritt selbst nimmt einen früheren zurück (sein Rückgängig stellt ihn wieder her). */
  isUndo: boolean;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

function score(v: Rec): string | undefined {
  const a = num(v.goalsA);
  const b = num(v.goalsB);
  if (a === undefined || b === undefined) return undefined;
  const pa = num(v.penaltiesA);
  const pb = num(v.penaltiesB);
  if (v.decidedBy === 'penalties' && pa !== undefined && pb !== undefined) return `${a}:${b}, ${pa}:${pb} n. N.`;
  if (v.decidedBy === 'extra_time') return `${a}:${b} n. V.`;
  return `${a}:${b}`;
}

export function describeHistory(entries: HistoryEntry[], data: TournamentData, myUid?: string | null): HistoryLine[] {
  const t = data.tournament;
  const teamName = (id: unknown) => data.teams.find((x) => x.id === id)?.name ?? 'ein Team';
  const matchLabel = (id: string) => matchLabelOf(data, id);
  const matchCount = (v: Rec) => (Array.isArray(v.matches) ? v.matches.length : 0);
  const firstMatches = (v: Rec) =>
    (Array.isArray(v.matches) ? (v.matches as Rec[]) : [])
      .map((m) => matchLabel(String(m.id)))
      .join(' und ');
  const roundNumber = (e: HistoryEntry) => data.rounds.find((r) => r.id === e.targetId)?.number ?? num(rec(e.after).roundNumber);
  const who = (uid: string) => (myUid && uid === myUid ? 'Du' : uid === t.ownerUid ? 'Turnierleitung' : 'Helfer');

  const describe = (e: HistoryEntry): { text: string; isResult?: boolean } | null => {
    const before = rec(e.before);
    const after = rec(e.after);
    switch (e.action) {
      case 'tournament.create':
        return { text: 'Turnier angelegt' };
      case 'tournament.update': {
        const parts: string[] = [];
        const changed = (k: string) => k in after && before[k] !== after[k];
        if (changed('title')) parts.push(`Name „${str(before.title) ?? ''}“ → „${str(after.title) ?? ''}“`);
        if (changed('organizerName')) parts.push(`Veranstalter „${str(after.organizerName) ?? ''}“`);
        if (changed('venue')) parts.push(after.venue ? `Ort „${str(after.venue)}“` : 'Ort entfernt');
        if (changed('localDate')) parts.push(`Datum ${str(after.localDate) ?? ''}`);
        if (changed('organizerAssetId') || changed('eventAssetId')) parts.push('Logos');
        return parts.length > 0 ? { text: `Turnierdaten geändert: ${parts.join(', ')}` } : null;
      }
      case 'tournament.visibility':
        return { text: `Sichtbarkeit für Zuschauer: ${visibilityLabel[after.visibility as Visibility] ?? 'geändert'}` };
      case 'match.live':
        return { text: `Anpfiff: ${matchLabel(e.targetId)}`, isResult: true };
      case 'match.result.live':
      case 'match.result.final': {
        const now = score(after);
        const was = score(before);
        const final = e.action === 'match.result.final';
        if (before.status === 'completed' && was && was !== now) {
          return { text: `Ergebnis korrigiert: ${matchLabel(e.targetId)} ${now ?? ''} (vorher ${was})`, isResult: true };
        }
        const label = final ? 'Endstand' : 'Zwischenstand';
        return { text: `${label}: ${matchLabel(e.targetId)} ${now ?? ''}`.trim(), isResult: true };
      }
      case 'match.not_played':
        return { text: `Nicht ausgetragen: ${matchLabel(e.targetId)}`, isResult: true };
      case 'match.reopen':
        return { text: `Wieder geöffnet: ${matchLabel(e.targetId)}`, isResult: true };
      case 'match.reset':
        return { text: `Zurück auf „geplant“: ${matchLabel(e.targetId)}`, isResult: true };
      case 'match.undo':
        return { text: `Zurückgesetzt: ${matchLabel(e.targetId)}, jetzt ${matchStateText(after)}`, isResult: true };
      case 'round.publish':
        return { text: `Runde ${roundNumber(e) ?? ''} veröffentlicht` };
      case 'round.close':
        return { text: `Runde ${roundNumber(e) ?? ''} abgeschlossen` };
      case 'round.reopen':
        return { text: `Runde ${roundNumber(e) ?? ''} wieder geöffnet` };
      case 'schedule.shift': {
        const d = num(after.deltaMinutes) ?? 0;
        return { text: `Spielplan ${d >= 0 ? 'nach hinten' : 'nach vorne'} verschoben um ${Math.abs(d)} Min.` };
      }
      case 'team.no_show':
        return { text: `${teamName(after.teamId)} als nicht erschienen markiert` };
      case 'team.withdrawn':
        return { text: `${teamName(after.teamId)} zurückgezogen` };
      case 'team.restore':
        return { text: `${teamName(after.teamId)} wieder aufgenommen` };
      case 'team.add':
        return { text: `Mannschaft nachgemeldet: ${str(after.name) ?? teamName(after.teamId)}` };
      case 'team.update':
        return before.name && before.name !== after.name
          ? { text: `Mannschaft umbenannt: „${str(before.name)}“ → „${str(after.name) ?? ''}“` }
          : { text: `Logo von ${str(after.name) ?? 'einer Mannschaft'} geändert` };
      case 'tournament.publish':
        return { text: 'Gruppen und Spielplan für Zuschauer veröffentlicht' };
      case 'groups.draw': {
        const stage = data.tournament.format?.stages.find((x) => x.id === e.targetId)?.name ?? 'Gruppen';
        return { text: `${stage}: Gruppen ${before.groups ? 'neu ' : ''}eingeteilt` };
      }
      case 'tournament.reshape': {
        const missing = Array.isArray(after.teams) ? (after.teams as { id: unknown }[]).map((t) => teamName(t.id)) : [];
        return { text: `Turnier umgestellt: ${str(after.title) ?? 'neuer Plan'}${missing.length > 0 ? ` (ohne ${missing.join(', ')})` : ''}` };
      }
      case 'schedule.save':
        return { text: `Spielplan gespeichert (${num(after.matchCount) ?? 0} Spiele)` };
      case 'match.swap':
        return { text: `Spiele getauscht: ${firstMatches(after)}` };
      case 'match.swap_teams':
        return { text: `Gegner getauscht: ${firstMatches(after)}` };
      case 'match.move':
        return { text: `Uhrzeit oder Feld geändert: ${firstMatches(after)}` };
      case 'finals.fill':
        return { text: `Endrunde gefüllt (${matchCount(after)} ${matchCount(after) === 1 ? 'Spiel' : 'Spiele'})` };
      case 'schedule.compact':
        return { text: `Plan gestrafft: ${matchCount(after)} ${matchCount(after) === 1 ? 'Spiel rückt' : 'Spiele rücken'} nach vorne` };
      case 'schedule.longer': {
        const mins = Array.isArray(after.matches) ? num((after.matches as Rec[])[0]?.durationMinutes) : undefined;
        return { text: `Dreiergruppe spielt länger${mins ? ` (${mins} Min.)` : ''}: ${matchCount(after)} ${matchCount(after) === 1 ? 'Spiel' : 'Spiele'}` };
      }
      case 'team.present':
        return { text: after.present ? `${teamName(after.teamId)} ist da` : `${teamName(after.teamId)}: „ist da“ zurückgenommen` };
      case 'matches.undo':
        return { text: `Spiele zurückgesetzt: ${firstMatches(after)}` };
      case 'lot.draw': {
        const order = Array.isArray(after.order) ? (after.order as unknown[]).map(teamName) : [];
        return { text: `Los gezogen: ${order.join(' vor ')}` };
      }
      case 'team.withdraw_qualified':
        return after.choice === 'replace'
          ? { text: `${teamName(after.teamId)} zieht zurück, ${teamName(after.byTeamId)} rückt nach` }
          : { text: `${teamName(after.teamId)} zieht zurück, Gegner kampflos weiter` };
      case 'invitation.create':
        return { text: 'Helfer-Einladung erstellt' };
      case 'invitation.revoke':
        return { text: 'Helfer-Einladung zurückgezogen' };
      case 'grant.revoke':
        return { text: 'Helfer entfernt' };
      default: {
        const status = /^tournament\.status\.(\w+)$/.exec(e.action)?.[1] as TournamentStatus | undefined;
        if (status && tournamentStatusLabel[status]) return { text: `Turnierstatus: ${tournamentStatusLabel[status]}` };
        // Vorschauen und unbekannte interne Schritte nicht anzeigen.
        return null;
      }
    }
  };

  const byId = new Map(entries.map((e) => [e.id, e]));
  const undone = undoneIds(entries);
  const lines: HistoryLine[] = [];
  for (const e of entries) {
    const d = describe(e);
    if (!d) continue;
    // Rückgängig-Schritte nennen den Schritt, den sie zurücknehmen.
    const undoOf = rec(e.after).undoOf;
    const original = typeof undoOf === 'string' ? byId.get(undoOf) : undefined;
    const originalText = original ? describe(original)?.text : undefined;
    const text = originalText ? `Rückgängig gemacht: ${originalText}` : d.text;
    lines.push({ id: e.id, atISO: e.atISO, who: who(e.actorUid), text, isResult: d.isResult ?? false, undone: undone.has(e.id), isUndo: !!original });
  }
  return lines;
}
