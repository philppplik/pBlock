# Danksagung und Lizenzen Dritter

pBlock steht unter der [MIT-Lizenz](LICENSE). Die Filterdaten und Werkzeuge
stammen zum Teil von anderen. Dieses Dokument führt auf, was woher kommt.

## Mitgelieferte Filterdaten

Die Domainlisten in [`src/core/rule-registry.js`](src/core/rule-registry.js)
wurden aus öffentlich dokumentierten Tracking- und Werbe-Endpunkten
zusammengestellt. Als Ausgangspunkt diente:

| Quelle                                                  | Lizenz          | Verwendung                                            |
| ------------------------------------------------------- | --------------- | ----------------------------------------------------- |
| [Toolz / d3Host](https://github.com/Turtlecute33/toolz) | CC BY-NC-SA 4.0 | Ausgangsbasis für Werbe-, Analyse- und Social-Tracker |

Die Liste wurde für v5 überarbeitet: Subdomains, die bereits von ihrer
übergeordneten Domain abgedeckt sind, wurden entfernt, Einträge mit hohem Risiko
für Fehlalarme gestrichen (siehe [`docs/filter.md`](docs/filter.md)) und
Kategorien für Krypto-Mining und Betrugsnetzwerke ergänzt.

**Hinweis zur Lizenz:** CC BY-NC-SA 4.0 schließt kommerzielle Nutzung aus.
pBlock ist ein nicht-kommerzielles Projekt und wird kostenlos verbreitet.

## Zuschaltbare Filterlisten

Diese Listen werden **nicht** mit ausgeliefert. Sie werden erst heruntergeladen,
wenn ein Nutzer sie in den Einstellungen einschaltet.

| Liste                                                                      | Betreuer         | Lizenz                   |
| -------------------------------------------------------------------------- | ---------------- | ------------------------ |
| [EasyList](https://easylist.to/)                                           | EasyList-Projekt | GPLv3 / CC BY-SA 3.0     |
| [EasyPrivacy](https://easylist.to/)                                        | EasyList-Projekt | GPLv3 / CC BY-SA 3.0     |
| [EasyList Germany](https://easylist.to/)                                   | EasyList-Projekt | GPLv3 / CC BY-SA 3.0     |
| [Peter Lowe's List](https://pgl.yoyo.org/adservers/)                       | Peter Lowe       | frei für private Nutzung |
| [URLhaus Malware Filter](https://gitlab.com/malware-filter/urlhaus-filter) | malware-filter   | CC0 1.0                  |

Ein herzlicher Dank an die Menschen, die diese Listen seit Jahren pflegen. Sie
leisten den mit Abstand größten Teil der Arbeit, auf der jeder Werbeblocker
aufbaut.

## Übernommene Ideen

### uBlock Origin

[uBlock Origin](https://github.com/gorhill/uBlock) von Raymond Hill ist der
Maßstab für Werbeblocker. pBlock hat daraus Folgendes übernommen:

| Übernommen                                                     | Wo                                 | Warum                                                                                                                                                                                  |
| -------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mehrere Quellen je Filterliste**                             | `src/core/presets.js`              | uBlock Origin führt in seiner `assets.json` je Liste mehrere `contentURL`-Einträge und weicht bei einem Ausfall auf einen Spiegel aus. Genau dieser Fall hat pBlock v5.0.0 lahmgelegt. |
| **Die CDN-Adressen von `uAssetsCDN`**                          | `src/core/presets.js`              | Öffentlich betriebene, verlässliche Spiegel für EasyList und EasyPrivacy.                                                                                                              |
| **Zwischenspeichern mit Rückfall auf die letzte gute Fassung** | `src/background/preset-manager.js` | Eine fehlgeschlagene Aktualisierung darf den bestehenden Schutz nicht aufheben.                                                                                                        |

> **Lizenzhinweis.** uBlock Origin steht unter **GPLv3**, pBlock unter MIT. Es
> wurde **kein Code** übernommen — weder abgeschrieben noch übersetzt noch
> angepasst. Übernommen sind ausschließlich Entwurfsideen und die Kenntnis
> öffentlicher Adressen; beides ist nicht urheberrechtlich geschützt. Wer dennoch
> Code aus uBlock Origin in pBlock einbringen möchte, müsste pBlock zuvor auf
> GPLv3 umstellen.

**Bewusst nicht übernommen**, mit Begründung:

- **Prozedurale Cosmetic-Filter** (`:has-text`, `:xpath`, `:upward`). Sie
  verlangen eine eigene Auswertungsschleife im Content-Script auf jeder Seite.
  Der Preis an Laufzeit und Komplexität steht für pBlock nicht im Verhältnis.
- **Dynamische Filterung** (die Matrix aus Quelle × Typ × Regel). Mächtig, aber
  für ein Werkzeug mit drei Schutzstufen der falsche Bedienansatz.
- **`$badfilter`** und andere Erweiterungen der Filtersyntax. Erst sinnvoll, wenn
  Nutzer eigene Listen einbinden können.
- **Eigene Filterlisten per Adresse hinzufügen.** Eine offene Flanke: Eine
  beliebige URL als Regelquelle ist genau der Weg, über den v5.0.0 unbeabsichtigt
  lahmgelegt wurde. Sinnvoll erst, wenn die Prüfungen aus v5.1.0 sich bewährt
  haben.

### SponsorBlock

[SponsorBlock](https://github.com/ajayyy/SponsorBlock) von Ajay Ramachandran
überspringt gesponserte Abschnitte in YouTube-Videos, gestützt auf von der
Gemeinschaft gemeldete Zeitmarken.

**Fachlich ist das etwas anderes als pBlock.** SponsorBlock blockiert keine
Netzwerkanfragen, sondern spult innerhalb eines Videos vor. Die beiden
Erweiterungen ergänzen sich, sie konkurrieren nicht — wer beides will,
installiert beides. Eine Nachbildung in pBlock wäre ein eigenes Produkt und
brächte niemandem etwas.

Eine Sache ist aber bemerkenswert und als Vorbild festgehalten:

> **Datensparsame Abfrage.** SponsorBlock schickt an seinen Server nicht die
> Video-Kennung, sondern nur die ersten vier Zeichen ihres SHA-256-Hashwerts. Der
> Server antwortet mit allen Treffern zu diesem Präfix, die Auswahl passiert
> lokal. Der Betreiber erfährt damit nie, welches Video jemand ansieht.

pBlock hat heute keinen Server und braucht das nicht. Sollte jemals eine
serverseitige Funktion dazukommen — etwa eine Meldestelle für beschädigte Seiten —
ist dieses Verfahren die Messlatte. Festgehalten in
[`docs/architektur.md`](docs/architektur.md).

## Entwicklungswerkzeuge

Diese Pakete werden nur zum Bauen und Testen gebraucht. **Keines davon landet im
ausgelieferten Paket** — die Erweiterung kommt ohne Fremdbibliothek zur Laufzeit aus.

| Paket                                              | Zweck                         | Lizenz |
| -------------------------------------------------- | ----------------------------- | ------ |
| [esbuild](https://esbuild.github.io/)              | Bündeln des Quellcodes        | MIT    |
| [Vitest](https://vitest.dev/)                      | Testausführung                | MIT    |
| [ESLint](https://eslint.org/)                      | Statische Prüfung             | MIT    |
| [Prettier](https://prettier.io/)                   | Formatierung                  | MIT    |
| [globals](https://github.com/sindresorhus/globals) | Globale Bezeichner für ESLint | MIT    |

## Entfernt gegenüber v4

- **Iconify** (`js/vendor/iconify-icon.min.js`, MIT) — die Symbolbibliothek wurde
  ersetzt. In der neuen Oberfläche tragen Typografie und Farbe die Struktur; die
  wenigen verbliebenen Symbole sind eingebettetes SVG. Das spart rund 40 KB
  JavaScript auf jeder Oberflächenseite.
- **Firebase Storage** — die alte Projektseite lud Logos von einer
  Firebase-Storage-URL. Alle Grafiken liegen jetzt im Repository unter
  `website/assets/`.

## Schriften

Keine. Alle Oberflächen und die Projektseite nutzen die Systemschrift. Das
vermeidet externe Anfragen, Ladeflackern und eine weitere Abhängigkeit.

## Grafiken

Logo und Symbole stammen von Philipp Paulik und stehen unter derselben
MIT-Lizenz wie das Projekt.
