# Mitwirken an pBlock

Danke für dein Interesse. Dieses Dokument beschreibt, wie man mitarbeitet — und
welche Erwartungen an einen Beitrag geknüpft sind.

## Schnellstart

```bash
git clone https://github.com/philppplik/pBlock.git
cd pBlock
npm install
npm run build
```

Anschließend in Chrome:

1. `chrome://extensions` öffnen
2. Entwicklermodus einschalten (Schalter oben rechts)
3. „Entpackte Erweiterung laden“ und den Ordner **`dist/`** auswählen

Während der Entwicklung:

```bash
npm run build:watch   # baut bei jeder Änderung neu
npm run test:watch    # führt Tests bei jeder Änderung aus
```

Nach einem Neubau muss die Erweiterung unter `chrome://extensions` neu geladen
werden (Kreispfeil-Symbol). Content-Scripts greifen erst nach einem Neuladen der
betroffenen Seite.

## Vor dem Pull Request

```bash
npm run verify
```

Das führt nacheinander aus: Lint, Formatprüfung, Tests mit Coverage-Schwelle,
Build und Manifest-Prüfung. Was hier durchläuft, läuft auch in der CI durch.

## Woran ein Beitrag gemessen wird

### 1. Logik gehört nach `src/core/`

Alles, was sich ohne Browser testen lässt, gehört dorthin. Diese Module dürfen
weder auf `chrome` noch auf das DOM zugreifen — eine ESLint-Regel setzt das durch.

Der Grund ist handfest: In Version 4 war die gesamte Regel-, Statistik- und
Einstellungslogik direkt mit `chrome.storage` verwoben. Getestet werden konnte
davon nichts, und genau dort saßen die meisten Fehler.

### 2. Neue Logik braucht Tests

Für `src/core/` gilt eine Coverage-Schwelle von 80 %. Wichtiger als die Zahl ist
aber: **Wer einen Fehler behebt, schreibt zuerst einen Test, der ihn nachweist.**
Die vorhandenen Regressionstests sind als Beispiel markiert — sie beginnen mit
einem Kommentar, der beschreibt, was v4 falsch gemacht hat.

Die Oberfläche und die Browser-Integration sind nicht automatisiert getestet.
Dafür gibt es die Checkliste in [`docs/qualitaetssicherung.md`](docs/qualitaetssicherung.md).

### 3. Kommentare erklären das Warum

Was der Code tut, steht im Code. Kommentare sind für das, was man ihm nicht
ansieht: warum eine Grenze bei genau diesem Wert liegt, warum ein naheliegender
Weg nicht funktioniert, welcher Fehler eine Stelle so aussehen lässt.

### 4. Berechtigungen sind teuer

Jede zusätzliche Berechtigung im Manifest bedeutet eine strengere Prüfung im Web
Store, eine abschreckendere Warnung bei der Installation und mehr möglichen
Schaden im Fehlerfall. Ein Pull Request, der eine Berechtigung hinzufügt, muss im
Text begründen, warum es ohne sie nicht geht.

### 5. Filter, die Seiten beschädigen, sind schlimmer als fehlende Filter

Eine durchgerutschte Anzeige ärgert. Eine kaputte Bezahlseite kostet Vertrauen.
Im Zweifel lieber nicht blockieren. Konkrete Beispiele stehen in
[`docs/filter.md`](docs/filter.md).

## Aufbau des Projekts

```
src/
  core/         Plattformneutrale Logik. Kein chrome, kein DOM. Vollständig getestet.
  background/   Service Worker. Verbindet core mit den Chrome-APIs.
  content/      Content-Scripts. Laufen auf jeder besuchten Seite.
  ui/           Popup, Einstellungen, Einrichtung.
  manifest.json Wird beim Build nach dist/ kopiert.

tests/          Vitest-Tests zu src/core/
scripts/        Build, Manifest-Prüfung, Paketierung
website/        Projektseite, veröffentlicht über GitHub Pages
docs/           Ausführliche Dokumentation
```

Details in [`docs/architektur.md`](docs/architektur.md).

## Commit-Nachrichten

Conventional Commits, Beschreibung auf Deutsch:

```
<typ>(<bereich>): <was sich ändert>

<warum es sich ändert; welches Problem gelöst wird>
```

Typen: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`, `build`

Beispiele:

```
fix(core): Whitelist matchte über Label-Grenzen hinweg
feat(ui): Diagnosebereich mit Selbsttest ergänzt
refactor(background): Nachrichtenverarbeitung von switch auf Tabelle umgestellt
```

Die Zeile allein soll verständlich sein, ohne den Diff zu öffnen.

## Branches

- `main` ist immer lauffähig und veröffentlichbar.
- Es wird in einem Branch gearbeitet: `fix/…`, `feat/…`, `docs/…`, `refactor/…`
- Pull Requests brauchen eine grüne CI.

## Filter melden statt selbst ergänzen

Wer eine Domain gefunden hat, die blockiert werden sollte, eröffnet bitte ein
Issue statt eines Pull Requests an `src/core/rule-registry.js`. Jede Aufnahme wird
gegen das Risiko abgewogen, legitime Funktionen zu beschädigen — das lässt sich in
einer Diskussion besser klären als in einem Diff.

Für breite Abdeckung sind ohnehin die zuschaltbaren Filterlisten der richtige Ort.
Die mitgelieferte Registry deckt bewusst nur die verbreitetsten Fälle ab.

## Miteinander

Es gilt der [Verhaltenskodex](CODE_OF_CONDUCT.md). Kurzfassung: sachlich bleiben,
davon ausgehen, dass die Gegenseite es gut meint, und niemanden für eine Frage
abkanzeln.

## Lizenz

Mit einem Beitrag stimmst du zu, dass er unter der [MIT-Lizenz](LICENSE)
veröffentlicht wird.
