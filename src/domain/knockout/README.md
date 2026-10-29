# Weiterkommen, K.-o. und Endplatzierung

Reine Funktionen ohne Firestore- oder UI-Abhängigkeit. Fachliche Regeln: `docs/turnier-baukasten.md`.
Eingabe sind `StageStandings` aus dem Gruppen-Teil (`src/domain/groups`), in Tests hand gebaut (`testUtils.ts`).

## Einstieg

| Funktion | Zweck |
|---|---|
| `validateFormat(format, teamCount)` | Prüfung beim Anlegen: Regel ergibt genau die Baumgröße, kein Platz doppelt, Platzbereiche überschneiden sich nicht. Meldungen in Alltagssprache |
| `buildFormatBrackets(format, teamCount)` | Alle K.-o.- und Platzierungsspiele mit Platzhaltern (`slotA/B`), Runde und Platzbereich – für Spielplan und Speichern |
| `buildBracket(stage, entrants)` | Ein K.-o.-Baum; Paarung über Kreuz oder Setzliste, Teams derselben Gruppe so spät wie möglich |
| `entrySlots`, `rankBestOfPlace`, `compareAcrossGroups` | Einstiegsregel in Platzhalter, „beste Dritte“ nach Quotient (Punkte, Tordifferenz, Tore je Spiel) |
| `decideKnockoutMatch`, `formatKnockoutResult` | Sieger aus Toren, Verlängerung, Neunmeter, reinem Neunmeterschießen, kampflos; Anzeige „1:1, 4:3 n. N.“ |
| `matchLabel(key, offset)` | „Viertelfinale 2“, „Spiel um Platz 3“, „Halbfinale 1, Platz 5–8“ |

In `src/domain/format/resolve.ts`:

| Funktion | Zweck |
|---|---|
| `resolveFormat(input)` | Platzhalter auflösen: Vorschau (`provisional`), Vorschlag `changes` für noch nicht angepfiffene Spiele, `locked` für schon laufende, fehlende Lose (`needsLot`), Teams je Abschnitt (`entrants`) |
| `withdrawalOptions(input, teamId)` | Rückzug vor dem Endrunden-Spiel: „Gegner kampflos weiter“ oder „Nächstbester rückt nach“ |
| `finalPlacements(input)` | Endplatzierung mit geteilten Plätzen („5.–8.“), Ausgeschiedene ohne Platz, `open` für noch Spielende |

## Spielschlüssel

Hauptbaum `R32_n`, `R16_n`, `QFn`, `SFn`, `F`; Endspiel um Platz n heißt `Pn` (`P3`, `P5`, `P7`); Runden davor
bekommen den Startplatz als Vorsilbe (`P5_SF1` = Halbfinale um die Plätze 5–8). Plätze sind relativ zum Abschnitt
(Silberrunde 9–16: ihr `F` ist Platz 9). Platzierungsabschnitte behalten ihre Schlüssel aus dem Format.

## Für die Daten- und Oberflächen-Teile

- Eingetragen wird nie automatisch: `changes` zeigen, die Turnierleitung bestätigt, dann `teamAId/teamBId` setzen.
- Von Hand getauschte Teams als `slotA/B: { kind: 'team', teamId }` speichern, dann bleiben sie bei Neuberechnungen.
- Kampflos: `decidedBy: 'walkover'` plus `walkoverWinner: 'A' | 'B'` (neues optionales Feld in `StageMatchFields`).
- Lose beim Vergleich über Gruppen: `lotOrders['<stageId>|<platz>'] = [teamId, …]`, besseres zuerst.
- Haben „beste Dritte“ im Baum einen Gegner aus der eigenen Gruppe, verteilt `resolveFormat` sie neu
  (so wie bei großen Turnieren üblich); die Plätze der festen Gruppenplätze bleiben.
