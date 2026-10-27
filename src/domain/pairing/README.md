# Paarung (Spezifikation §7)

Reine, deterministische Funktionen ohne Firestore- oder UI-Abhängigkeit.

## Einstieg

| Funktion | Zweck |
|---|---|
| `previewNextRound({ ...turnierdaten, standings }, seed)` | Bequemer Einstieg für die Oberfläche: nächste Runde aus Turnierdaten + Tabelle aus `scoring`, Rückgabe wie der UI-Stellvertreter (`pairs`, `byeTeamId`, `diagnostics`) |
| `previewDrawRounds({ teams, count, seed, meetings? })` | Losrunden 1..R gemeinsam auslosen (§7.1) |
| `pairSwissRound({ roundNumber, teams, meetings, mode, seed })` | Schweizer Runde als globales Matching (§7.2) |
| `validatePairingPlan(...)`, `swapTeams(plan, x, y)` | Manuelle Änderung prüfen (§7.2 Schritt 7) |
| `collectMeetings(matches, { excludedTeamIds })` | Bisherige Begegnungen aus Matches ableiten |
| `checkRoundConfiguration(teams, rounds, preDraw)` | Frühe Warnung bei zu vielen Losrunden |

### Eingabe aus der Wertung

`PairingTeam = { id, name?, points, played, byes, lastByeRound? }` – nur **aktive** Teams.
`points`/`played` kommen aus `src/domain/scoring` und enthalten nur echte Spiele. Spiele
gegen zurückgezogene Teams sind dort für alle gelöscht; `collectMeetings` mit
`excludedTeamIds` löscht sie ebenso aus den Begegnungen (Phils Regel vom 27.10.2026).

Als Begegnung zählen `completed`, `live` und `scheduled` (fest angesetzt, wird gespielt).
`not_played`/`cancelled` zählen nicht: Die Teams haben sich nie gegenübergestanden.

## Verfahren

- **Matching:** Edmonds' gewichteter Blossom-Algorithmus (Portierung von `mwmatching.py`,
  O(n³)), aufgerufen als Minimum-Cost-Perfect-Matching. Exaktheit wird in
  `matching.test.ts` an Tausenden Zufallsgraphen gegen ein Bitmasken-DP geprüft. Kein Greedy.
- **Freilos:** Kandidaten = alle Teams mit minimaler Freiloszahl. Für **jeden** Kandidaten
  wird die Restrunde optimal gelöst; gewählt wird die global günstigste Kombination.
  Teams mit weniger Spielen (z. B. nach Ausfällen) werden ungern zusätzlich pausiert.
- **Losrunden:** ohne Vorgaben eine zufällig permutierte 1-Faktorisierung (Kreisverfahren) –
  garantiert die maximal mögliche Zahl wiederholungsfreier Runden und verschiedene
  Freilos-Teams. Mit festen Vorgaben (schon veröffentlichte Runden) Matching je Runde mit
  seeded Zufallskosten und 16 Neustarts, beste Gesamtauslosung gewinnt.
- **Kaltstart:** Teams ohne Spiel werden intern mit dem Durchschnittsquotienten eingestuft
  (ohne Spiele überhaupt: 1,5). Das wird nie angezeigt.
- **Zufall:** nur über `randomSeed` (Mulberry32 / FNV-Hash). Gleiche Eingabe + gleicher
  Seed = identischer Plan, unabhängig von der Reihenfolge der Eingabe.

## Kantenkosten (Tuning-Grundlage, OFFEN 3)

```
kosten = Q_eff · (Δquote/3)² + R · w² + T · max(0, w−1) + P · Δspiele / (1 + min(spiele)) + Jitter
Q_eff  = Q · s / (s + D)     s = mittlere Spielzahl (frühe Quoten sind wenig aussagekräftig)
```

| Modus | Q | R | T | D | Bedeutung |
|---|---|---|---|---|---|
| `balanced` (Standard) | 100 | 20 | 60 | 1 | Wiederholung nur, wenn die Alternative deutlich unausgeglichener ist |
| `strict_no_rematch` | wie balanced, Wiederholungskanten hart verboten | | | | Unmöglichkeit → `status: 'needs_confirmation'` mit ausgewogenem Vorschlag |
| `performance_first` | 100 | 6 | 40 | 0,5 | Quotennähe zählt mehr als Wiederholungsfreiheit |

Freilos: 30 je Spiel weniger als das Maximum, 5 für ein Freilos in der Vorrunde.
Alle Gewichte lassen sich je Aufruf über `weights` überschreiben.

## Diagnose

`plan.diagnostics` ist eine Obermenge von `PairingDiagnostics` (§5): Kosten, Wiederholungen,
Dreifachbegegnungen, mittlere/größte Quotenlücke, Freilos, dazu bewertete Freilos-Kandidaten,
deutsche Begründungen („Wiederholung bewusst gewählt: Ohne Wiederholung läge die größte
Quotenlücke bei …“), die beste wiederholungsfreie Alternative und `noRematchFeasible`.

## Messwerte (Node 22, simulierte späte Runde)

| Teams | Zeit je Runde |
|---|---|
| 16 | < 1 ms |
| 40 | ≈ 2–4 ms |
| 41 (ungerade, 41 Freilos-Kandidaten) | ≈ 70 ms |

Budget im Test: 500 ms je Runde bei 40/41 Teams.

Simulation 16 Teams / 8 Runden / 2 Losrunden, `balanced`: im Mittel 0,25 Wiederholungen
pro **ganzem Turnier**, nie eine Dreifachbegegnung, nie Erster gegen Letzter.
