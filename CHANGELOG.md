# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden hier festgehalten.

Das Format folgt [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionierung [Semantic Versioning](https://semver.org/lang/de/).

> **Hinweis zum Format:** Der Release-Workflow schneidet den Abschnitt zur
> jeweiligen Version anhand der Überschrift `## [x.y.z]` heraus. Die Schreibweise
> bitte nicht ändern.

## [Unveröffentlicht]

## [5.1.0] – 2026-09-12

Dringender Patch. In v5.0.0 konnte eine einzige Zeile aus einer Filterliste dazu
führen, dass **jede HTTPS-Anfrage blockiert** wurde — und die Erweiterung sich
nicht mehr selbst reparieren konnte.

### Behoben

- **`$domain=` wurde weggelassen statt umgesetzt.** EasyList Germany enthält die
  Zeile `|https:$domain=adfarm1.adition.com` — „blockiere auf dieser einen Seite
  alles“. Ohne das `$domain=` blieb `|https:` übrig: der Anfangsanker plus das
  Präfix jeder HTTPS-Adresse. Eine Regel, die das gesamte Web blockierte.

  Der Fehler war selbstverstärkend: Die Regel blockierte auch die Downloads von
  pBlock, sodass die Liste, die sie entfernt hätte, nie ankam. Im
  Diagnosebericht scheiterten alle fünf Listen nach **vier Millisekunden** — die
  Anfragen hatten den Browser nie verlassen.

  `$domain=` wird jetzt auf `initiatorDomains` und `excludedInitiatorDomains`
  abgebildet. Die Regel funktioniert damit sogar wie vom Listenautor gedacht.

- **Die ASCII-Prüfung verwarf sämtliche Muster.** Beim Beheben einer
  Lint-Warnung in v5.0.0 gingen die Escapes in `/[^\x00-\x7F]/` verloren. Übrig
  blieb `[^ -]` — „alles außer Leerzeichen und Bindestrich“, was auf jedes
  Muster zutrifft. Aus EasyPrivacy wurden dadurch statt 8.275 Mustern null.

- **`$all` wurde als unbekannt verworfen.** URLhaus nutzt die Option auf 7.587
  Zeilen; wir verloren gut 80 % der Malware-Liste. Jetzt vollständig übernommen
  (9.347 statt 1.760 Einträge), mit eigenem Regel-Topf, damit daraus keine 7.587
  Einzelregeln werden.

- Weitere Options ergänzt: `xhr`, `css`, `frame`, `doc`, `beacon`, `strict3p`,
  `strict1p`. `$denyallow` und `$to` führen jetzt zum Verwerfen, statt
  stillschweigend die Regel zu verbreitern.

### Neu — vier Verteidigungslinien gegen Wiederholung

1. **Muster ohne unterscheidungskräftigen Kern** werden verworfen, sofern sie
   nicht auf Domains eingegrenzt sind (`isCatastrophicallyBroad`).
2. **Kanarienvogel-Prüfung**: Erzeugte Regeln werden vor dem Anwenden gegen
   Adressen geprüft, die erreichbar bleiben müssen — die eigenen Bezugsquellen
   plus google.com, github.com, wikipedia.org und andere. Treffer werden
   verworfen und protokolliert.
3. **Schutz-Allow-Regeln** mit der höchsten Priorität für alle Bezugsquellen.
   Selbst wenn alles andere versagt, bleibt eine Reparatur möglich.
4. **`npm run audit:lists`** lädt die echten Listen herunter und prüft sie mit
   der echten Laufzeitfunktion. Unit-Tests gegen erfundene Eingaben hätten diesen
   Fehler nie gefunden — die auslösende Zeile stand in einer fremden Liste.

### Neu — Ausfallsicherheit (Idee von uBlock Origin)

- **Mehrere Quellen je Filterliste**, der Reihe nach versucht. Ist `easylist.to`
  nicht erreichbar, wird über die CDN-Spiegel von uBlock Origin oder über Adblock
  Plus geladen. uBlock Origin führt in seiner `assets.json` seit Jahren mehrere
  `contentURL`-Einträge je Liste; die Idee ist von dort übernommen, kein Code.
- **Wiederholversuche** mit wachsendem Abstand bei Netzwerkfehlern.
- Antworten unter 100 Bytes gelten als Fehlerseite, nicht als Filterliste.
- Die Oberfläche zeigt, über welche Quelle eine Liste zuletzt geladen wurde.

### Geändert

- Beim Update werden gespeicherte Listen-Regeln verworfen und neu geholt. Ohne
  diesen Schritt hätte auch die korrigierte Fassung die fehlerhaften Regeln aus
  v5.0.0 weiter angewendet — sie liegen im Speicher und werden nicht neu geparst.
- Das Store-Paket enthält `images/` nicht mehr (515 KB → 76 KB) und nutzt
  spezifikationskonforme Pfadtrenner.

### Wirkung auf die Filterabdeckung

| Liste | v5.0.0 | v5.1.0 |
| --- | --- | --- |
| EasyList | 65.006 Einträge | 65.006 |
| EasyPrivacy | 46.867, **0 Muster** | 55.143, 8.275 Muster |
| EasyList Germany | 716 | 2.471 |
| Peter Lowe | 3.558 | 3.572 |
| URLhaus | 1.760 | **9.347** |


## [5.0.0] – 2026-09-11

Vollständige Überarbeitung. Die gesamte Logik wurde aus der Browser-Anbindung
herausgelöst, testbar gemacht und dabei eine Reihe von Fehlern behoben, die in
v4 unbemerkt geblieben waren — darunter mehrere, die Kernfunktionen wirkungslos
machten.

### Behoben

- **Cosmetic-Filter aus dem Hintergrund waren vollständig wirkungslos.**
  `CosmeticFilter.getActiveRules()` griff auf `window.location` zu; im Service
  Worker gibt es kein `window`. Der ReferenceError wurde von einem umschließenden
  `try/catch` verschluckt. Injiziert wird jetzt ausschließlich aus dem
  Content-Script.
- **Die Statistik zählte bei fast allen Nutzern dauerhaft null.**
  `onRuleMatchedDebug` feuert nur für entpackt geladene Erweiterungen. Der
  Rückfallpfad nutzte `setInterval` (verschwindet mit dem Service Worker) und
  `getMatchedRules()` ohne die dafür nötige Berechtigung.
- **Whitelist-Einträge galten für fremde Domains.** Der Vergleich lief über
  `hostname.includes(domain)`. Damit deckte ein Eintrag `ard.de` auch
  `boulevard.de` und `example.com.angreifer.test` ab. Ersetzt durch einen echten
  Suffix-Vergleich auf Label-Grenzen.
- **Regeln konnten vollständig ausfallen.** Aktivierte Filterlisten konnten bis
  zu 50.000 dynamische Regeln erzeugen; Chrome garantiert 5.000. Der Aufruf
  scheiterte, und damit gingen *alle* Regeln verloren — auch die mitgelieferten.
- **Der Schutzstufen-Regler löschte Feineinstellungen.** Er überschrieb das
  komplette `categories`-Objekt und setzte alle Unterkategorien zurück.
- **Einstellungen gingen stillschweigend verloren.** Sie lagen in
  `chrome.storage.sync` mit 8 KB pro Eintrag; das `categories`-Objekt enthielt
  sämtliche Beschreibungstexte. Überschreitungen meldet `sync` nur über
  `lastError`, das nirgends geprüft wurde.
- **Der Filterlisten-Parser verwarf den Großteil jeder Liste.** Sämtliche
  Ausnahmeregeln (`@@`) und alles mit `$`-Options fielen weg; Regexp-Regeln
  rutschten dagegen als literales Muster durch und ließen den gesamten
  Regel-Update-Aufruf scheitern.
- **`t.co` war als Twitter-Tracker gelistet** und machte damit jeden von X
  geteilten Link unbrauchbar. Entfernt.
- **Die Wochenzahl stimmte nie.** Sie wurde als
  `ceil(msSeitJahresbeginn / Woche)` berechnet. Ersetzt durch ISO-8601.
- **Beim Tageswechsel wurden Zahlen falsch archiviert.** Eine von drei
  Rollover-Implementierungen schrieb die Stundendaten des neuen Tages unter das
  alte Datum. Die Rollover-Logik entfällt jetzt ersatzlos.
- **Der Speicher wuchs unbegrenzt.** Die Stundenhistorie wurde nach einem anderen
  Schlüssel gelöscht als die Tagesdaten; die Per-Site-Statistik hatte gar keine
  Obergrenze und wurde bei jedem einzelnen Treffer vollständig neu geschrieben.
- **Sicherungsdateien landeten ungeprüft im Storage.** Der Import läuft jetzt
  durch die Normalisierung; unbekannte Schlüssel werden verworfen.
- **Ein ungültiger Selektor legte alle Cosmetic-Filter lahm.** Sie wurden zu
  einer einzigen CSS-Regel zusammengefasst — in CSS macht ein fehlerhafter
  Selektor die gesamte Regel unwirksam. Jetzt wird jeder Selektor einzeln geprüft
  und erzeugt eine eigene Regel.
- **Der Löschen-Knopf bei ausgeblendeten Elementen traf den falschen Eintrag**,
  wenn ein Filter aktiv war.
- **„Alle Element-Regeln löschen“ ließ die Elemente versteckt.** Die zugehörigen
  Selektoren blieben bestehen.
- **`patchScriptCreation` war toter Code.** Die Funktion überschrieb
  `document.createElement` in der isolierten Welt und konnte Seitenskripte
  prinzipbedingt nie erreichen — lief aber bei jedem Seitenaufruf.

### Geändert

- **`eval` entfernt.** v4 schickte Skript-Quelltext an den Service Worker und
  führte ihn dort mit `eval` aus — in Manifest V3 unzulässig und ein
  Ablehnungsgrund im Web Store. Ersetzt durch ein statisches Content-Script mit
  `"world": "MAIN"` (daher `minimum_chrome_version: 111`).
- **Speicherort auf `chrome.storage.local` umgestellt.** Als Ausgleich für die
  entfallende Geräte-Synchronisation nimmt der Export jetzt auch Statistik und
  Filterlisten mit — was `sync` ohnehin nie konnte.
- **Regeln werden differenziell geschrieben.** v4 löschte erst alle Regeln und
  legte sie dann neu an; dazwischen lag ein Fenster ohne jeden Schutz.
- **Domains werden gebündelt.** Über `requestDomains` werden aus rund 200
  Einzelregeln unter 20.
- **Whitelisting über `allowAllRequests`** mit hoher Priorität statt
  `excludedInitiatorDomains` an jeder einzelnen Block-Regel.
- **Berechtigungen reduziert:** `scripting` und
  `declarativeNetRequestWithHostAccess` entfallen, `web_accessible_resources`
  ebenfalls. Neu hinzugekommen sind `alarms` und
  `declarativeNetRequestFeedback` — ohne Letztere funktioniert die
  Trefferzählung nicht.
- **Oberfläche neu aufgebaut** mit eigenem Designsystem, hellem und dunklem
  Thema, sichtbarem Fokus, Tastaturbedienung und `prefers-reduced-motion`.
  `innerHTML` mit Nutzerwerten und `alert()` sind verschwunden.
- **Einrichtung von vier auf drei Schritte gekürzt.** Der vierte war eine reine
  Zusammenfassung ohne Entscheidung.
- **Element-Picker neu im Shadow DOM**, unempfindlich gegen Seiten-CSS, mit
  Tastaturbedienung und Trefferzahl vor dem Bestätigen.
- **Cosmetic-Selektoren mit hoher Fehlalarmquote entfernt**, unter anderem
  `[data-ad]`, `[class^="ad_"]` und `div[style*="min-height: 250px"]`. Die
  Begründung steht in `docs/filter.md`.

### Neu

- Testsuite mit 289 Unit-Tests; 97 % Statement-Abdeckung auf `src/core/`.
  Jeder behobene Fehler ist durch einen Regressionstest abgesichert.
- Diagnosebereich mit Selbsttest, Zustandsübersicht, einstellbarer Protokollstufe
  und herunterladbarem Bericht.
- Leveled Logger mit Ringpuffer, der auch Einträge unterhalb der Ausgabeschwelle
  aufzeichnet — nach einem Fehler ist damit auch der Kontext davor vorhanden.
- Kategorie **Schadsoftware & Betrug** für Krypto-Miner und Betrugsnetzwerke.
- Filterliste **EasyList Germany**.
- Tastenkürzel für Hauptschalter, Seiten-Pause und Element-Picker.
- Warnung im Element-Picker, wenn ein Selektor mehr als 20 Elemente träfe.
- Hinweis in den Einstellungen, wenn Regeln aus Filterlisten wegen des
  Browser-Limits verworfen wurden.
- Migration der Einstellungen aus v4 inklusive Übernahme aus
  `chrome.storage.sync`.
- Build mit esbuild, Manifest-Validator, CI-, Pages- und Release-Workflow.
- Projektseite als statisches HTML auf GitHub Pages, ohne Firebase, ohne
  Tracking, ohne eine einzige externe Anfrage.
- Deutschsprachige Dokumentation unter `docs/`.

### Entfernt

- `background.js`, `popup.*`, `options.*`, `wizard.*`, `privacy.html`, `css/`,
  `js/` und das alte `website/` — vollständig durch `src/` ersetzt.
- **Iconify** als Abhängigkeit der Oberfläche (rund 40 KB JavaScript je Seite).
- Die Debug-Knöpfe „Test-Stats“ und „API prüfen“, die über den tatsächlichen
  Zustand nichts aussagten. Ersetzt durch den Selbsttest.

## [4.0.0] – 2025

Erste Fassung unter dem Namen „Friendly Bird“ mit Element-Picker, Scriptlets und
überarbeiteter Oberfläche. Siehe Git-Historie.

[Unveröffentlicht]: https://github.com/philppplik/pBlock/compare/v5.1.0...HEAD
[5.1.0]: https://github.com/philppplik/pBlock/releases/tag/v5.1.0
[5.0.0]: https://github.com/philppplik/pBlock/releases/tag/v5.0.0
[4.0.0]: https://github.com/philppplik/pBlock/releases/tag/v4.0.0
