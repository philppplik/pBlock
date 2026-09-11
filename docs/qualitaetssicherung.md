# Qualitätssicherung

## Was automatisiert geprüft wird

`npm run verify` führt alles aus, was auch in der CI läuft:

| Schritt             | Prüft                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `lint`              | ESLint — unter anderem, dass `src/core/` frei von `chrome`/DOM bleibt und nirgends `eval` steht |
| `format:check`      | Prettier                                                                                        |
| `test`              | 289 Unit-Tests auf `src/core/`                                                                  |
| `build`             | esbuild-Bündelung aller Einstiegspunkte                                                         |
| `validate:manifest` | Store-Anforderungen und das gebaute Paket                                                       |

### Testabdeckung

Schwelle: 80 %. Aktuell:

| Modul                | Statements | Branches |
| -------------------- | ---------- | -------- |
| `constants.js`       | 100 %      | 100 %    |
| `cosmetic-rules.js`  | 100 %      | 96 %     |
| `domain.js`          | 100 %      | 97 %     |
| `filter-parser.js`   | 98 %       | 90 %     |
| `logger.js`          | 99 %       | 82 %     |
| `presets.js`         | 99 %       | 91 %     |
| `rule-engine.js`     | 100 %      | 88 %     |
| `rule-registry.js`   | 100 %      | 100 %    |
| `settings-schema.js` | 100 %      | 100 %    |
| `settings.js`        | 99 %       | 88 %     |
| `site-stats.js`      | 100 %      | 88 %     |
| `statistics.js`      | 98 %       | 87 %     |
| `time.js`            | 100 %      | 91 %     |

### Was der Manifest-Validator verhindert

Jede Prüfung dort geht auf einen realen Fehler oder einen Ablehnungsgrund des
Chrome Web Store zurück:

- `manifest_version` ist 3
- Version in Manifest und `package.json` stimmen überein _(in v4 wichen
  Manifest 4.0.0 und README-Badge 3.0.2 voneinander ab)_
- `description` überschreitet 132 Zeichen nicht
- `declarativeNetRequestFeedback` ist deklariert _(fehlte in v4, wodurch die
  Trefferzählung dauerhaft scheiterte)_
- `alarms` ist deklariert _(im Service Worker gibt es kein `setInterval`)_
- Jedes Content-Script benennt seine Welt ausdrücklich
- `minimum_chrome_version` ≥ 111, wenn `world: MAIN` verwendet wird
- Alle referenzierten Dateien existieren im Paket
- Die CSP enthält weder `unsafe-eval` noch `unsafe-inline`
- **Kein `eval(`, kein `new Function(`, kein `setTimeout` mit String** in den
  gebündelten Dateien _(v4 führte Skript-Quelltext per `eval` aus)_
- Warnung bei Berechtigungen, die eine strengere Store-Prüfung auslösen

## Was manuell geprüft werden muss

Oberfläche und Browser-Integration sind nicht automatisiert getestet. Diese
Checkliste ist vor jedem Release abzuarbeiten.

### Vorbereitung

```bash
npm run clean && npm run build
```

In Chrome unter `chrome://extensions` entpackt laden.

### 1. Neuinstallation

- [ ] Die Einrichtung öffnet sich automatisch
- [ ] Alle drei Schritte lassen sich vorwärts und rückwärts durchlaufen
- [ ] Pfeiltasten blättern
- [ ] Nach „Fertig“ öffnen sich die Einstellungen
- [ ] Die gewählte Schutzstufe ist übernommen
- [ ] Die Einrichtung startet beim nächsten Öffnen **nicht** erneut

### 2. Blockieren

- [ ] Eine werbefinanzierte Nachrichtenseite laden — sichtbar weniger Werbung
- [ ] Der Zähler im Popup steigt (bei entpackt geladener Erweiterung sofort)
- [ ] Die Zahl am Symbol erscheint
- [ ] Hauptschalter aus → Seite neu laden → Werbung ist wieder da
- [ ] Hauptschalter wieder an → Werbung verschwindet

### 3. Schutzstufen

- [ ] Regler bewegen — Bezeichnung und Erklärung ändern sich sofort
- [ ] Stufe 0 → alle Kategorien aus
- [ ] Stufe 100 → alle Kategorien an
- [ ] Im Expertenmodus einen Unterfilter abschalten, dann den Regler bewegen —
      **die Unterfilter-Einstellung bleibt erhalten** _(in v4 wurde sie gelöscht)_

### 4. Ausnahmen

- [ ] Regler im Popup neben der Adresse umlegen → Seite lädt neu, nichts blockiert
- [ ] Auf einer Subdomain derselben Seite gilt die Ausnahme ebenfalls
- [ ] Das Popup nennt den verantwortlichen Eintrag („Pausiert über …“)
- [ ] Über die Einstellungen entfernen → wieder aktiv
- [ ] Kontextmenü-Eintrag „pausieren/aktivieren“ wechselt den Titel passend
- [ ] <kbd>Alt</kbd>+<kbd>Umschalt</kbd>+<kbd>P</kbd> funktioniert

### 5. Element-Picker

- [ ] Über Popup, Kontextmenü und <kbd>Alt</kbd>+<kbd>Umschalt</kbd>+<kbd>E</kbd> startbar
- [ ] Rahmen folgt der Maus
- [ ] Mausrad nach oben wählt das Elternelement
- [ ] <kbd>↑</kbd> tut dasselbe, <kbd>Enter</kbd> öffnet den Dialog
- [ ] <kbd>Esc</kbd> bricht ab
- [ ] Die Trefferzahl im Dialog stimmt
- [ ] Bei mehr als 20 Treffern erscheint die Warnung
- [ ] Ein ungültiger Selektor deaktiviert die Schaltfläche
- [ ] Nach dem Bestätigen verschwindet das Element
- [ ] „Rückgängig“ im Hinweis stellt es wieder her
- [ ] Nach einem Neuladen der Seite bleibt es ausgeblendet
- [ ] Auf einer Seite mit aggressivem CSS wird die Picker-Oberfläche nicht verzerrt

### 6. Filterlisten

- [ ] EasyList einschalten → Download läuft, Regelzahl erscheint
- [ ] Ausschalten → Regelzahl auf 0, gespeicherte Regeln entfernt
- [ ] „Aktualisieren“ zeigt „Lädt …“ und danach eine Rückmeldung
- [ ] Mehrere große Listen einschalten → der Hinweis zum Kontingent erscheint
- [ ] Offline: eine Aktualisierung versuchen → Fehler steht an der Liste

### 7. Statistik

- [ ] Die Zahlen im Popup stimmen mit denen der Einstellungen überein
- [ ] Das Diagramm über 14 Tage wird gezeichnet
- [ ] Ranglisten sind gefüllt
- [ ] Zurücksetzen leert alle Zähler, lässt die Einstellungen aber unangetastet

### 8. Sicherung

- [ ] Exportieren erzeugt eine JSON-Datei
- [ ] Importieren derselben Datei ändert nichts
- [ ] Import einer v4-Sicherung übernimmt Ausnahmen und eigene Regeln
- [ ] Import einer kaputten Datei zeigt eine verständliche Meldung, ohne etwas zu ändern
- [ ] Zurücksetzen führt zum Auslieferungszustand

### 9. Diagnose

- [ ] Der Selbsttest läuft durch und meldet alles in Ordnung
- [ ] Bei ausgeschaltetem Hauptschalter meldet er genau das
- [ ] Der Bericht lädt herunter und enthält **keine** besuchten Adressen
- [ ] Die Protokollstufe lässt sich ändern und wird gespeichert

### 10. Darstellung und Bedienung

- [ ] Helles und dunkles Thema sehen beide beabsichtigt aus, nicht invertiert
- [ ] „Wie das System“ folgt der Systemeinstellung
- [ ] „Bewegung reduzieren“ schaltet Übergänge ab
- [ ] Alle Bedienelemente sind per <kbd>Tab</kbd> erreichbar
- [ ] Der Fokusrahmen ist überall sichtbar
- [ ] Die Sprungmarke erscheint beim ersten <kbd>Tab</kbd> auf der Einstellungsseite
- [ ] Bei 720 px Fensterbreite bleibt die Einstellungsseite bedienbar

### 11. Service Worker

Der kritischste Punkt — hier saßen die meisten Fehler in v4.

- [ ] Unter `chrome://extensions` auf „Dienst-Worker“ klicken, dann in der
      Konsole `chrome.runtime.reload()` ausführen
- [ ] 30 Sekunden warten, bis der Worker beendet wird (Status wechselt)
- [ ] Popup öffnen → Zahlen erscheinen, keine Fehlermeldung
- [ ] Einen Schalter umlegen → wirkt
- [ ] Eine Seite laden → wird weiterhin blockiert
- [ ] Die Zahl am Symbol ist wiederhergestellt

### 12. Sonderfälle

- [ ] `chrome://extensions` öffnen → Popup zeigt „Keine Webseite“, ohne Fehler
- [ ] Eine PDF-Datei öffnen → kein Fehler in der Konsole
- [ ] Eine Seite mit vielen Iframes → keine spürbare Verlangsamung
- [ ] Eine Seite mit Endlos-Scroll → Speicherverbrauch bleibt stabil

## Vor dem Release

```bash
npm run clean
npm ci
npm run verify
npm run package
```

- [ ] `CHANGELOG.md` enthält einen Abschnitt zur neuen Version
- [ ] Die Checkliste oben ist abgearbeitet
- [ ] Die vorherige Version wurde als Update getestet (nicht nur als Neuinstallation)
- [ ] Das ZIP lässt sich entpacken und laden

## Absichtliche Lücken

Ehrlich benannt, statt einen falschen Eindruck von Vollständigkeit zu erzeugen:

- **Keine E2E-Tests.** Playwright kann Erweiterungen ansteuern, aber die
  Einrichtung ist aufwendig und die Tests sind erfahrungsgemäß unzuverlässig.
  Für ein Projekt dieser Größe war die Checkliste der bessere Kompromiss.
- **Keine Tests der Oberfläche.** Die UI-Module haben wenig eigene Logik; das
  meiste ist DOM-Aufbau. Ein Testaufbau dafür hätte mehr Wartung gekostet als
  eingebracht.
- **Kein Test des Service Workers.** Die Chrome-APIs vollständig nachzubilden
  wäre ein eigenes Projekt. Stattdessen ist die Logik so weit wie möglich in
  `src/core/` herausgezogen — dort ist sie vollständig getestet.
- **Nur Chrome.** Firefox nutzt ein anderes Erweiterungsmodell. Eine Portierung
  ist denkbar, aber nicht begonnen.
