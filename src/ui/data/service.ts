// Schnittstelle zwischen Oberfläche und Datenhaltung. Heute steckt eine Beispiel-Implementierung im Browser dahinter
// (mockStore.ts), später Firestore. Alle schreibenden Aufrufe sind asynchron, damit sich am UI nichts ändern muss.
// Schreibfehler (fehlende Rechte, inzwischen geänderte Daten) als Error mit deutscher, verständlicher Meldung werfen;
// die Oberfläche zeigt sie an.
import type { MatchStatus, NotPlayedReason, Visibility } from '../../domain';
import type { HistoryEntry, PairingPreview, PublicTournamentView, TeamEdit, TournamentData, TournamentDetails, WizardDraft } from './types';

export interface TournamentService {
  subscribe(listener: () => void): () => void;
  /** Stabile Referenz, solange sich nichts geändert hat (für useSyncExternalStore). */
  getAll(): TournamentData[];
  get(id: string): TournamentData | undefined;
  /** true, solange Daten noch laden (get/getPublic liefern dann kurz undefined). */
  isLoading?(id?: string): boolean;
  getPublic(id: string): PublicTournamentView | undefined;

  createTournament(draft: WizardDraft, publish: boolean): Promise<string>;
  duplicateTournament(id: string): Promise<string>;
  setArchived(id: string, archived: boolean): Promise<void>;
  setVisibility(id: string, visibility: Visibility): Promise<void>;
  /** Helferlink ohne Anmeldung ein- oder ausschalten; „renew“ ersetzt ihn, der alte gilt dann nicht mehr. */
  setOpenHelperLink(id: string, mode: 'on' | 'off' | 'renew'): Promise<void>;

  recordScore(tid: string, matchId: string, goalsA: number, goalsB: number): Promise<void>;
  setMatchStatus(tid: string, matchId: string, status: Extract<MatchStatus, 'scheduled' | 'live' | 'completed'>): Promise<void>;
  markNotPlayed(tid: string, matchId: string, reason: NotPlayedReason): Promise<void>;
  reopenMatch(tid: string, matchId: string): Promise<void>;

  previewNextRound(tid: string, seed?: number): PairingPreview;
  publishRound(tid: string, preview: PairingPreview, startISO: string): Promise<void>;
  closeCurrentRound(tid: string): Promise<void>;
  shiftFutureMatches(tid: string, deltaMinutes: number): Promise<number>;

  withdrawTeam(tid: string, teamId: string): Promise<void>;
  restoreTeam(tid: string, teamId: string): Promise<void>;
  finishTournament(tid: string): Promise<void>;

  /** Name, Veranstalter, Ort, Datum, Logos und Sponsoren nachträglich ändern. */
  updateDetails(tid: string, details: TournamentDetails): Promise<void>;
  /** Mannschaft umbenennen oder Logo ändern; ohne teamId wird eine Mannschaft nachgemeldet. */
  saveTeam(tid: string, teamId: string | null, team: TeamEdit): Promise<void>;
  /** Änderungsverlauf, neueste zuerst. */
  loadHistory(tid: string): Promise<HistoryEntry[]>;
  /**
   * Einen Schritt aus dem Verlauf zurücknehmen (Regeln in undo.ts). Prüft vorher noch einmal mit
   * dem aktuellen Stand und wirft eine verständliche Meldung, wenn es nicht mehr geht.
   */
  undoHistory(tid: string, entry: HistoryEntry): Promise<void>;
}
