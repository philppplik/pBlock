# Sicherheit

## Unterstützte Versionen

| Version | Unterstützt                      |
| ------- | -------------------------------- |
| 5.x     | ja                               |
| 4.x     | nein — bitte auf 5 aktualisieren |
| < 4     | nein                             |

## Eine Sicherheitslücke melden

**Bitte nicht über ein öffentliches Issue.** Eine Erweiterung mit Zugriff auf alle
Websites ist ein lohnendes Ziel; eine öffentlich beschriebene Lücke ist sofort für
jeden nutzbar.

Zwei Wege:

1. **Bevorzugt:** [Private Meldung über GitHub Security Advisories](https://github.com/philppplik/pBlock/security/advisories/new)
2. E-Mail an <philipp.l.paulik@gmail.com> mit „pBlock Sicherheit“ im Betreff

### Was in die Meldung gehört

- Welche Art von Problem (z. B. eingeschleustes Skript, Umgehung der Ausnahmen,
  Offenlegung von Daten)
- Betroffene Datei oder Funktion, wenn bekannt
- Eine Schritt-für-Schritt-Anleitung zum Nachstellen
- Was ein Angreifer damit erreichen könnte

### Reaktionszeiten

pBlock ist ein Freizeitprojekt einer einzelnen Person. Realistisch heißt das:

| Schritt                      | Zeitrahmen                      |
| ---------------------------- | ------------------------------- |
| Eingangsbestätigung          | innerhalb von 5 Tagen           |
| Erste Einschätzung           | innerhalb von 14 Tagen          |
| Behebung kritischer Lücken   | Ziel: 30 Tage                   |
| Veröffentlichung der Details | nach der Behebung, in Absprache |

Wer möchte, wird im Advisory namentlich genannt.

## Was besonders zählt

Diese Bereiche haben die größte Tragweite:

- **`src/content/`** — läuft auf jeder besuchten Seite. Ein Fehler hier wirkt
  sich überall aus.
- **`src/content/main-world.js`** — läuft in der JavaScript-Umgebung der Seite.
  Alles, was diese Grenze aufweicht, ist ernst zu nehmen.
- **`src/core/settings.js`** — verarbeitet importierte Dateien. Import ist die
  einzige Stelle, an der fremde Daten ins System kommen.
- **`src/core/filter-parser.js`** — verarbeitet heruntergeladene Filterlisten.
- **`src/manifest.json`** — jede zusätzliche Berechtigung vergrößert den Schaden,
  den ein Fehler anrichten kann.

## Bewusste Entscheidungen

Diese Punkte sind kein Versehen, sondern abgewogen:

- **`<all_urls>` als Host-Berechtigung.** Ein Werbeblocker, der nur auf manchen
  Seiten wirkt, ist keiner. Die Erweiterung liest dabei keine Seiteninhalte aus;
  das Content-Script schreibt nur ein Stylesheet und zählt Treffer.
- **Keine Browser-Synchronisation.** `chrome.storage.sync` erlaubt 8 KB pro
  Eintrag und meldet Überschreitungen nur über `lastError`. Daten still zu
  verlieren ist schlimmer als sie nicht zu synchronisieren.
- **Filterlisten werden zur Laufzeit geladen.** Es handelt sich um Textdateien,
  die geparst und in Regeln übersetzt werden. Ausgeführt wird davon nichts; der
  Parser liegt vollständig im Paket. Die Quell-URLs sind fest hinterlegt und
  werden zusätzlich auf HTTPS geprüft.
- **Keine `eval`, keine `new Function`, kein nachgeladenes Skript.** Der
  Manifest-Validator in `scripts/validate-manifest.mjs` lässt einen Build
  scheitern, der so etwas enthält.

## Außerhalb des Rahmens

- Werbung, die durchrutscht, oder Seiten, die kaputtgehen — das sind
  Filterprobleme, bitte als normales Issue melden.
- Dass eine Website erkennen kann, dass ein Werbeblocker aktiv ist. Das lässt
  sich grundsätzlich nicht vollständig verhindern.
- Angriffe, die bereits vollen Zugriff auf das Gerät des Nutzers voraussetzen.
