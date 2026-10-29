# Firebase: Datenmodell, Sicherheitsregeln, Einrichtung

Dieses Verzeichnis enthält die Firestore-Sicherheitsregeln (`firestore.rules`), die Index-Einstellungen
(`firestore.indexes.json`) und die Regeltests (`tests/`). Der Datenzugriff der App liegt in `src/data/`.

Betrieb ausschließlich im **Spark-Tarif** (kostenlos): kein Cloud Storage, keine Cloud Functions. Hosting
über GitHub Pages.

## Collection-Layout (Spezifikation §5)

| Pfad | Inhalt | Lesen | Schreiben |
|---|---|---|---|
| `tournaments/{tid}` | Turnierkonfiguration, `revision`, `resultsRevision` | Mitglieder | Owner (Konfiguration), Mitglieder außer Schiris (nur `resultsRevision`+1) |
| `…/teams`, `/fields`, `/sponsors`, `/byes` | Stammdaten, Freilose | Mitglieder | Owner |
| `…/rounds/{round-NN}` | Runde inkl. `matchIds`, `byeTeamIds`, `generatedFromRevision` | Mitglieder | Owner; erweiterte Helfer mit Freigaberecht nur `preview → published` |
| `…/matches/{id}` | Spiel inkl. Tore, `revision`, `lastAuditId` | Mitglieder | Owner; Helfer nur Score/Status |
| `…/audit/{id}` | Änderungsprotokoll | Owner | Mitglieder außer Schiris (nur anlegen, nie ändern/löschen) |
| `…/roleGrants/{uid}` | Rolle je uid + Turnier | Owner, die Person selbst | Owner; Einlösung einer Einladung; Helfer- oder Schiri-Link ohne Anmeldung |
| `…/invitations/{id}` | Helfer-Einladungen | Owner (Liste), angemeldete Person mit Link (einzeln) | Owner; Einlösung |
| `…/assets/{id}` | kleine Bilder (Data-URL) | Mitglieder | Owner |
| `…/stages/{stageId}` | Baukasten: Gruppeneinteilung, Lostöpfe, gezogene Lose | Mitglieder | Owner |
| `…/referees/{uid}` | Schiris (Name), nie öffentlich | Mitglieder | Owner; Schiri nur das eigene Dokument |
| `…/refereeing/{matchId}` | wer pfeift, gemeldetes Ergebnis; nie öffentlich | Mitglieder | Owner, Schiris |
| `publicTournaments/{tid}` | öffentliche Stammdaten, Teams alphabetisch, Felder, Sponsoren | alle, wenn `isPublic` | Owner |
| `…/publicRounds`, `/publicMatches` | freigegebene Runden und Paarungen, **ohne Tore** | alle, wenn `isPublic` | Owner, Freigabeberechtigte; Helfer spiegeln nur den Status |
| `…/publicResults/{matchId}` | Tore | alle, wenn `isPublic` **und** Modus `full`/`no_standings` | Owner; Helfer exakt gespiegelt |
| `…/publicStandings/current` | Tabelle | alle, wenn `isPublic` **und** Modus `full` | Mitglieder außer Schiris, nur im Modus `full` |
| `…/publicAssets/{id}` | öffentliche Bilder | alle, wenn `isPublic` | Owner |
| `…/publicStages/{stageId}` | Baukasten: Gruppeneinteilung; Lose nur im Modus `full` | alle, wenn `isPublic` | Owner |
| `users/{uid}/tournamentRefs/{tid}` | Turniere eines Kontos (Dashboard) | die Person selbst | die Person selbst, nur mit gültiger Rolle |

## Rollen (Spezifikation §3)

| | Gast | Ergebnis-Helfer | Erweiterter Helfer | Owner |
|---|---|---|---|---|
| Öffentliche Seite | je Modus | ja | ja | ja |
| Interne Daten lesen | nein | ja | ja | ja (inkl. Audit) |
| Anpfiff, Zwischen-/Endstand, „nicht ausgetragen“ | nein | ja, optional nur auf bestimmten Feldern | ja | ja |
| Beendetes Spiel korrigieren | nein | nein | ja | ja |
| Runde freigeben | nein | nein | nur mit `canPublishRounds` | ja |
| Stammdaten, Regeln, Sichtbarkeit | nein | nein | nein | ja |
| Helfer einladen/entziehen | nein | nein | nein | ja |

Wer schreibt, braucht ein echtes Konto (E-Mail/Passwort oder Google). Anonyme Logins dürfen nichts schreiben.

## Kinderfußballmodus: technische Sperre

Tore stehen nie in `publicMatches`. Ergebnisse und Tabelle liegen in eigenen Collections, deren
Leserecht an den Sichtbarkeitsmodus des öffentlichen Turnierdokuments gebunden ist:

- Im Modus `kids` lehnen die Regeln jeden Lesezugriff auf `publicResults` und `publicStandings` ab,
  auch auf zurückgebliebene Altdokumente, und verbieten das Anlegen neuer.
- `setVisibility` löscht beim Wechsel nach `kids` alle Ergebnis- und Tabellendokumente in derselben
  Transaktion und legt sie beim Zurückwechseln neu an.
- Die öffentliche Sichtbarkeit muss nach jedem Schreibvorgang der privaten entsprechen (Regel prüft
  `getAfter`), beide können nicht auseinanderlaufen.
- Die Teamliste ist alphabetisch sortiert, damit die Reihenfolge den Tabellenstand nicht verrät.

## Konsistenz und gleichzeitige Bearbeitung (§10.3)

- **Spiele:** Jede Änderung setzt `revision` auf genau `alt + 1` (von den Regeln erzwungen). Die
  Datenschicht vergleicht in einer Transaktion die erwartete Revision und wirft sonst
  `RevisionConflictError` mit dem aktuellen Stand für den Konfliktdialog. Damit gewinnt nie „der letzte
  Schreibvorgang“.
- **Audit:** Jede Spieländerung verweist über `lastAuditId` auf einen Audit-Eintrag aus demselben
  Request und vom selben Akteur; ohne ihn lehnen die Regeln ab.
- **Paarungsbasis:** Jede ergebnisrelevante Änderung zählt `tournament.resultsRevision` hoch (von den
  Regeln erzwungen). Eine Schweizer Runde speichert `generatedFromRevision`; `publishRound` verweigert
  die Freigabe, wenn sich seitdem Ergebnisse geändert haben (außer mit `allowStaleBasis`).
- **Rundenfreigabe:** atomar in einer Transaktion. Runde muss `preview` sein, die Vorrunde (bei
  Schweizer Runden) `closed`, alle Spiele `draft`. Bei zwei gleichzeitigen Freigaben gewinnt genau eine.
- **Konfiguration:** `updateTournamentConfig` und `setVisibility` prüfen `tournament.revision`.
- Spielregeln aus §9 stehen zusätzlich in den Regeln: `completed` nur mit zwei ganzzahligen Toren
  0–99, `not_played` nie mit Toren und immer mit Grund, Paarungen freigegebener Spiele unveränderlich.

## Rückgängig im Verlauf

Der Owner kann im Verlauf einzelne Schritte zurücknehmen (Regeln in `src/ui/data/undo.ts`). Rückgängig ist
immer ein **neuer** Schreibvorgang mit eigenem Audit-Eintrag, der in `after.undoOf` auf den zurückgenommenen
Eintrag verweist; das Protokoll selbst bleibt unveränderlich. Es braucht keine Regeländerung: alle Schritte
laufen über die bestehenden Owner-Rechte (Spiel `match.undo`, `team.restore` mit wieder geplanten Spielen,
`round.reopen` als `closed → active` usw.).

- Je Sache (ein Spiel, Status einer Mannschaft, Sichtbarkeit, …) lässt sich nur der neueste Eintrag
  zurücknehmen, und nur, solange der aktuelle Stand noch dem `after` des Eintrags entspricht.
- Ausgeloste Runden bleiben unverändert. Ein zurückgenommenes Ergebnis wirkt wie eine Korrektur: die Tabelle
  ändert sich, bereits ausgeloste Paarungen nicht (das Fenster weist darauf hin).
- Rückzüge speichern die ausgefallenen Spiele in `after.matchIds`, damit die Rücknahme genau diese wieder
  plant (ältere Einträge: Schätzung über `notPlayedReason`).

## Turnier-Baukasten (Gruppen, Endrunden)

Fachliche Regeln: `docs/turnier-baukasten.md`. Turniere ohne `format` sind Schweizer System wie bisher;
für sie ändert sich nichts, und sie laufen auch mit den älteren Schutzregeln weiter.

- **Ablauf** steht als `format` am Turnier und in der öffentlichen Projektion.
- **Spiele** tragen die Felder aus `StageMatchFields` (`stageId`, `groupIndex`, `matchKey`, `slotA/B`,
  `penaltyOnly`, `decidedBy`, `penaltiesA/B`, `walkoverWinner`) und `manual`. Platzhalter-Spiele haben
  `teamAId == teamBId == ''`, bis die Endrunde gefüllt ist. `roundId` ist `<tid>-<stageId>`,
  `roundNumber` ist `phase + 1`; es gibt dafür keine Runden-Dokumente.
- **Gruppen und Lose** liegen je Abschnitt in `stages/{stageId}`. Firestore kennt keine Listen in Listen,
  deshalb `groups: [{ teamIds }]` (auch im Audit).
- **Schreiben**: Spielplan speichern, tauschen, verschieben, Endrunde füllen und kampflos werten laufen
  über `commitMatchChanges` (src/data/stages.ts): eine Transaktion, erwartete Revision je Spiel, ein
  Audit-Eintrag am Turnier mit `before/after.matches` (Stand von Ort, Zeit, Teams je Spiel) für Rückgängig.
  Was erlaubt ist, prüft vorher `src/ui/data/stages.ts` (gemeinsam mit dem mockStore).
- **Zuschauer** sehen erst nach `publishTournament` etwas (`isPublic`). Die Tabelle rechnet die Seite selbst
  aus Ergebnissen und Gruppen; `publicStandings` bleibt bei Baukasten-Turnieren leer.

Schutzregeln dazu:

- Teams und Platzhalter eines noch nicht angepfiffenen Baukasten-Spiels darf nur der Owner ändern
  (`openStageMatchRepaired`), ebenso solche Spiele löschen (neuer Spielplan). Angepfiffene bleiben.
- Helfer tragen nur Ergebnisse ein, auch Verlängerung/Neunmeter (`decidedBy`, `penaltiesA/B`), und nur,
  wenn beide Teams feststehen. Öffentlich spiegeln sie `decidedBy`/`walkoverWinner` exakt.
- Neunmeter-Treffer nur bei beendetem, per Neunmeterschießen entschiedenem Spiel nach Unentschieden mit
  Sieger (`penaltiesOk`). Öffentlich stehen sie wie die Tore in `publicResults` (nicht im Kindermodus).
- Lose verraten die Tabellenreihenfolge: in `publicStages` nur im Modus `full`; `setVisibility` zieht das nach.

## Helfer-Einladungen (§2.3 Punkt 6)

1. Owner erzeugt eine Einladung (`createHelperInvitation`) mit Rolle, optional Feldern und Ablauf
   (Standard 72 h, höchstens 30 Tage). Link: `…/#/einladung/{tid}/{inviteId}`.
2. Die eingeladene Person öffnet den Link und meldet sich mit eigenem Konto an.
3. `redeemInvitation` legt in einer Transaktion den Grant für genau diese uid an und markiert die
   Einladung als verbraucht. Die Regeln prüfen: nicht verbraucht, nicht widerrufen, nicht abgelaufen,
   Rolle/Felder/Rechte exakt wie eingeladen.
4. Der Owner sieht im Grant, welche E-Mail eingelöst hat, und kann mit `revokeHelper` sofort entziehen.

Der Link ist damit eine Referenz, keine Schreibberechtigung: ohne Login nutzlos, nach dem ersten
Einlösen verbraucht.

## Helferlink ohne Anmeldung (optional je Turnier)

Für Turniere, bei denen Helfer kein Konto anlegen sollen. Voraussetzung: In Firebase unter
Authentication → Anmeldemethode ist der Anbieter **Anonym** aktiviert.

1. Owner schaltet den Link in den Einstellungen ein. Das setzt `tournament.openHelperLinkId` auf eine
   Zufalls-ID (24 Zeichen, `newOpenHelperLinkId`). Link: `…/#/helfer/{tid}/{openHelperLinkId}`.
2. Wer den Link öffnet, wird anonym angemeldet; `joinWithOpenHelperLink` legt den Grant
   `results_helper` (alle Felder, kein Ablauf) mit `openLinkId` an. Die Regeln erlauben das nur
   anonymen Logins und nur mit genau der aktuellen ID des Turniers (`openLinkGrant`).
3. Link-Grants gelten nur, solange `openLinkId == tournament.openHelperLinkId` (`myRole`). Ausschalten
   (`null`) oder „Neuen Link erzeugen“ sperrt sofort alle bisherigen Link-Helfer; mit dem neuen Link
   stellt ein Helfer seinen Grant selbst auf die neue ID um.
4. Konten mit Rolle (z. B. die Turnierleitung) behalten ihre Rolle; Konten ohne Rolle bekommen über den
   Link keine (sie müssten sich abmelden).

Wer den Link kennt, kann Ergebnisse eintragen – das ist der bewusste Tausch gegen das Passwort. Korrekturen
beendeter Spiele, Runden und Stammdaten bleiben beim Owner bzw. erweiterten Helfern.

## Schiri-Link ohne Anmeldung (optional je Turnier)

Funktioniert wie der Helferlink, mit eigener ID `tournament.openRefereeLinkId` (Link
`…/#/schiri/{tid}/{openRefereeLinkId}`) und der Rolle `referee` (`joinWithOpenRefereeLink`). Welche ID ein
Link-Grant braucht, hängt an seiner Rolle (`linkFieldFor`); beide Links lassen sich getrennt schalten.

Schiris lesen alles wie Mitglieder, schreiben aber nur `referees/{eigene uid}` (Name) und
`refereeing/{matchId}` (Einteilung, gemeldetes Ergebnis). Spiele, Tabelle, Turnier und Verlauf ändern
sie nie (`isWriter` schließt sie aus). Ein gemeldetes Ergebnis zählt erst, wenn die Turnierleitung es
übernimmt; das läuft dann über den normalen Ergebnisweg (`recordResult`) und steht im Verlauf.

Hinweis zu den Regeln: Firestore wertet je Anfrage höchstens 1000 Ausdrücke aus. Die Spielregel ist nahe
an dieser Grenze; deshalb berechnet `myRole` die Rolle einmal und `matchChangeAllowed` bekommt sie als
Parameter, statt mehrfach `isOwner`/`isHelper` aufzurufen.

## Bilder (§10.2)

Bilder werden im Browser verkleinert (max. 512 px) und komprimiert (`compressImage`), dann als Data-URL
in eigenen Dokumenten gespeichert. Grenzen, im Code und in den Regeln identisch:

- max. 40 KiB Binärdaten, max. 55 000 Zeichen Data-URL, max. 1024 px Kantenlänge,
- nur PNG, JPEG, WebP (kein SVG wegen Skript-Risiko),
- max. 50 Bilder je Turnier (clientseitig geprüft).

`dataUrl` ist von der Indexierung ausgenommen (`firestore.indexes.json`).

## Vertrauensgrenze im Spark-Tarif

Ohne Backend erzeugen die Browser der Turnierleitung die öffentlichen Projektionen. Die Regeln sichern
ab, was ohne Backend prüfbar ist:

- Helfer können öffentliche Spiel- und Ergebnisdokumente nur exakt auf den privaten Stand nach ihrem
  eigenen, regelkonformen Schreibvorgang setzen.
- Owner sind vertrauenswürdig: ihre Projektionen werden auf Form und Sichtbarkeit geprüft, nicht
  Feld für Feld gegen die privaten Daten (das würde die Grenze von 20 Dokumentabfragen pro
  Schreibvorgang sprengen).
- Die öffentliche Tabelle (`publicStandings/current`) wird von Mitgliedern berechnet und geschrieben;
  die Regeln prüfen nur Form, Größe und Modus. Ein böswilliger Helfer könnte also eine falsche Tabelle
  veröffentlichen (die echten Ergebnisse bleiben unberührt, die nächste korrekte Eingabe überschreibt sie).

**Ausbaupfad:** eine Cloud Function, die Projektionen und Tabelle serverseitig aus den privaten Daten
erzeugt. Setzt den Blaze-Tarif (Abrechnung) voraus und ist deshalb bewusst nicht umgesetzt.

## Lokale Entwicklung mit dem Emulator

Voraussetzungen: Node 22, Java 21. Kein Firebase-Konto nötig, das Projekt `demo-turnier` existiert nur
lokal.

```bash
npm install
cp .env.example .env.local     # VITE_USE_FIREBASE_EMULATOR=true
npm run emulators              # Auth :9099, Firestore :8080, Oberfläche :4000
npm run dev                    # in einem zweiten Terminal
npm run test:rules             # Regel- und Integrationstests (startet den Emulator selbst)
```

## Echtes Firebase-Projekt einrichten (wenn es so weit ist)

1. <https://console.firebase.google.com> → **Projekt hinzufügen**, Name z. B. `turnier-schweizer-system`.
   Google Analytics ist nicht nötig. Tarif bleibt **Spark**.
2. **Authentication** → *Jetzt starten* → Anbieter **E-Mail/Passwort** und **Google** aktivieren.
   Unter *Einstellungen → Autorisierte Domains* `peppomum.github.io` hinzufügen.
3. **Firestore Database** → *Datenbank erstellen* → Standard-Edition, Standort `eur3 (Europa)` oder
   `europe-west3 (Frankfurt)`, im **Produktionsmodus** starten (alles gesperrt, bis die Regeln
   hochgeladen sind).
4. **Projekteinstellungen → Allgemein → Deine Apps → Web-App hinzufügen** (`</>`). Die angezeigten
   Werte (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`) eintragen:
   - lokal in `.env.local` (Vorlage `.env.example`), dazu `VITE_USE_FIREBASE_EMULATOR=false`,
   - für GitHub Pages stehen die Werte des Projekts `turnierwebsite-swiss-system` direkt in
     `.github/workflows/deploy.yml` (dazu `VITE_DATA_SOURCE=firebase`). Repository-Variablen gleichen Namens
     (*Settings → Secrets and variables → Actions → Variables*) überschreiben sie.
   Diese Werte sind keine Geheimnisse; der Schutz kommt aus den Regeln.
5. Regeln hochladen: entweder in der Konsole unter *Firestore → Regeln* den Inhalt von `firestore.rules`
   einfügen und *Veröffentlichen*, oder per CLI (lädt zusätzlich die Index-Ausnahmen hoch):

   ```bash
   npx firebase login
   npx firebase deploy --only firestore --project <projekt-id>
   ```

6. Optional: in der Google-Cloud-Konsole den API-Schlüssel auf die Domains `peppomum.github.io` und
   `localhost` beschränken.

## Offene Punkte

- Tabellenberechnung (inkl. Rückzugsregel) kommt aus `src/domain`; die Datenschicht nimmt die fertigen
  Zeilen entgegen (`standingsAfter`, `setVisibility(..., { standings })`, `publishStandings`).
- Neuplanung einzelner Paarungen nach einem Rückzug (§9) ist noch nicht gebaut; Rückzug
  (`withdrawTeam`), Zeitverschiebung (`shiftFutureMatches`) und Statuswechsel sind da.
  Audit-Einträge für Sammeländerungen nutzen `targetType: 'tournament'` oder `'round'`.
- Grenze von 500 Schreibvorgängen je Transaktion: `setVisibility` reicht bis ca. 450 Spiele je Turnier.
