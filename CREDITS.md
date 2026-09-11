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
