# Feld- und Wellenplanung (Spezifikation §8)

Getrennter Schritt nach der Paarung; die Paarungen werden nie verändert.

| Funktion | Zweck |
|---|---|
| `createWaveSchedule(rounds, fields, constraints, { teamLastEndISO?, teamNames? })` | Runden auf Wellen und Felder verteilen |
| `planWaves(...)`, `wavesPerRound`, `roundMinutes` | Einfache Vorschau ohne Teamwissen, gleiche Signatur wie der UI-Stellvertreter |
| `waveSizes(matches, fields, allocation)` | `max_capacity` (5 + 3) oder `balanced_waves` (4 + 4) |
| `validateSchedule(matches, { turnoverMinutes })` | Feld doppelt belegt, Team gleichzeitig in zwei Spielen, Pausen |
| `previewShift(matches, ±min, { fromRoundNumber? })` | Nur noch nicht begonnene Spiele verschieben, mit Kollisionsprüfung |
| `zonedLocalToISO(date, time, tz)`, `formatLocalTime(iso, tz)` | Lokale Zeit ↔ Zeitpunkt, Sommerzeit-sicher |

## Ablauf je Runde

1. Start = fester Rundenstart des Admins oder Ende der Vorrunde + max(Wechselpause, Rundenpause).
2. Wellen: `ceil(Spiele / aktive Felder)`, Welle k beginnt bei Start + k · (Spielzeit + Wechselpause).
3. Welches Spiel in welche Welle: exakte Zuordnung (Ungarische Methode). Kosten sind die
   quadrierten Fehlminuten zur gewünschten Pause (`desiredRestMinutes`, Standard = eine
   Spiellänge). Wer zuletzt in der letzten Welle stand, landet so möglichst nicht in der ersten.
   Mit `evenRest` (Standard an) kommt die quadrierte Abweichung jeder Pause vom typischen Wert
   der Runde hinzu: Pausen sollen für alle Teams möglichst gleich sein, nicht möglichst lang.
   Der Durchschnitt ist durch Teams, Felder und Zeiten festgelegt (bei W Wellen setzt jedes Team
   im Schnitt W − 1 Spiele aus); optimiert wird nur die Streuung. Ein kleiner Zusatz hält Teams
   mit ähnlichem Tabellenplatz in ähnlichen Wellen, weil sie oft als Nächstes gegeneinander spielen.
4. Harte Mindestpause (`optionalHardRestMinutes`, nur wenn aktiviert): zuerst minimiert, dann
   wird der Rundenstart so weit verschoben, dass sie eingehalten ist – mit Hinweis in `warnings`.
5. Unterschrittene Wunschpausen landen als `restWarnings` mit Teamnamen beim Admin.

Blockierende Probleme (kein Feld, Rundenstart vor Ende der Vorrunde) stehen in `problems`.
