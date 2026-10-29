// Schnittstelle zwischen Oberfläche und Datenhaltung. Heute steckt eine Beispiel-Implementierung im Browser dahinter
// (mockStore.ts), später Firestore. Alle schreibenden Aufrufe sind asynchron, damit sich am UI nichts ändern muss.
// Schreibfehler (fehlende Rechte, inzwischen geänderte Daten) als Error mit deutscher, verständlicher Meldung werfen;
// die Oberfläche zeigt sie an.
import type { MatchStatus, NotPlayedReason, Visibility } from '../../domain';
import type {
  GroupDraw,
  HistoryEntry,
  KnockoutResult,
  LotDecision,
  MatchMove,
  MatchSide,
  PairingPreview,
  PlannedStageMatch,
  PublicTournamentView,
  RefereeReport,
  SlotFill,
  TeamEdit,
  TournamentData,
  TournamentDetails,
  WithdrawalChoice,
  WizardDraft,
} from './types';

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

  // Turnier-Baukasten (docs/turnier-baukasten.md). Alles nur bei Turnieren mit `format`, nur für die
  // Turnierleitung; Ausnahme ist `finishKnockoutMatch`, das dürfen auch Helfer. Jede Änderung landet im Verlauf.
  // Gruppen-Spiele laufen über recordScore/setMatchStatus wie bisher. `createTournament` legt mit
  // `draft.format` keine Schweizer-System-Runde an; Zuschauer sehen erst nach `publishTournament` etwas.

  /**
   * Gruppeneinteilung eines Gruppenabschnitts speichern (Auslosung oder von Hand), nur solange in dem
   * Abschnitt noch nicht gespielt wurde. Die offenen Spiele ändern sich dadurch nicht: danach den neu
   * berechneten Spielplan mit `saveStagePlan` speichern.
   */
  saveGroupDraw(tid: string, draw: Omit<GroupDraw, 'updatedAt'>): Promise<void>;
  /**
   * Spielplan aller Abschnitte speichern. Ersetzt alle noch nicht angepfiffenen Baukasten-Spiele;
   * angepfiffene und beendete bleiben, wie sie sind. Gibt die IDs der gespeicherten Spiele zurück.
   */
  saveStagePlan(tid: string, matches: PlannedStageMatch[]): Promise<string[]>;
  /** Endrunden-Spiel mit Sieger beenden, auch nach Verlängerung oder Neunmeterschießen. */
  finishKnockoutMatch(tid: string, matchId: string, result: KnockoutResult): Promise<void>;
  /** Zwei noch nicht angepfiffene Spiele tauschen Uhrzeit und Feld. */
  swapMatches(tid: string, matchIdA: string, matchIdB: string): Promise<void>;
  /** Zwei Teams (oder Platzhalter) zwischen noch nicht angepfiffenen Spielen tauschen. */
  swapTeams(tid: string, a: MatchSide, b: MatchSide): Promise<void>;
  /** Feld und/oder Uhrzeit eines noch nicht angepfiffenen Spiels ändern. */
  moveMatch(tid: string, matchId: string, move: MatchMove): Promise<void>;
  /** Vorschlag zum Füllen der Endrunde bestätigen (aus src/domain/format/resolve.ts). */
  confirmSlotFills(tid: string, fills: SlotFill[]): Promise<void>;
  /** Gezogenes Los speichern; ein Los für dieselben Teams an derselben Stelle wird ersetzt. */
  saveLot(tid: string, lot: Omit<LotDecision, 'id' | 'atISO'>): Promise<void>;
  /** Qualifiziertes Team zieht vor seinem Endrunden-Spiel zurück: Gegner kampflos weiter oder Nachrücker. */
  withdrawQualifiedTeam(tid: string, teamId: string, choice: WithdrawalChoice): Promise<void>;
  /** Gruppen und Spielplan für Zuschauer freigeben. */
  publishTournament(tid: string): Promise<void>;

  // Schiris (optional, über den Schiri-Link). Nichts davon ändert Spiele, Spielplan oder Tabelle; nur
  // `acceptRefereeReport` (Turnierleitung) trägt ein gemeldetes Ergebnis als echtes Ergebnis ein.

  /** Schiri-Link ohne Anmeldung ein- oder ausschalten; „renew“ ersetzt ihn, der alte gilt dann nicht mehr. */
  setOpenRefereeLink(id: string, mode: 'on' | 'off' | 'renew'): Promise<void>;
  /**
   * Sich als Schiri mit Namen eintragen oder den Namen ändern. `refereeId` nur für die Turnierleitung
   * (fremden Namen ändern); sonst gilt die eigene ID. Liefert die ID des Schiris.
   */
  saveReferee(tid: string, name: string, refereeId?: string): Promise<string>;
  /** Schiri austragen (Turnierleitung); seine Spiele werden wieder frei. */
  removeReferee(tid: string, refereeId: string): Promise<void>;
  /** Einteilung ändern: je Spiel ein Schiri oder null (frei). */
  assignReferees(tid: string, changes: Array<{ matchId: string; refereeId: string | null }>): Promise<void>;
  /** Ergebnis als Schiri melden (null nimmt die Meldung zurück). */
  reportRefereeResult(tid: string, matchId: string, report: Omit<RefereeReport, 'atISO'> | null): Promise<void>;
  /** Turnierleitung übernimmt das gemeldete Ergebnis als echtes Ergebnis (Spiel beendet). */
  acceptRefereeReport(tid: string, matchId: string): Promise<void>;
}
