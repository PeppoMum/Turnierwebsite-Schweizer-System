# Turnier-Baukasten: fachliche Entscheidungen

Stand 29.10.2026, mit Phil abgestimmt. Ausführliche Beschreibung: Claude Doc „Funktionen: Turnier-Baukasten“
(https://claude.ai/artifact/GKJAVHkPRg3H1edkw3Pydt). Design-Entwürfe: https://claude.ai/artifact/AkATpUP7pg3aqBHWSA7bR9
(Seite „Ausgearbeitet“). Gemeinsame Typen: `src/domain/format/types.ts`, Vorlagen: `src/domain/format/templates.ts`.

## Aufbau

- Ein Turnier ist eine Kette von Abschnitten (`TournamentFormat.stages`). Schweizer System oder Liga = ein einziger
  Abschnitt ohne Weiterkommen. Bestehende Turniere ohne `format` laufen unverändert als Schweizer System.
- Abschnitte mit gleicher `phase` laufen nebeneinander (Gold, Silber, Bronze, Platzierungsspiele).
- Jeder Abschnitt nach dem ersten hat eine Einstiegsregel: feste Gruppenplätze plus „die besten N von Platz Y“.
  Wer von keiner Regel erfasst wird, ist ausgeschieden, auch wenn es mehrere Endrunden gibt
  (Beispiel 18 Teams, 4 Gruppen: Gold Platz 1+2, Silber Platz 3+4, die Fünften fahren heim).
- Die Teamzahl für einen K.-o.-Baum geht laut Phil immer auf (4, 8, 16). Kein Freilos nötig; die Anlege-Prüfung
  meldet, wenn die Regel nicht genau die Baumgröße ergibt.
- Zwischenrunde (zweite Gruppenphase) und Lostöpfe sind von Anfang an dabei.
- Schweizer System mit Endrunde danach: erst später, wenn überhaupt.

## Wertung

- Punkte immer 3 / 1 / 0, nicht einstellbar.
- Punktgleichheit, beim Anlegen wählbar:
  - Variante 1 (Standard): direkter Vergleich, Tordifferenz, mehr Tore, mehr Siege, Los.
  - Variante 2: Tordifferenz, mehr Tore, mehr Siege, direkter Vergleich, Los.
  - Direkter Vergleich bei 3+ Teams = Mini-Tabelle aus den Spielen untereinander. Los zieht die Turnierleitung.
  - Schweizer System bleibt wie heute (`docs/wertung.md`).
- Vergleich über Gruppen hinweg (beste Dritte usw.): Quotient, also Punkte pro Spiel, dann Tordifferenz pro Spiel,
  dann Tore pro Spiel.
- Zwischenrunde: Option „Punkte und Tore aus der Vorrunde mitnehmen“, Standard aus (alle starten bei 0).
  Neue Gruppen werden über Kreuz gebildet (Gruppe E: 1. A, 2. B, 1. C, 2. D; Gruppe F: 1. B, 2. A, 1. D, 2. C),
  damit Teams aus derselben Vorrunden-Gruppe nicht wieder zusammen sind. Danach von Hand tauschbar.

## Endrunde

- Formen: K.-o., K.-o. mit Spiel um Platz 3 (Standard), K.-o. mit allen Plätzen, Finalgruppe, einzelne
  Platzierungsspiele, keine Endrunde.
- Paarungen: über Kreuz (1. A gegen 2. B, 1. B gegen 2. A; bei 2 Gruppen mit je 4 Weiterkommenden 1. A gegen 4. B,
  2. A gegen 3. B …). Teams aus derselben Gruppe kommen in verschiedene Baumhälften, damit sie sich so spät wie
  möglich (am besten erst im Finale) wieder treffen. Mit besten Dritten oder aus einer einzigen Tabelle:
  Setzliste, Bester gegen Schwächsten, gleiche Hälften-Regel. Danach von Hand tauschbar.
- Unentschieden: Standard Neunmeterschießen, wahlweise erst Verlängerung. Anzeige „1:1, 4:3 n. N.“ bzw.
  „2:1 n. V.“. Einzelne Spiele (z. B. Spiel um Platz 3) können reine Neunmeterschießen sein.
- Endrunde füllen: Vorschau „nach jetzigem Stand“ für alle sichtbar, deutlich als „Stand jetzt, noch nicht fest“
  markiert. Feste Plätze einer Gruppe werden eingetragen, sobald diese Gruppe fertig ist; Plätze aus dem
  Gruppenvergleich, sobald alle Gruppen fertig sind. Hinweis an die Turnierleitung, danach tauschbar.
- Nicht ausgespielte Plätze werden geteilt („5.–8.“). Ausgeschiedene stehen ohne Platz unter „Ausgeschieden“.

## Ändern und korrigieren

- Nur Veranstalter und Mit-Veranstalter (wer das Turnier verwaltet) dürfen tauschen: zwei Spiele (Uhrzeit und
  Feld), Gegner zwischen zwei noch nicht angepfiffenen Spielen, Feld, Uhrzeit, alles verschieben, Team in andere
  Gruppe vor dem ersten Spiel. Helfer tragen nur Ergebnisse ein.
- Warnungen statt Verbote (Team doppelt gleichzeitig, keine Pause). Laufende/beendete Spiele nicht verschiebbar.
  Handänderungen überleben Neuberechnungen. Alles im Verlauf, rückgängig machbar.
- Ergebnisse jederzeit korrigierbar. Ändert eine Korrektur, wer weiterkommt, und das betroffene Endrunden-Spiel
  ist noch nicht angepfiffen: Seite zeigt die Änderung, Turnierleitung bestätigt. Läuft es schon oder ist es
  vorbei: Endrunde bleibt, wie sie ist („gespielt ist gespielt“).
- Zurückgezogenes Team in der Gruppe: Regel von heute (alle seine Spiele zählen für niemanden). Qualifiziertes
  Team zieht vor seinem Endrunden-Spiel zurück: Turnierleitung wählt im Moment „Gegner kampflos weiter“ oder
  „Nächstbester rückt nach“.
- Haken „ist da“ je Team (Teams-Reiter, nur Turnierleitung, im Verlauf). Rückt ein Spiel nach vorne und ein
  Team ohne Haken spielt dadurch früher als sein erstes geplantes Spiel: nur Hinweis „vielleicht noch nicht da“.
- Ausfall in der Gruppenphase: Hinweis „Plan straffen“ mit Vorschau (Spiele, alte und neue Endzeit). Spätere
  Spiele rücken in die Lücken, Teams mit „ist da“ zuerst; wenn möglich ein Spiel Pause, Pausen nie extra
  eingebaut (kürzere Pause nur, wenn das Turnier dadurch früher fertig wird). Spätere Phasen rücken mit nach vorne.
  Handänderungen und angepfiffene Spiele bleiben. Fehlt dadurch einer Endrunde ein Team, sagt die Seite das und
  führt zum Anpassen (Dreiergruppe oder streichen).
- „Dreiergruppe spielt länger“ (Haken im Straffen-Fenster, standardmäßig aus): nur wenn jedes offene Spiel der
  Gruppe in die frei gewordene Zeit auf seinem Feld passt; Vorschlag 1,5-fache Spielzeit. Takt und Pausen aller
  anderen bleiben, Wertung unverändert. Längere Spielzeit steht im Spielplan, bei Helfern und Zuschauern.
- Team kommt zu spät (Knopf „Team fehlt“ an jedem noch nicht beendeten Gruppenspiel, nur Turnierleitung):
  entweder „Spiel nach hinten tauschen“ (Vorschläge: spätere, noch nicht angepfiffene Spiele derselben Gruppe
  ohne das späte Team; nie ein Team zweimal gleichzeitig; Hinweis, wenn ein Team dadurch vor seinem bisher ersten
  Spiel dran ist; src/domain/schedule/late.ts) oder „Kampflos werten“: 2:0 für den Gegner, das Team bleibt im
  Turnier, zählt in der Tabelle wie ein normales Ergebnis (Entscheidung Phil, 29.10.2026). Gespeichert als
  beendetes Spiel mit Toren und `decidedBy: 'walkover'`/`walkoverWinner` (src/domain/groups/walkover.ts),
  Anzeige „2:0 (kampflos)“. „Korrigieren“ setzt es auf „geplant“ zurück; beides im Verlauf rückgängig machbar.

## Zuschauerseite

- Gruppen und Spielplan erst sichtbar, wenn die Turnierleitung auf „Veröffentlichen“ drückt.
- „Mein Team“: Auswahl wird pro Turnier auf dem Gerät gemerkt, ohne Anmeldung.
- Der schwarz-blau-weiß-rote Streifen entfällt überall.

## Vorlagen

8 Teams (2 Gruppen, Halbfinale, Platz 3, Platzierungsspiele 5 und 7), 10 Teams (wie 8, dazu Platz 9),
12 Teams (3 Gruppen, Viertelfinale mit 2 besten Dritten), 16 Teams (4 Gruppen, Gold Platz 1+2, Silber Platz 3+4),
20 Teams (wie 16, Fünfte ausgeschieden). Am häufigsten mit Endrunde: 10, 16, 20.
