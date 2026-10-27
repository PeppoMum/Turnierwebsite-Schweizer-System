# Wertung und Tabelle

Umsetzung: `src/domain/scoring/` (reine Funktionen, keine Abhängigkeit zu Firebase oder React).
Einstieg: `calculateStandings(input)` liefert die fertig sortierte Tabelle.

## Was zählt

- Nur Spiele mit Status `completed` und zwei ganzzahligen, nicht negativen Torwerten.
- `not_played`, `cancelled`, `draft`, `scheduled` und `live` zählen nirgends: nicht bei Spielen, Punkten, Toren, direktem Vergleich oder Buchholz.
- Ein Freilos ist kein Spiel: keine Punkte, keine Tore. Es wird nur gezählt (Spalte „Freilose“).
- Sieg 3, Remis 1, Niederlage 0.

## Zurückgezogene Teams (verbindliche Entscheidung vom 27.10.2026)

Abweichend von Spezifikation §6.1 („Ergebnisse bleiben historisch“):

- Ein zurückgezogenes Team kann nie Turniersieger werden. Es steht ohne Platz unter der Tabelle.
- **Alle** Spiele mit diesem Team werden für **alle** Teams aus der Wertung gelöscht, als hätten sie nie stattgefunden, egal ob gewonnen, verloren oder unentschieden. Das wirkt auch auf direkten Vergleich und Buchholz.
- Die Spiele bleiben in den Daten erhalten und können im Spielplan weiter angezeigt werden.

Dieselbe Behandlung gilt für Teams mit Status `no_show` und `inactive`. Gewertet wird nur, wer `active` ist.

## Reihenfolge

1. **Quotient** = Punkte / Spiele, exakt verglichen über Kreuzmultiplikation (`A.punkte × B.spiele` gegen `B.punkte × A.spiele`). Gerundet wird nur für die Anzeige (Standard 3 Nachkommastellen, z. B. 17/7 → „2,429“). Teams ohne Spiel zeigen „–“ und stehen hinter allen Teams mit Quotient.
2. **Feinwertungen** in der eingestellten Reihenfolge (Standard: direkter Vergleich, Tordifferenz, erzielte Tore; Buchholz optional).
3. **Losentscheid** mit gespeichertem Seed, wenn alles gleich ist.

### Direkter Vergleich

- Gewertet werden die Punkte aus den gewerteten Spielen der gleichstehenden Teams untereinander.
- Zwei Teams: gilt, sobald sie mindestens einmal gewertet gegeneinander gespielt haben. Bei Hin- und Rückspiel werden die Punkte addiert.
- Drei oder mehr Teams: gilt nur bei einer vollständigen, vergleichbaren Mini-Liga, also wenn jedes Paar gleich oft (mindestens einmal) gegeneinander gespielt hat. Sonst wird das Kriterium für die ganze Gruppe übersprungen.
- Trennt der direkte Vergleich die Gruppe nur teilweise, wird er für die verbleibenden gleichstehenden Teams erneut nur unter ihnen gebildet. Danach geht es mit dem nächsten Kriterium weiter.

### Buchholz (optional)

Drei Varianten, wählbar über `ranking.buchholzVariant`:

| Variante | Berechnung |
|---|---|
| `avg_opponent_quotient` (Standard) | Durchschnitt der Quotienten aller Gegner |
| `sum_opponent_quotient` | Summe der Quotienten aller Gegner |
| `sum_opponent_points` | Summe der Punkte aller Gegner (klassisch) |

Gezählt wird jedes gewertete Spiel einzeln (bei zwei Spielen gegen denselben Gegner zählt er doppelt). Freilose, nicht ausgetragene Spiele und Spiele gegen zurückgezogene Teams erzeugen keinen Gegner. Der Durchschnitt ist Standard, weil die Wertung selbst auf Quotienten beruht: Eine Summe würde Teams mit mehr Spielen bevorzugen. Verglichen wird exakt mit Brüchen.

### Losentscheid

Jedes Team erhält aus `lotSeed` (z. B. Turnier-ID) und Team-ID eine feste Losnummer. Bei vollständigem Gleichstand entscheidet die kleinere Losnummer. Dieselben Daten ergeben immer dieselbe Tabelle, unabhängig von der Reihenfolge, in der Teams und Spiele geladen werden. Jede Tabellenzeile nennt in `decidedBy`, welches Kriterium sie vom Team darüber trennt, damit die Oberfläche einen Losentscheid offen anzeigen kann.

## Tests

- `standings.test.ts`: Beispiele aus der Spezifikation (u. a. 17/7 vor 18/8), Mini-Liga-Regeln, Buchholz-Varianten, Rückzug.
- `standings.property.test.ts`: je 400 zufällige Turniere (3–40 Teams, 1–12 Runden, Ausfälle, Rückzüge) mit Invarianten wie Punktesumme, eindeutige Plätze, Reihenfolge-Unabhängigkeit, Rückzug = „nie gespielt“ und Laufzeitbudget.
