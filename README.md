<p align="center">
  <img src="images/pBlock-icon+schriftLogo.png" alt="pBlock" width="260">
</p>

<p align="center">
  <strong>Werbeblocker für Chrome. Quelloffen, ohne Datensammlung.</strong><br>
  Blockiert Werbung, Tracker und bekannte Schadsoftware-Domains — mit drei Schutzstufen und einem Element-Picker.
</p>

<p align="center">
  <a href="https://github.com/philppplik/pBlock/actions/workflows/ci.yml">
    <img src="https://github.com/philppplik/pBlock/actions/workflows/ci.yml/badge.svg" alt="CI-Status">
  </a>
  <img src="https://img.shields.io/badge/Manifest-V3-3E9EFF" alt="Manifest V3">
  <img src="https://img.shields.io/badge/Chrome-111%2B-3E9EFF" alt="Chrome 111 oder neuer">
  <img src="https://img.shields.io/badge/Lizenz-MIT-3FB950" alt="MIT-Lizenz">
  <img src="https://img.shields.io/badge/Datensammlung-keine-3FB950" alt="Keine Datensammlung">
</p>

<p align="center">
  <a href="https://philppplik.github.io/pBlock/">Projektseite</a> ·
  <a href="docs/architektur.md">Architektur</a> ·
  <a href="docs/fehlerbehebung.md">Fehlerbehebung</a> ·
  <a href="CONTRIBUTING.md">Mitwirken</a>
</p>

---

## Was pBlock macht

Es blockiert Netzwerkanfragen an bekannte Werbe-, Tracking- und
Schadsoftware-Domains, bevor sie überhaupt hinausgehen, und blendet die leeren
Flächen aus, die davon zurückbleiben. Das war es im Kern.

Was es **nicht** macht: Es sammelt keine Daten, überträgt nichts an einen Server,
führt keinen nachgeladenen Code aus und pflegt keine Liste bezahlter Ausnahmen.

## Funktionen

|                         |                                                                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Drei Schutzstufen**   | Ein Regler von „Minimal“ bis „Maximum“. Wer mehr Kontrolle will, schaltet in den Expertenmodus und steuert jede Kategorie und Unterkategorie einzeln. |
| **Element-Picker**      | Störendes anklicken und dauerhaft ausblenden. Zeigt vorher, wie viele Elemente betroffen wären, und warnt bei zu breiten Selektoren.                  |
| **Filterlisten**        | EasyList, EasyPrivacy, EasyList Germany, Peter Lowe und URLhaus lassen sich zuschalten. Sie werden heruntergeladen und lokal in Regeln übersetzt.     |
| **Ausnahmen pro Seite** | Ein Klick nimmt eine Website vom Blockieren aus, inklusive aller Subdomains.                                                                          |
| **Statistik**           | Blockierte Anfragen nach Tag, Stunde und Kategorie. Ausschließlich lokal, jederzeit löschbar.                                                         |
| **Diagnose**            | Selbsttest für Regeln, Speicher und Filterlisten. Herunterladbarer Bericht für Fehlermeldungen — ohne besuchte Adressen.                              |
| **Tastenkürzel**        | Schutz umschalten, Seite pausieren, Element-Picker starten.                                                                                           |

## Installation

### Aus dem Chrome Web Store

[pBlock im Chrome Web Store](https://chromewebstore.google.com/detail/amcmnaimcdhjfdpbcgbiaffjgneebona)

Die dort veröffentlichte Fassung kann hinter dem Stand auf GitHub liegen, solange
die Prüfung durch Google läuft.

### Aus dem Quellcode

Voraussetzung: Node.js 20 oder neuer.

```bash
git clone https://github.com/philppplik/pBlock.git
cd pBlock
npm install
npm run build
```

Danach in Chrome:

1. `chrome://extensions` öffnen
2. Entwicklermodus einschalten
3. „Entpackte Erweiterung laden“ und den Ordner **`dist/`** auswählen

## Schutzstufen

| Stufe        | Was blockiert wird                        | Wann sie passt                                      |
| ------------ | ----------------------------------------- | --------------------------------------------------- |
| **Aus**      | nichts                                    | Zum kurzen Gegentesten                              |
| **Minimal**  | Werbung, Schadsoftware                    | Wenn viele empfindliche Seiten im Spiel sind        |
| **Standard** | zusätzlich Tracker                        | Für den Alltag empfohlen                            |
| **Hoch**     | zusätzlich Social Media, störende Widgets | Wenn einzelne Ausnahmen in Ordnung sind             |
| **Maximum**  | zusätzlich Hersteller-Telemetrie          | Wenn Gründlichkeit wichtiger ist als Bequemlichkeit |

Die Stufe steuert nur die Kategorien. Feineinstellungen auf Unterkategorie-Ebene
bleiben erhalten, wenn man den Regler bewegt.

## Privatsphäre

pBlock erhebt **keine** personenbezogenen Daten.

- Kein Analyse-Dienst, keine Kennung, kein Zähler.
- Kein aufgezeichneter Verlauf. Die Statistik zählt Treffer, nicht Seitenaufrufe.
- Keine Übertragung an einen Server des Anbieters — es gibt keinen.
- Die einzigen ausgehenden Verbindungen sind Filterlisten, die du selbst
  einschaltest. Dabei wird eine öffentliche Textdatei geladen, ohne Cookies und
  ohne Kennung.

Vollständig in der [Datenschutzerklärung](https://philppplik.github.io/pBlock/datenschutz.html).

## Technik

- **Manifest V3** mit `declarativeNetRequest` — die Erweiterung hinterlegt Regeln
  und bekommt die Anfragen selbst nie zu sehen.
- **Gebündelte Domains:** Statt einer Regel pro Domain fasst pBlock ganze Listen
  über `requestDomains` zusammen. Aus rund 200 Einzelregeln werden unter 20.
- **Keine dynamische Codeausführung.** Kein `eval`, kein `new Function`, kein
  nachgeladenes Skript. Der Build bricht ab, wenn so etwas ins Paket gerät.
- **`world: MAIN`** für den Eingriff in die Seitenumgebung — als statische Datei
  im Paket, nicht als übergebener Quelltext.
- **Keine Fremdbibliothek zur Laufzeit.** Alles, was ausgeliefert wird, steht in
  diesem Repository.

Ausführlich in [`docs/architektur.md`](docs/architektur.md).

## Entwicklung

```bash
npm run build          # nach dist/ bauen
npm run build:watch    # bei Änderungen neu bauen
npm test               # Tests
npm run test:coverage  # Tests mit Abdeckungsbericht
npm run lint           # ESLint
npm run verify         # alles zusammen — läuft so auch in der CI
```

Aufbau:

```
src/core/         Plattformneutrale Logik. Kein chrome, kein DOM. Vollständig getestet.
src/background/   Service Worker
src/content/      Content-Scripts
src/ui/           Popup, Einstellungen, Einrichtung
tests/            Vitest-Tests
website/          Projektseite (GitHub Pages)
docs/             Dokumentation
```

Details in [`CONTRIBUTING.md`](CONTRIBUTING.md) und
[`docs/entwicklung.md`](docs/entwicklung.md).

## Dokumentation

| Dokument                                          | Inhalt                                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [Architektur](docs/architektur.md)                | Aufbau, Datenfluss, die wichtigsten Entscheidungen und ihre Begründung                  |
| [Entwicklung](docs/entwicklung.md)                | Einrichtung, Build, Tests, Veröffentlichung                                             |
| [Filter](docs/filter.md)                          | Wie Regeln entstehen, wie Filterlisten geparst werden, was bewusst nicht blockiert wird |
| [Fehlerbehebung](docs/fehlerbehebung.md)          | Wenn etwas nicht funktioniert                                                           |
| [Qualitätssicherung](docs/qualitaetssicherung.md) | Testabdeckung und manuelle Prüfliste vor jedem Release                                  |
| [Changelog](CHANGELOG.md)                         | Was sich wann geändert hat                                                              |
| [Sicherheit](SECURITY.md)                         | Lücken melden                                                                           |
| [Danksagung](CREDITS.md)                          | Filterquellen und Lizenzen Dritter                                                      |

## Etwas funktioniert nicht?

- [Fehlerbehebung durchgehen](docs/fehlerbehebung.md)
- [Issue eröffnen](https://github.com/philppplik/pBlock/issues/new/choose) — am
  besten mit dem Diagnosebericht aus den Einstellungen
- Sicherheitslücken bitte **nicht** öffentlich: siehe [SECURITY.md](SECURITY.md)

## Lizenz

[MIT](LICENSE) — Philipp Paulik

Filterquellen und Lizenzen Dritter in [CREDITS.md](CREDITS.md).
