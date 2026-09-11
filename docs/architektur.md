# Architektur

Dieses Dokument beschreibt, wie pBlock aufgebaut ist — und vor allem, **warum**.
Die Begründungen sind wichtiger als die Beschreibung: Wer eine Entscheidung
ändern will, sollte wissen, was sie ursprünglich gelöst hat.

## Leitgedanke

> Logik, die man testen kann, gehört von allem getrennt, was man nicht testen kann.

In Version 4 war jede Regel-, Statistik- und Einstellungslogik direkt mit
`chrome.storage` und dem DOM verwoben. Automatisiert prüfbar war davon nichts —
und genau dort saßen die meisten Fehler. Jeder einzelne davon hätte sich mit einem
Unit-Test in Minuten gefunden.

## Schichten

```
┌──────────────────────────────────────────────────────────┐
│  src/ui/          Popup · Einstellungen · Einrichtung    │
│                   DOM, kein direkter Storage-Zugriff     │
└───────────────────────────┬──────────────────────────────┘
                            │ Nachrichten
┌───────────────────────────▼──────────────────────────────┐
│  src/background/  Service Worker                         │
│                   chrome.* APIs, Storage, DNR, Alarme    │
└───────────────────────────┬──────────────────────────────┘
                            │ importiert
┌───────────────────────────▼──────────────────────────────┐
│  src/core/        Reine Logik                            │
│                   kein chrome, kein DOM, 100 % testbar   │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  src/content/     Content-Scripts auf jeder Seite        │
│                   importiert core, redet über Nachrichten│
└──────────────────────────────────────────────────────────┘
```

Die Trennung ist nicht nur Konvention. `eslint.config.js` verbietet in
`src/core/` die Bezeichner `chrome`, `window` und `document`. Ein Verstoß bricht
den Lint — nicht erst der Test.

## `src/core/` — die Logik

| Modul                | Aufgabe                                         |
| -------------------- | ----------------------------------------------- |
| `constants.js`       | Limits, ID-Bereiche, Prioritäten, Farben        |
| `messages.js`        | Nachrichtentypen, `ok()`/`fail()`               |
| `time.js`            | ISO-Tagesschlüssel, ISO-Wochen                  |
| `domain.js`          | Hostname-Vergleich, Whitelist-Prüfung           |
| `logger.js`          | Leveled Logger mit Ringpuffer                   |
| `settings-schema.js` | Kategorie-Taxonomie, Standardwerte              |
| `settings.js`        | Normalisieren, Ändern, Import/Export, Migration |
| `rule-registry.js`   | Mitgelieferte Domainlisten                      |
| `rule-engine.js`     | Einstellungen → declarativeNetRequest-Regeln    |
| `filter-parser.js`   | Adblock-Plus-Format → Regeln                    |
| `statistics.js`      | Zählen und Auswerten                            |
| `site-stats.js`      | Dasselbe pro Website                            |
| `cosmetic-rules.js`  | Selektor-Katalog, Stylesheet-Erzeugung          |
| `presets.js`         | Metadaten der Filterlisten                      |

Alle Funktionen sind **pur**: gleiche Eingabe, gleiche Ausgabe, keine
Seiteneffekte. Zustandsändernde Funktionen geben ein neues Objekt zurück und
lassen das Original unangetastet.

Zeitabhängige Funktionen nehmen `Date`/`now` als Parameter mit Standardwert.
Dadurch sind Tests rund um Mitternacht, Jahreswechsel und Sommerzeit möglich,
ohne die Systemuhr zu manipulieren.

## Datenfluss: ein Schalter wird umgelegt

```
Popup: Nutzer schaltet "Tracker" aus
  │
  ├─→ send(MSG.SET_CATEGORY, {categoryId: 'analytics', enabled: false})
  │
Service Worker: messaging.js
  ├─→ store.readSettings()                    aus dem Cache oder Storage
  ├─→ settings.setCategoryEnabled(...)        rein, liefert neues Objekt
  ├─→ store.writeSettings(next)
  ├─→ scheduleApply()                         entprellt, 150 ms
  │     └─→ rule-engine.buildDynamicRuleSet() rein
  │     └─→ rule-engine.computeRuleUpdate()   rein, minimaler Unterschied
  │     └─→ chrome.declarativeNetRequest.updateDynamicRules()
  ├─→ notifyContentScripts()                  offene Tabs bekommen neue Selektoren
  └─→ Antwort {ok: true, data: {categories}}
  │
Popup: lädt neu und zeichnet
```

Die beiden rein gerechneten Schritte sind genau die, die in v4 Fehler enthielten —
und genau die, die jetzt durch Tests abgedeckt sind.

## Blockieren mit declarativeNetRequest

### Warum keine statischen Rulesets

Mitgelieferte Regeln als statische Rulesets im Manifest zu hinterlegen wäre eine
denkbare Alternative. Dagegen sprach:

- Bei rund 30 Unterkategorien käme man nahe an das Limit von 50 gleichzeitig
  aktiven Rulesets. Jede neue Unterkategorie rückt näher an die Wand.
- Die Regeln müssten zur Bauzeit erzeugt werden, was den Build an die
  Filterdaten koppelt.
- Dynamische Regeln überdauern einen Neustart des Browsers ebenfalls.

Da die Domainbündelung die Kategorien ohnehin auf unter 20 Regeln zusammenfasst,
ist das Kontingent kein Engpass.

### Domains bündeln

Der wichtigste Hebel für die Leistung. `requestDomains` nimmt eine Liste von
Domains entgegen und deckt Subdomains automatisch mit ab:

```js
// v4: eine Regel je Domain — rund 200 Stück
{ id: 5, condition: { urlFilter: '||pagead2.googlesyndication.com^' } }
{ id: 6, condition: { urlFilter: '||adservice.google.com^' } }
// … 198 weitere

// v5: eine Regel für die ganze Gruppe
{
  id: 10000,
  priority: 10,
  action: { type: 'block' },
  condition: {
    requestDomains: ['googlesyndication.com', 'doubleclick.net', /* … */],
    resourceTypes: [/* … */],
  },
}
```

Zusätzlich entfernt `collapseRedundantDomains()` Subdomains, die bereits von
einer übergeordneten Domain derselben Liste abgedeckt sind. v4 führte
beispielsweise `media.net` **und** `static.media.net` — die zweite Regel konnte
nie zusätzlich greifen.

### Rangfolge

| Priorität | Herkunft      | Wirkung                                 |
| --------- | ------------- | --------------------------------------- |
| 1000      | Whitelist     | hebt auf freigegebenen Seiten alles auf |
| 100       | Eigene Regeln | schlagen mitgelieferte Listen           |
| 10        | Kategorien    | die mitgelieferte Registry              |
| 1         | Filterlisten  | breite Abdeckung, schwächste Stimme     |

Bei gleicher Priorität schlägt `allow` ein `block`. Die deutlichen Abstände sorgen
dafür, dass die Rangfolge nicht von Implementierungsdetails abhängt.

### Whitelisting

```js
// Eine Regel hebt sämtliches Blockieren für das Dokument und alle
// Unter-Anfragen auf.
{
  priority: 1000,
  action: { type: 'allowAllRequests' },
  condition: { requestDomains: [...], resourceTypes: ['main_frame', 'sub_frame'] },
}
```

v4 hängte stattdessen an _jede_ Block-Regel ein `excludedInitiatorDomains` mit
der gesamten Whitelist. Das vervielfacht die Datenmenge (Whitelist × Regelanzahl),
erzwingt bei jeder Whitelist-Änderung ein vollständiges Neuschreiben und greift
nicht für Anfragen ohne Initiator.

### Regel-Kontingent

Chrome garantiert 5.000 dynamische Regeln; neuere Versionen erlauben mehr. Der
tatsächliche Wert wird zur Laufzeit über
`chrome.declarativeNetRequest.MAX_NUMBER_OF_DYNAMIC_RULES` gelesen.

Reicht das Kontingent nicht, werden **ausschließlich Regeln aus Filterlisten
gekürzt** — Whitelist, eigene Regeln und Kategorien kommen immer vollständig
durch. Die Kürzung wird gemeldet und in den Einstellungen angezeigt.

In v4 fehlte diese Begrenzung. Fünf aktivierte Listen konnten 50.000 Regeln
erzeugen; `updateDynamicRules` scheiterte, und damit gingen _alle_ Regeln
verloren — auch die mitgelieferten. Sichtbar war das nirgends.

## Speicher

### Nur `chrome.storage.local`

`chrome.storage.sync` bietet 102.400 Bytes insgesamt, **8.192 Bytes pro Eintrag**
und 1.800 Schreibvorgänge pro Stunde.

v4 legte dort das komplette `categories`-Objekt ab — samt aller deutschen Labels
und Beschreibungstexte, allein über 4 KB. Zusammen mit Whitelist, eigenen Regeln
und Element-Regeln war das Limit realistisch erreichbar. Überschreitungen meldet
`sync` nur über `chrome.runtime.lastError`, das an keiner Stelle geprüft wurde.
Einstellungen verschwanden also stillschweigend.

`local` bietet 10 MB und kein Schreiblimit. Der Preis ist die fehlende
Geräte-Synchronisation; der Ausgleich ist ein Export, der zusätzlich Statistik
und Filterlisten mitnimmt — was `sync` ohnehin nie konnte.

### Schlüssel

| Schlüssel          | Inhalt                                                     |
| ------------------ | ---------------------------------------------------------- |
| `settings`         | Einstellungen (nur Booleans und Nutzerdaten, keine Labels) |
| `statistics`       | Tagesweise Zähler, Domains, geschätztes Volumen            |
| `siteStats`        | Dasselbe pro Website, auf 500 Hosts begrenzt               |
| `presetMeta`       | Zustand der Filterlisten                                   |
| `presetRules:<id>` | Die übersetzten Regeln je Liste                            |
| `onboarding`       | Ob die Einrichtung abgeschlossen wurde                     |

### Statistik ohne Rollover

Der entscheidende Umbau: `days` ist die einzige Wahrheit.

```js
{
  total: 48213,
  days: {
    '2026-09-11': { total: 1247, hours: [/* 24 */], categories: { ads: 800 } },
  },
  domains: { 'doubleclick.net': 4211 },
}
```

„Heute“ ist `days[heute].total`. „Diese Woche“ ist die Summe der Tage der
laufenden ISO-Woche. Beides wird berechnet, nicht gespeichert.

v4 hielt `today`, `week` und `total` als eigene Zähler und musste bei jedem
Treffer prüfen, ob inzwischen ein neuer Tag begonnen hat. Diese Logik existierte
an drei Stellen in drei Varianten; eine davon archivierte die Stundendaten des
neuen Tages unter dem alten Datum. Ohne Rollover-Code gibt es keine
Rollover-Fehler.

Tagesschlüssel sind ISO (`YYYY-MM-DD`) in **lokaler** Zeitzone. v4 nutzte
`toDateString()` — sprachabhängig („Fri Sep 11 2026“) und damit als
Storage-Schlüssel unbrauchbar.

## Service Worker

Chrome beendet den Service Worker nach etwa 30 Sekunden Untätigkeit. Daraus
folgen zwei Regeln:

**1. Listener synchron registrieren.** Alles in `service-worker.js` steht vor dem
ersten `await`. Wird ein Listener erst in einem asynchronen Zweig angemeldet,
verpasst der gerade neu gestartete Service Worker genau das Ereignis, das ihn
geweckt hat.

**2. Keine Timer.** `setInterval` verschwindet mit dem Service Worker.
Wiederkehrende Aufgaben laufen über `chrome.alarms`, das ihn wieder aufweckt.
v4 nutzte `setInterval` für die Statistik-Abfrage — nach dem ersten Suspend lief
sie nie wieder an.

Kurze Verzögerungen mit `setTimeout` (Entprellen, Puffern) sind in Ordnung: Sie
laufen innerhalb einer aktiven Sitzung, und wenn der Service Worker vorher endet,
war ohnehin nichts zu tun.

## Content-Scripts

Drei Skripte, jedes mit einem klaren Zweck:

| Datei               | Welt     | Zeitpunkt        | Aufgabe                             |
| ------------------- | -------- | ---------------- | ----------------------------------- |
| `main-world.js`     | MAIN     | `document_start` | Adblock-Erkennung entschärfen       |
| `cosmetic.js`       | ISOLATED | `document_start` | Stylesheet einfügen, Treffer zählen |
| `element-picker.js` | ISOLATED | `document_idle`  | Auswahlwerkzeug                     |

### Warum `world: MAIN` statt `eval`

v4 schickte Skript-Quelltext als String an den Service Worker, der ihn per
`chrome.scripting.executeScript` in eine Funktion mit `eval(code)` hineinreichte.
Das ist dynamische Codeausführung — genau das, was Manifest V3 unterbinden soll —
und kostete pro Scriptlet eine Nachricht plus einen Injektionsvorgang.

Seit Chrome 111 lässt sich ein Content-Script im Manifest direkt mit
`"world": "MAIN"` registrieren. Der Code liegt als normale Datei im Paket, wird
statisch geprüft und läuft ohne `eval`. Daher `minimum_chrome_version: 111`.

`scripts/validate-manifest.mjs` durchsucht die gebauten Bundles nach `eval(`,
`new Function(` und `setTimeout` mit String-Argument und lässt den Build
scheitern, falls sich so etwas wieder einschleicht.

### Verstecken übernimmt CSS

Das Content-Script schreibt ein Stylesheet und **zählt** nur noch. v4 setzte
zusätzlich auf jedem Treffer Inline-Styles, was bei hunderten Elementen
unnötige Layout-Neuberechnungen auslöste.

Jeder Selektor bekommt eine eigene CSS-Regel. In einer Selektorliste macht ein
einziger ungültiger Selektor die gesamte Regel unwirksam — v4 hängte
ungeprüfte Nutzereingaben aus dem Element-Picker an eine solche Sammelregel an.

## Build

`esbuild` bündelt jeden Einstiegspunkt eigenständig nach `dist/`. Gemeinsamer
Code aus `src/core/` landet dadurch mehrfach im Paket. Das ist gewollt:
Code-Splitting erzeugt zusätzliche Ladevorgänge, und in einem Content-Script ist
eine einzelne, eigenständige Datei das Schnellste und Robusteste.

Die Versionsnummer wird beim Build aus `package.json` ins Manifest geschrieben.
In v4 standen dort 4.0.0 und im README-Badge 3.0.2.

## Bewusste Verzichte

| Verzicht                     | Grund                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Kein UI-Framework            | Das Popup muss beim Klick sofort da sein. Der Zustand ist klein genug für rohes DOM.                                           |
| Kein TypeScript              | JSDoc mit `checkJs` liefert im Editor fast dieselbe Sicherheit, ohne einen Übersetzungsschritt zwischen Quelle und Paket.      |
| Keine Icon-Bibliothek        | v4 lieferte Iconify auf jeder Oberflächenseite aus — rund 40 KB. Typografie und Farbe tragen die Struktur genauso.             |
| Keine Webfonts               | Externe Anfrage, Ladeflackern, zusätzliche Abhängigkeit. Die Systemschrift ist in einer Erweiterung ohnehin die richtige Wahl. |
| Keine Geräte-Synchronisation | Siehe oben: `sync` verliert Daten stillschweigend.                                                                             |
