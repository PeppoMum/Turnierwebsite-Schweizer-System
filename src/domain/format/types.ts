// Turnier-Baukasten: gemeinsamer Vertrag zwischen Gruppen-, K.-o.-, Spielplan-, Daten- und UI-Teil.
// Fachliche Entscheidungen stehen in docs/turnier-baukasten.md.
//
// Ein Turnier ist eine Kette von Abschnitten (Stages). Abschnitte mit derselben `phase` laufen
// nebeneinander (z. B. Gold- und Silberrunde). Der erste Abschnitt bekommt alle Teams, jeder
// weitere bekommt seine Teams über eine Einstiegsregel. Wer von keiner Regel erfasst wird, ist
// ausgeschieden. Bestehende Turniere ohne `format` sind ein einzelner Abschnitt `swiss`.

/** Reihenfolge bei Punktgleichheit in Gruppen. Punkte sind immer 3 / 1 / 0. */
export type TieBreakVariant = 'h2h_first' | 'goals_first';

export type GroupTieBreaker = 'head_to_head' | 'goal_diff' | 'goals_for' | 'wins';

/** Das Los kommt bei beiden Varianten zuletzt und wird von der Turnierleitung gezogen. */
export const TIE_BREAK_ORDER: Readonly<Record<TieBreakVariant, readonly GroupTieBreaker[]>> = {
  h2h_first: ['head_to_head', 'goal_diff', 'goals_for', 'wins'],
  goals_first: ['goal_diff', 'goals_for', 'wins', 'head_to_head'],
};

export type StageKind = 'swiss' | 'groups' | 'knockout' | 'final_group' | 'placement';

export type StageColor = 'gold' | 'silver' | 'bronze' | 'neutral';

export type DrawMode = 'random' | 'pots' | 'manual';

/** Wie ein Unentschieden in einem K.-o.-Spiel entschieden wird. */
export type DrawDecider = 'penalties' | 'extra_time_then_penalties';

/** Verweis auf einen Platz, der erst während des Turniers feststeht (Platzhalter). */
export type SlotRef =
  /** „2. Gruppe B“: `group` ist 0-basiert (0 = A), `place` 1-basiert. */
  | { kind: 'group_place'; stageId: string; group: number; place: number }
  /** „bester Dritter“: `place` = Gruppenplatz, `rank` = 1 für den besten über alle Gruppen. */
  | { kind: 'best_of_place'; stageId: string; place: number; rank: number }
  /** Platz in einer einzigen Tabelle (Liga, Schweizer System, Finalgruppe). */
  | { kind: 'table_place'; stageId: string; place: number }
  /** Sieger oder Verlierer eines K.-o.-Spiels, z. B. `QF1`, `SF2`. */
  | { kind: 'winner' | 'loser'; stageId: string; matchKey: string }
  /** Von Hand gesetztes Team (nach Tauschen). */
  | { kind: 'team'; teamId: string };

/**
 * Wer in einen Abschnitt kommt. Feste Plätze und „die Besten eines Platzes“ lassen sich
 * kombinieren, z. B. Platz 1 und 2 jeder Gruppe plus die 2 besten Dritten.
 */
export interface EntryRule {
  fromStageId: string;
  /** Feste Plätze jeder Gruppe bzw. der Tabelle, 1-basiert. */
  places: number[];
  /** Die besten `count` Teams des Gruppenplatzes `place`, verglichen nach Quotient. */
  best?: { place: number; count: number }[];
}

interface StageBase {
  id: string;
  kind: StageKind;
  /** Anzeigename, z. B. „Vorrunde“, „Zwischenrunde“, „Goldrunde“. */
  name: string;
  /** 0 = Vorrunde. Gleiche Zahl = laufen nebeneinander. */
  phase: number;
  color: StageColor;
  /** `null` nur beim ersten Abschnitt (alle Teams). */
  entry: EntryRule | null;
  /** Spieldauer in diesem Abschnitt; fehlt = Turnier-Standard. */
  matchMinutes?: number;
  /** Platzbereich in der Endplatzierung, z. B. Gold 1–8. Fehlt bei Vor- und Zwischenrunde. */
  placeRange?: { from: number; to: number };
}

/** Bestehendes Schweizer System; Einstellungen bleiben am Turnier (roundsTotal usw.). */
export interface SwissStage extends StageBase {
  kind: 'swiss';
}

/** Gruppen, Liga (`groupCount` 1) oder Zwischenrunde (`phase` > 0). */
export interface GroupStage extends StageBase {
  kind: 'groups';
  groupCount: number;
  /** Gruppengrößen, wenn von der gleichmäßigen Verteilung abgewichen wird. */
  groupSizes?: number[];
  doubleRoundRobin: boolean;
  draw: DrawMode;
  /** Jede Gruppe bleibt auf einem festen Feld, wenn genug Felder da sind. */
  fixedFields: boolean;
  /** Nur Zwischenrunde: Punkte und Tore aus dem vorigen Abschnitt mitnehmen. Standard `false`. */
  carryOverPoints?: boolean;
}

/** K.-o.-Baum für 2, 4, 8, 16 oder 32 Teams (die Zahl geht laut Phil immer auf, kein Freilos). */
export interface KnockoutStage extends StageBase {
  kind: 'knockout';
  size: 2 | 4 | 8 | 16 | 32;
  /** `crossover`: 1. A gegen 2. B; `seeded`: Setzliste, Bester gegen Schwächsten. */
  pairing: 'crossover' | 'seeded';
  thirdPlace: boolean;
  /** Auch die Verlierer spielen alle Plätze aus. */
  allPlaces: boolean;
  drawDecider: DrawDecider;
  /** Spiele, die nur aus Neunmeterschießen bestehen, z. B. `['P3']`. */
  penaltyOnlyMatchKeys?: string[];
}

/** Jeder gegen jeden mit wenigen Teams als Endrunde. */
export interface FinalGroupStage extends StageBase {
  kind: 'final_group';
  doubleRoundRobin: boolean;
}

/** Einzelne Platzierungsspiele, z. B. 3. A gegen 3. B um Platz 5. */
export interface PlacementStage extends StageBase {
  kind: 'placement';
  matches: { key: string; place: number; slotA: SlotRef; slotB: SlotRef; penaltyOnly?: boolean }[];
  drawDecider: DrawDecider;
}

export type StageConfig = SwissStage | GroupStage | KnockoutStage | FinalGroupStage | PlacementStage;

export interface TournamentFormat {
  version: 1;
  /** In Spielreihenfolge. */
  stages: StageConfig[];
  tieBreakVariant: TieBreakVariant;
  /** Pause vor der ersten Endrunde in Minuten. */
  breakBeforeFinalsMinutes: number;
}

/** Zusatzfelder an einem Spiel im Baukasten. Fehlen sie, ist es ein Schweizer-System-Spiel. */
export interface StageMatchFields {
  stageId: string;
  /** Gruppe innerhalb eines `groups`-Abschnitts, 0-basiert. */
  groupIndex?: number;
  /** Fester Schlüssel im K.-o.-Baum: `R16_1`, `QF1`, `SF2`, `F`, `P3`, `P5` usw. */
  matchKey?: string;
  /** Platzhalter, solange das Team noch nicht feststeht. */
  slotA?: SlotRef;
  slotB?: SlotRef;
  penaltyOnly?: boolean;
  /** Wie das Spiel entschieden wurde; `goalsA/B` sind der Stand nach Verlängerung. */
  decidedBy?: 'regular' | 'extra_time' | 'penalties' | 'walkover';
  penaltiesA?: number;
  penaltiesB?: number;
  /** Uhrzeit/Feld von Hand gesetzt: eine Neuberechnung des Spielplans lässt sie stehen. */
  manual?: boolean;
}

/** Eine Zeile einer Gruppentabelle, gemeinsam genutzt von Gruppen-, K.-o.- und UI-Teil. */
export interface GroupTableRow {
  teamId: string;
  place: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  /** Wodurch der Platz gegen den Vordermann entschieden wurde (für das „i“). */
  decidedBy?: GroupTieBreaker | 'points' | 'lot';
}

export interface StageStandings {
  stageId: string;
  /** Eine Tabelle pro Gruppe (bei Liga, Schweizer System, Finalgruppe genau eine). */
  groups: GroupTableRow[][];
  /** Pro Gruppe: alle Spiele eingetragen. */
  groupComplete: boolean[];
}

/** Ergebnis der Endplatzierung. Geteilte Plätze haben `placeFrom` < `placeTo`. */
export type FinalPlacement =
  | { teamId: string; placeFrom: number; placeTo: number; stageId: string }
  | { teamId: string; eliminatedInStageId: string };
