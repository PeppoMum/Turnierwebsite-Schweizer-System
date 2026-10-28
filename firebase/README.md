# Firebase: Datenmodell, Sicherheitsregeln, Einrichtung

Dieses Verzeichnis enthält die Firestore-Sicherheitsregeln (`firestore.rules`), die Index-Einstellungen
(`firestore.indexes.json`) und die Regeltests (`tests/`). Der Datenzugriff der App liegt in `src/data/`.

Betrieb ausschließlich im **Spark-Tarif** (kostenlos): kein Cloud Storage, keine Cloud Functions. Hosting
über GitHub Pages.

## Collection-Layout (Spezifikation §5)

| Pfad | Inhalt | Lesen | Schreiben |
|---|---|---|---|
| `tournaments/{tid}` | Turnierkonfiguration, `revision`, `resultsRevision` | Mitglieder | Owner (Konfiguration), Mitglieder (nur `resultsRevision`+1) |
| `…/teams`, `/fields`, `/sponsors`, `/byes` | Stammdaten, Freilose | Mitglieder | Owner |
| `…/rounds/{round-NN}` | Runde inkl. `matchIds`, `byeTeamIds`, `generatedFromRevision` | Mitglieder | Owner; erweiterte Helfer mit Freigaberecht nur `preview → published` |
| `…/matches/{id}` | Spiel inkl. Tore, `revision`, `lastAuditId` | Mitglieder | Owner; Helfer nur Score/Status |
| `…/audit/{id}` | Änderungsprotokoll | Owner | Mitglieder (nur anlegen, nie ändern/löschen) |
| `…/roleGrants/{uid}` | Rolle je uid + Turnier | Owner, die Person selbst | Owner; Einlösung einer Einladung; Helferlink ohne Anmeldung |
| `…/invitations/{id}` | Helfer-Einladungen | Owner (Liste), angemeldete Person mit Link (einzeln) | Owner; Einlösung |
| `…/assets/{id}` | kleine Bilder (Data-URL) | Mitglieder | Owner |
| `publicTournaments/{tid}` | öffentliche Stammdaten, Teams alphabetisch, Felder, Sponsoren | alle, wenn `isPublic` | Owner |
| `…/publicRounds`, `/publicMatches` | freigegebene Runden und Paarungen, **ohne Tore** | alle, wenn `isPublic` | Owner, Freigabeberechtigte; Helfer spiegeln nur den Status |
| `…/publicResults/{matchId}` | Tore | alle, wenn `isPublic` **und** Modus `full`/`no_standings` | Owner; Helfer exakt gespiegelt |
| `…/publicStandings/current` | Tabelle | alle, wenn `isPublic` **und** Modus `full` | Mitglieder, nur im Modus `full` |
| `…/publicAssets/{id}` | öffentliche Bilder | alle, wenn `isPublic` | Owner |
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
