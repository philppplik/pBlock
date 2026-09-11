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

### Warum Einschränkungen entfallen dürfen

Eine Option wie `$third-party` **verengt** eine Regel. Lässt man sie weg, greift
die Regel breiter als vom Autor gedacht — aber niemals auf etwas, das er
freigeben wollte. Eine Option wie `$csp` dagegen beschreibt eine völlig andere
Aktion; sie wegzulassen wäre eine Fehlübersetzung.

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
