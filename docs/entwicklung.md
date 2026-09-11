# Entwicklung

## Voraussetzungen

- Node.js 20 oder neuer (die Version steht in `.nvmrc`)
- Chrome 111 oder neuer
- Git

## Einrichten

```bash
git clone https://github.com/philppplik/pBlock.git
cd pBlock
npm install
npm run build
```

In Chrome laden:

1. `chrome://extensions` öffnen
2. Entwicklermodus einschalten (Schalter oben rechts)
3. „Entpackte Erweiterung laden“ und **`dist/`** auswählen

## Befehle

| Befehl                      | Wirkung                                       |
| --------------------------- | --------------------------------------------- |
| `npm run build`             | Baut nach `dist/`, minifiziert                |
| `npm run build:watch`       | Baut bei jeder Änderung neu, mit Sourcemaps   |
| `npm run clean`             | Entfernt `dist/`, `coverage/`, Archive        |
| `npm test`                  | Führt die Tests einmal aus                    |
| `npm run test:watch`        | Führt Tests bei jeder Änderung aus            |
| `npm run test:coverage`     | Tests mit Abdeckungsbericht und 80-%-Schwelle |
| `npm run lint`              | ESLint                                        |
| `npm run lint:fix`          | ESLint mit automatischer Korrektur            |
| `npm run format`            | Prettier                                      |
| `npm run format:check`      | Prüft die Formatierung, ohne zu ändern        |
| `npm run validate:manifest` | Prüft das gebaute Paket                       |
| `npm run package`           | Erzeugt das ZIP für den Web Store             |
| `npm run verify`            | Alles zusammen — läuft so auch in der CI      |

## Änderungen sichtbar machen

Was nach einem Neubau zu tun ist, hängt vom geänderten Bereich ab:

| Geändert in         | Nötig                                                             |
| ------------------- | ----------------------------------------------------------------- |
| `src/background/`   | Unter `chrome://extensions` auf den Kreispfeil bei pBlock klicken |
| `src/content/`      | Erweiterung neu laden **und** die betroffene Seite neu laden      |
| `src/ui/`           | Popup schließen und wieder öffnen; Einstellungsseite neu laden    |
| `src/manifest.json` | Erweiterung neu laden                                             |
| `src/core/`         | Je nachdem, wer es importiert — im Zweifel alles neu laden        |

`build:watch` baut automatisch, lädt die Erweiterung aber **nicht** neu. Chrome
bietet dafür keine zuverlässige Schnittstelle.

## Wo etwas hingehört

**Faustregel: Lässt sich das ohne Browser testen, gehört es nach `src/core/`.**

| Art der Änderung        | Ort                                                        |
| ----------------------- | ---------------------------------------------------------- |
| Neue Filterdomain       | `src/core/rule-registry.js`                                |
| Neue Kategorie          | `src/core/settings-schema.js` **und** `rule-registry.js`   |
| Regeln anders erzeugen  | `src/core/rule-engine.js`                                  |
| Neue Einstellung        | `settings-schema.js`, `settings.js`, dann die Oberfläche   |
| Neue Nachricht          | `src/core/messages.js`, dann `src/background/messaging.js` |
| Statistik auswerten     | `src/core/statistics.js`                                   |
| Neuer Cosmetic-Selektor | `src/core/cosmetic-rules.js`                               |
| Oberfläche              | `src/ui/`                                                  |

## Tests

Vitest, Tests unter `tests/core/`.

```bash
npm test
npm run test:watch
npm run test:coverage
```

Die Schwelle liegt bei 80 % für `src/core/`; aktuell erreicht sind 97 %
Statements und 89 % Branches.

### Erwartungen an Tests

**Fehlerbehebungen beginnen mit einem Test.** Er soll fehlschlagen, bevor die
Behebung greift. Regressionstests werden mit einem Kommentar versehen, der
beschreibt, was vorher falsch war:

```js
// Regression: v4 nutzte hostname.includes(domain). Damit galt ein
// Whitelist-Eintrag für Domains, die der Nutzer nie freigegeben hat.
test('matcht NICHT über Label-Grenzen hinweg', () => {
  expect(isHostnameCoveredBy('boulevard.de', 'ard.de')).toBe(false);
});
```

**Zeit wird injiziert, nicht gemockt.** Alle zeitabhängigen Funktionen nehmen ein
`Date` entgegen:

```js
expect(getTodayTotal(state, new Date(2026, 8, 11))).toBe(8);
```

Das erlaubt Tests über Mitternacht, Jahreswechsel und Sommerzeit hinweg, ohne
globale Zustände zu verbiegen.

**Testnamen beschreiben Verhalten, nicht Implementierung.** „verwirft
seitenspezifische Regeln ohne gültige Domain“ statt „testet normalizeElementRules“.

## Code-Stil

Prettier und ESLint sind gesetzt. Darüber hinaus:

**Unveränderlichkeit.** Funktionen in `src/core/` geben neue Objekte zurück:

```js
export function setCategoryEnabled(settings, categoryId, enabled) {
  const next = cloneSettings(settings);
  next.categories[categoryId].enabled = Boolean(enabled);
  return next;
}
```

**Kommentare erklären das Warum.** Was der Code tut, steht im Code:

```js
// Falsch — beschreibt nur, was ohnehin dasteht:
// Setzt die Anzahl der Domains pro Regel auf 500
const MAX_DOMAINS_PER_RULE = 500;

// Richtig — erklärt, was man dem Code nicht ansieht:
// Chrome begrenzt die Summe der Domain-Einträge pro Regel. Wir bleiben
// deutlich darunter und teilen längere Listen auf mehrere Regeln auf.
const MAX_DOMAINS_PER_RULE = 500;
```

**Fehler werden gemeldet, nicht verschluckt.** `catch {}` ohne Kommentar ist ein
Fehler. Wenn ein Fehler wirklich ignoriert werden darf, gehört die Begründung
daneben:

```js
} catch {
  // Tabs ohne geladenes Content-Script antworten nicht. Das ist normal.
}
```

Genau daran scheiterte v4 mehrfach: Ein leeres `catch` verschluckte den
ReferenceError, der die Cosmetic-Filter im Hintergrund komplett lahmlegte.

## Debuggen

### Service Worker

`chrome://extensions` → bei pBlock auf **„Dienst-Worker“** klicken. Das öffnet die
DevTools des Service Workers.

Wichtig: Die Konsole ist leer, wenn der Service Worker zwischenzeitlich beendet
wurde. Für die Fehlersuche ist deshalb der Ringpuffer des Loggers der bessere
Weg — er überdauert zwar auch keinen Neustart, enthält aber innerhalb einer
Sitzung auch Einträge unterhalb der Ausgabeschwelle.

Protokollstufe hochsetzen: Einstellungen → Diagnose → Ausführlichkeit →
„Alles (ausführlich)“.

### Regeln ansehen

In der Konsole des Service Workers:

```js
await chrome.declarativeNetRequest.getDynamicRules();
```

### Content-Scripts

Normale DevTools der betroffenen Seite. Im Konsolen-Dropdown den Kontext von
„top“ auf pBlock umstellen, um das isolierte Content-Script zu sehen.
`main-world.js` läuft im Kontext „top“.

### Selbsttest

Einstellungen → Diagnose → „Selbsttest starten“. Prüft Hauptschalter,
Anwendbarkeit der Regeln, tatsächlich hinterlegte Regeln, Speicherauslastung und
Fehler bei Filterlisten.

## Veröffentlichen

```bash
# 1. Changelog ergänzen — der Abschnitt "## [x.y.z]" wird vom Workflow
#    automatisch in die Release-Notizen übernommen.

# 2. Version erhöhen (setzt den Tag automatisch)
npm version minor

# 3. Vollständig prüfen
npm run verify

# 4. Hochladen
git push --follow-tags
```

Der Release-Workflow prüft anschließend selbst, baut, erzeugt das ZIP und legt
das GitHub-Release an. Das Hochladen in den Chrome Web Store erfolgt manuell mit
der Datei aus den Release-Anhängen.

## Häufige Stolpersteine

**„Meine Änderung greift nicht.“** Erweiterung neu geladen? Bei Content-Scripts
zusätzlich die Seite neu geladen?

**„`window is not defined`.“** Du bist im Service Worker. Dort gibt es kein
`window` und kein `document`. ESLint verbietet beides in `src/background/` —
falls die Meldung trotzdem auftaucht, kommt sie aus einem importierten Modul.

**„Regeln werden nicht angewendet.“** Selbsttest ausführen. Häufigste Ursache
ist eine ungültige Regel, die den gesamten `updateDynamicRules`-Aufruf scheitern
lässt; der Fehler steht dann im Protokoll.

**„Der Zähler bleibt auf null.“** Ohne Entwicklermodus gibt es kein
`onRuleMatchedDebug`; die Zählung läuft dann getaktet über den aktiven Tab und
braucht bis zu eine Minute. Der Diagnosebereich zeigt an, welcher Weg gerade
aktiv ist.

**„Der Test schlägt nur in der CI fehl.“** Fast immer Zeitzone oder Sommerzeit.
Deshalb nehmen alle zeitabhängigen Funktionen ein `Date` entgegen.
