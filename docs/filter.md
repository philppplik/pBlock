# Filter

Wie pBlock entscheidet, was blockiert wird — und was bewusst nicht.

## Die Grundregel

> Eine durchgerutschte Anzeige ärgert. Eine kaputte Bezahlseite kostet Vertrauen.

Jede Filterentscheidung wird an dieser Abwägung gemessen. Im Zweifel wird nicht
blockiert. Wer mehr Abdeckung will, kann Filterlisten zuschalten — das ist eine
bewusste Entscheidung des Nutzers und damit ein anderer Maßstab.

## Zwei Quellen

|                | Mitgeliefert                | Zuschaltbare Listen                |
| -------------- | --------------------------- | ---------------------------------- |
| Ort            | `src/core/rule-registry.js` | Werden heruntergeladen             |
| Umfang         | rund 180 Einträge           | zehntausende                       |
| Auswahl        | streng, handverlesen        | breit, von Gemeinschaften gepflegt |
| Standard       | aktiv                       | aus                                |
| Aktualisierung | mit jedem Update            | alle sechs Stunden                 |

Die mitgelieferten Filter sollen ohne Konfiguration und ohne Netzwerkzugriff
sofort etwas bewirken. Sie ersetzen keine vollständige Filterliste — das ist
Absicht.

## Aufbau der Registry

```js
export const RULE_REGISTRY = {
  ads: {
    google: {
      domains: ['googlesyndication.com', 'doubleclick.net'],
    },
    // …
  },
  social: {
    facebook: {
      domains: ['pixel.facebook.com', 'connect.facebook.net'],
      urlFilters: ['||facebook.com/tr'],
    },
  },
};
```

- **`domains`** enthält nach Möglichkeit die registrierbare Domain ohne
  Subdomain. `requestDomains` deckt Subdomains automatisch mit ab:
  `example.com` matcht auch `ads.example.com`.
- Explizite Subdomains stehen nur dort, wo die übergeordnete Domain legitim ist
  und nicht blockiert werden darf — etwa `pixel.facebook.com`, aber niemals
  `facebook.com`.
- **`urlFilters`** ist für pfadgebundene Muster, die sich nicht als Domain
  ausdrücken lassen, etwa `||facebook.com/tr`.

`collapseRedundantDomains()` entfernt Einträge, die bereits von einer
übergeordneten Domain derselben Liste abgedeckt sind. v4 führte
`media.net` **und** `static.media.net`; die zweite Regel konnte nie zusätzlich
greifen.

## Aufnahmekriterien

Eine Domain kommt in die Registry, wenn **alle** Punkte zutreffen:

1. **Sie dient ausschließlich Werbung, Tracking oder Schadsoftware.** Domains mit
   Doppelfunktion gehören nicht hinein — dafür sind die Filterlisten da.
2. **Sie ist verbreitet.** Ein Dienst, der auf einer Handvoll Seiten vorkommt,
   rechtfertigt keinen mitgelieferten Eintrag.
3. **Sie ist stabil.** Domains, die wöchentlich wechseln, laufen der
   Veröffentlichung ohnehin davon.
4. **Das Blockieren bricht keine erkennbare Funktion.** Siehe unten.

## Was bewusst nicht blockiert wird

Diese Einträge stammen aus v4 und wurden entfernt. Sie gehören nicht zurück.

### `t.co`

Der Link-Shortener von X. In v4 unter „twitter“ gelistet. Folge: **jeder von X
geteilte Link war tot.** Für den Nutzer ein Totalausfall, und Tracking verhindert
es kaum — X erfährt vom Klick ohnehin.

### `facebook.com`, `twitter.com`, `x.com`, `google.com`

Blockiert man eine dieser Domains vollständig, ist der Dienst nicht mehr
benutzbar. Geblockt werden ausschließlich die dedizierten Tracking-Endpunkte
(`pixel.facebook.com`, `analytics.twitter.com`) und pfadgebundene Muster
(`||facebook.com/tr`).

### Fehler-Tracking ist standardmäßig aus

Sentry, Bugsnag und Verwandte. Viele Web-Anwendungen stützen ihre Fehlerbehandlung
darauf; das Blockieren führt zu weißen Seiten statt einer Fehlermeldung. Der
Filter ist vorhanden, aber abgeschaltet und in der Oberfläche als
„kann Seiten stören“ markiert.

### Entfernte Cosmetic-Selektoren

| Selektor                          | Warum entfernt                                                                |
| --------------------------------- | ----------------------------------------------------------------------------- |
| `div[style*="min-height: 250px"]` | Trifft jedes Layout mit dieser Mindesthöhe — Artikelbilder, Videoplayer       |
| `[data-ad]`                       | Wird von Frameworks als generisches Datenattribut benutzt („additional data“) |
| `[class^="ad_"]`, `[id^="ad_"]`   | Kollidiert mit Präfixen wie `ad_min` in Verwaltungsoberflächen                |
| `.fb-root:not(:empty)`            | Versteckt auch funktionierende Kommentar-Plugins                              |

Die Liste steht als `REMOVED_LEGACY_SELECTORS` in `cosmetic-rules.js`, und ein
Test stellt sicher, dass keiner davon zurückkehrt.

## Filterlisten parsen

Der Parser in `src/core/filter-parser.js` übersetzt das Adblock-Plus-Format nach
declarativeNetRequest. Nicht alles lässt sich abbilden — der Parser **verwirft
dann bewusst und zählbar**, statt falsch zu übersetzen.

### Was übernommen wird

| Eingabe                          | Ergebnis                             |
| -------------------------------- | ------------------------------------ |
| `\|\|werbung.test^`              | Domain-Blockade                      |
| `werbung.test`                   | Domain-Blockade                      |
| `0.0.0.0 tracker.test`           | Domain-Blockade (Hosts-Format)       |
| `@@\|\|bank.test^`               | Ausnahme                             |
| `##.anzeigen-box`                | Generischer Cosmetic-Selektor        |
| `\|\|a.test^$third-party,script` | Blockade; die Einschränkung entfällt |

### Was verworfen wird

| Eingabe                                   | Grund                                                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `/banner\d+\.gif/`                        | Regexp — andere Syntax (RE2) und strenge Längenlimits                                                    |
| `$csp=…`, `$removeparam=…`, `$redirect=…` | Beschreiben eine andere Aktion als „blockieren“                                                          |
| `$popup`                                  | Als generelles `block` interpretiert würde es Inhalte treffen, die der Listenautor nie blockieren wollte |
| `beispiel.test##.banner`                  | Domainspezifische Cosmetic-Regeln werden derzeit nicht unterstützt                                       |
| `#?#…:has-text(…)`                        | Kein gültiges CSS                                                                                        |
| Unbekannte `$`-Options                    | Lieber verwerfen als raten                                                                               |

Jede Verwerfung wird mit Grund gezählt und steht nach einer Aktualisierung im
Protokoll.

### Welche Einschränkungen entfallen dürfen — und welche nicht

> **Korrektur gegenüber v5.0.0.** Hier stand, eine weggelassene Einschränkung
> lasse die Regel „höchstens breiter greifen, aber niemals falsch“. Das war
> falsch und hat einen Totalausfall verursacht. Die Einzelheiten stehen unten
> unter „Der Ausfall in v5.0.0“.

Drei Gruppen:

**Dürfen entfallen.** `$third-party`, `$first-party`, `$important`,
`$match-case`. Sie verengen die Regel auf einen Teil der Anfragen. Ohne sie
greift sie etwas breiter — aber immer noch nur auf das, was das Muster selbst
beschreibt.

**Müssen umgesetzt werden.** `$domain=` grenzt eine Regel auf bestimmte Seiten
ein. Die Eingrenzung ist bei vielen Regeln der _einzige_ Grund, warum das Muster
überhaupt vertretbar ist. pBlock bildet sie auf `initiatorDomains` und
`excludedInitiatorDomains` ab.

**Führen zum Verwerfen.** `$csp`, `$removeparam`, `$redirect` beschreiben eine
andere Aktion als „blockieren“. `$denyallow` und `$to` grenzen die Ziel-Domain
ein; ohne sie würde die Regel breiter greifen als gewollt.

### Der Ausfall in v5.0.0

EasyList Germany enthält diese Zeile:

```
|https:$domain=adfarm1.adition.com
```

Gemeint ist: „Blockiere auf der Seite `adfarm1.adition.com` alles.“ Das
`$domain=` ist der ganze Sinn der Regel.

v5.0.0 ließ es weg. Übrig blieb `|https:` — `|` ist der Anfangsanker, `https:`
das Präfix jeder HTTPS-Adresse. **Eine einzige Regel blockierte damit das
gesamte Web.**

Schlimmer noch: Sie blockierte auch die Downloads von pBlock selbst. Die
Erweiterung konnte die Liste, die den Fehler enthielt, nicht mehr aktualisieren —
und sich damit nicht mehr selbst reparieren. Im Diagnosebericht sah man es an
den Zeitstempeln: Die Downloads scheiterten nach **vier Millisekunden**. So
schnell scheitert kein Netzwerkzugriff; die Anfragen hatten den Browser nie
verlassen.

### Drei Verteidigungslinien

Seit v5.1.0 muss ein Muster dieser Art drei Hürden nehmen, um Schaden anzurichten:

1. **`$domain=` wird umgesetzt.** Die Regel oben wird korrekt auf
   `adfarm1.adition.com` eingegrenzt — sie funktioniert jetzt sogar wie gedacht.
2. **Muster ohne unterscheidungskräftigen Kern werden verworfen**, wenn sie
   nicht auf Domains eingegrenzt sind. `isCatastrophicallyBroad()` entfernt
   Anker, Platzhalter und ein führendes Schema; was übrig bleibt, muss mindestens
   vier Zeichen lang sein. `|https:` bleibt dabei nichts übrig.
3. **Kanarienvogel-Prüfung.** Vor dem Anwenden werden alle erzeugten Regeln
   gegen eine Liste von Adressen geprüft, die erreichbar bleiben müssen: die
   eigenen Bezugsquellen plus einige der meistbesuchten Seiten. Trifft eine
   Regel eine davon, ist sie mit Sicherheit zu breit und wird verworfen.

Dazu kommt eine vierte Absicherung außerhalb des Parsers: **Schutz-Allow-Regeln**
mit der höchsten Priorität für alle Bezugsquellen. Selbst wenn alles andere
versagt, bleibt eine Reparatur möglich. Siehe `docs/architektur.md`.

### Warum Unit-Tests das nicht gefunden hätten

Die auslösende Zeile stand in einer fremden Liste, die sich wöchentlich ändert.
Kein Test gegen erfundene Eingaben hätte sie vorhergesehen.

Deshalb gibt es `npm run audit:lists`: Das Skript lädt die echten Listen herunter,
schickt sie durch den echten Parser und prüft das Ergebnis mit derselben
Funktion, die auch zur Laufzeit greift. Es gehört vor jedes Release.

### Was v4 hier falsch machte

Der alte Parser bestand im Kern aus drei `replace`-Aufrufen, die nichts
veränderten (`'||' → '||'`), und verwarf danach alles mit einem `$`. Konkret:

- **Sämtliche Ausnahmeregeln fielen weg.** Jede Filterliste nutzt sie, um
  Fehlalarme zu entschärfen. Ohne sie blockiert man Logins und Bezahlseiten.
- **Der gesamte Options-Teil ging verloren.** Eine Regel, die nur für
  Drittanbieter-Skripte gedacht war, galt plötzlich für alles.
- **Regexp-Regeln rutschten teilweise als literales Muster durch.** Chrome lehnt
  die ab — und ließ damit den gesamten `updateDynamicRules`-Aufruf scheitern.
  Ergebnis: gar keine Regeln mehr, auch nicht die mitgelieferten.

## Cosmetic-Filter

Netzwerk-Blockaden verhindern das Laden. Was bleibt, ist oft ein leerer Kasten,
der das Layout auseinanderzieht. Cosmetic-Filter blenden ihn aus.

```css
.adsbygoogle {
  display: none !important;
  visibility: hidden !important;
}
```

Zwei Punkte, die in v4 fehlten:

**Jeder Selektor bekommt eine eigene Regel.** In einer Selektorliste macht ein
einziger ungültiger Selektor die gesamte Regel unwirksam. v4 hängte ungeprüfte
Nutzereingaben aus dem Element-Picker an eine gemeinsame Sammelregel an — ein
Tippfehler legte damit sämtliche Cosmetic-Filter lahm.

**Jeder Selektor wird vorher geprüft**, und zwar gegen die echte CSS-Engine:

```js
document.createDocumentFragment().querySelector(selector);
```

Was `querySelector` akzeptiert, akzeptiert auch das Stylesheet.

## Element-Picker

Der Picker erzeugt mehrere Selektor-Kandidaten und wählt den treffsichersten:

1. **ID**, sofern sie nicht generiert aussieht (`ad_8f3ba21` fällt raus — solche
   IDs ändern sich bei jedem Seitenaufruf)
2. **Datenattribute** der Werbenetzwerke (`[data-ad-slot="…"]`)
3. **Klassen**, erst alle zusammen, dann die aussagekräftigste einzeln
4. **Pfad über die Eltern** als letzter Ausweg

Gewählt wird der erste Kandidat, der **acht oder weniger** Elemente trifft.
Trifft keiner so wenige, gewinnt der mit den wenigsten Treffern.

Die Trefferzahl steht im Dialog, bevor man bestätigt. Bei mehr als 20 Treffern
erscheint eine Warnung.

v4 nahm den erstbesten Kandidaten. Hatte ein Element eine Klasse, wurde daraus
`.klasse` — auch wenn das 200 weitere Elemente traf. Der Nutzer klickte auf ein
Werbebanner und verlor die halbe Seite.

## Eine Domain vorschlagen

Bitte per [Issue](https://github.com/philppplik/pBlock/issues/new/choose), nicht
per Pull Request an die Registry. Jede Aufnahme wird gegen das Risiko abgewogen,
legitime Funktionen zu beschädigen — das klärt sich in einer Diskussion besser
als in einem Diff.

Hilfreich sind:

- die Domain
- auf welchen Seiten sie vorkommt
- was sie tut (Werbung, Tracking, Mining, Betrug)
- ob sie auch legitime Aufgaben erfüllt

Für breite Abdeckung ist ohnehin eine Filterliste der richtige Ort. Wer eine
Lücke in EasyList findet, meldet sie am besten direkt dort — davon profitieren
alle Werbeblocker.
