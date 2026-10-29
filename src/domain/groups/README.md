# Gruppen (Turnier-Baukasten)

Reine Logik für Gruppenabschnitte (`GroupStage` aus `src/domain/format/types.ts`). Entscheidungen: `docs/turnier-baukasten.md`.

| Datei | Inhalt |
| --- | --- |
| `sizes.ts` | Gruppengrößen so gleichmäßig wie möglich (18 / 4 = 5-5-4-4), eigene Größen prüfen |
| `draw.ts` | Auslosen per Zufall (Seed) oder Lostöpfen, Prüfung einer Einteilung von Hand |
| `fixtures.ts` | Jeder gegen jeden (Kreisverfahren), optional Rückspiel, kein Team zweimal hintereinander wenn vermeidbar |
| `table.ts` | Gruppentabelle 3/1/0, Punktgleichheit nach Variante 1/2, Mini-Tabelle, gezogene Lose, Mitnahme von Punkten |
| `stage.ts` | Alle Gruppen eines Abschnitts -> `StageStandings` inkl. „Gruppe fertig“ |
| `crossover.ts` | Zwischenrunde über Kreuz (E: 1A 2B 1C 2D, F: 1B 2A 1D 2C) als Platzhalter |
| `labels.ts` | Deutsche Texte für die Oberfläche |

Offene Lose: Ist ein Gleichstand nur per Los zu trennen und noch keins gezogen, steht er in `GroupTable.openLots`
und die Reihenfolge ist vorläufig (nach Name). Die Turnierleitung zieht das Los; das Ergebnis kommt als `LotDecision`
wieder herein (gespeichert von der Datenschicht).
