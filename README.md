# Turnierwebsite Schweizer System

Live-Turnierplattform für Fußballturniere im angepassten Schweizer System: Paarungen nach Punktequotient, Spielplan mit Feldern und Wellen, Live-Ergebnisse für Zuschauer ohne Konto.

Status: im Aufbau (Phase 0).

## Stack

React + TypeScript + Vite, Firebase (Auth + Firestore), Vitest, Playwright, Hosting über GitHub Pages.

## Lokal starten

```bash
npm install
cp .env.example .env.local   # Standard: lokale Firebase-Emulatoren
npm run dev
```

Firebase-Emulatoren (die Firebase CLI ist als Dev-Abhängigkeit dabei; benötigt Java 21):

```bash
npm run emulators
```

Das Projekt `demo-turnier` ist ein Emulator-Projekt und braucht kein echtes Firebase-Konto.

## Befehle

| Befehl | Zweck |
|---|---|
| `npm run dev` | Entwicklungsserver |
| `npm run build` | Produktions-Build nach `dist/` |
| `npm test` | Unit- und Property-Tests (Vitest) |
| `npm run test:rules` | Sicherheitsregeln und Datenschicht gegen den Firestore-Emulator |
| `npm run test:e2e` | End-to-End-Tests (Playwright) |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript-Prüfung |

## Ordnerstruktur

```
src/
  domain/          reine, getestete Fachlogik ohne Firebase/React
    types.ts       Datenmodell (Spezifikation §5)
    scoring/       Tabelle, Quotient, Feinwertungen (§6)
    pairing/       Auslosung und Schweizer Paarungen (§7)
    schedule/      Feld- und Wellenplanung (§8)
  data/            Firestore-Zugriff: Layout, öffentliche Projektionen, Schreibvorgänge, Live-Abos
  ui/              React-Oberfläche
firebase/          Firestore-Regeln, Indexe, Regeltests, Einrichtungsanleitung (firebase/README.md)
e2e/               Playwright-Tests
```

## Deployment

Jeder Push auf `main` baut die App und veröffentlicht sie auf GitHub Pages. Dafür einmalig unter *Settings → Pages* als Quelle „GitHub Actions“ wählen. Die Firebase-Webkonfiguration kommt aus Repository-Variablen (`VITE_FIREBASE_*`).
