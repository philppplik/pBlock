# Fehlerbehebung

Diese Seite richtet sich an Nutzer. Für Entwicklungsfragen siehe
[`entwicklung.md`](entwicklung.md).

## Zuerst: der Selbsttest

Einstellungen öffnen → **Diagnose** → **„Selbsttest starten“**.

In wenigen Sekunden wird geprüft, ob der Hauptschalter an ist, ob sich die Regeln
anwenden lassen, ob sie tatsächlich im Browser hinterlegt sind, wie voll der
Speicher ist und ob eine Filterliste einen Fehler gemeldet hat.

Meldet der Test ein Problem, steht die Ursache gleich daneben.

---

## Eine Website funktioniert nicht

Das ist mit Abstand der häufigste Fall. Der Reihe nach:

### 1. Seite kurz pausieren

Auf das pBlock-Symbol klicken und den Regler neben der Adresse umlegen. Die Seite
wird neu geladen.

- **Funktioniert jetzt alles?** Es liegt an pBlock — weiter bei Schritt 2.
- **Immer noch kaputt?** Es liegt nicht an pBlock. Der Regler kann wieder
  zurückgestellt werden.

Tastenkürzel: <kbd>Alt</kbd> + <kbd>Umschalt</kbd> + <kbd>P</kbd>

### 2. Schutzstufe senken

Einstellungen → **Filter** → eine Stufe niedriger wählen, Seite neu laden.

Hilft schon „Hoch“ statt „Maximum“, liegt es an der Hersteller-Telemetrie. Hilft
erst „Standard“, sind Social-Media-Filter oder störende Widgets die Ursache.

### 3. Einzelne Unterfilter abschalten

Im Expertenmodus (Einstellungen → Übersicht → Anzeigemodus → Experte) lassen sich
einzelne Unterfilter gezielt abschalten. Die häufigsten Kandidaten:

| Unterfilter             | Bricht typischerweise                                                  |
| ----------------------- | ---------------------------------------------------------------------- |
| **Fehler-Tracking**     | Web-Apps, die ihre Fehlerbehandlung darauf stützen (standardmäßig aus) |
| **Facebook / Meta**     | „Mit Facebook anmelden“, eingebettete Kommentare                       |
| **Marketing-Analytics** | Chat-Fenster, Formulare mit Nachverfolgung                             |
| **Werbemessung**        | Videoplayer mit Werbeintegration                                       |

### 4. Cosmetic-Filter abschalten

Verschwinden Teile der Seite, die keine Werbung sind, liegt es am Ausblenden und
nicht am Blockieren: Einstellungen → Filter → **Cosmetic-Filter** aus.

### 5. Ausnahme dauerhaft eintragen

Wenn eine Seite regelmäßig gebraucht wird: Einstellungen → **Ausnahmen** →
Adresse eintragen. Subdomains sind eingeschlossen — `beispiel.de` deckt auch
`shop.beispiel.de` ab.

### Und dann bitte melden

Damit es für andere behoben wird:
[Issue eröffnen](https://github.com/philppplik/pBlock/issues/new?template=01-seite-kaputt.yml).
Hilfreich ist die Angabe, welcher der Schritte oben geholfen hat.

---

## Der Zähler bleibt auf null

**Meistens ist das kein Fehler.** Chrome liefert die genaue Trefferzählung nur
für entpackt geladene Erweiterungen. In der Fassung aus dem Web Store fragt
pBlock den aktiven Tab getaktet ab — das dauert **bis zu einer Minute**, bis die
erste Zahl erscheint.

Prüfen unter Einstellungen → Diagnose → Zeile **„Trefferzählung“**:

- „exakt (Entwicklungsmodus)“ → jeder Treffer wird sofort gezählt
- „getaktet über den aktiven Tab“ → normal für die Store-Fassung

Bleibt es nach mehreren Minuten Surfen bei null:

1. Selbsttest ausführen
2. Prüfen, ob der Hauptschalter an ist
3. Prüfen, ob die aktuelle Seite versehentlich in den Ausnahmen steht

---

## Werbung wird nicht blockiert

### Stufe erhöhen

Auf „Minimal“ werden nur Werbung und Schadsoftware blockiert. „Standard“ oder
höher deckt deutlich mehr ab.

### Filterlisten einschalten

Die mitgelieferten Filter decken die verbreitetsten Dienste ab — mehr nicht. Für
breite Abdeckung: Einstellungen → **Filterlisten** → EasyList und EasyPrivacy
einschalten. Der erste Download dauert einige Sekunden.

### Werbung auf derselben Domain

Liefert eine Website ihre Werbung von ihrer eigenen Domain aus, lässt sie sich
nicht blockieren, ohne die Seite selbst zu blockieren. Dafür gibt es den
**Element-Picker**: Rechtsklick auf die Anzeige → „Element auf dieser Seite
blockieren“.

### Prüfen, ob überhaupt Regeln aktiv sind

Diagnose → **„Dynamische Regeln“**. Steht dort 0, obwohl der Hauptschalter an
ist, liegt ein echter Fehler vor — bitte melden.

---

## „Regeln wurden wegen des Browser-Limits verworfen“

Chrome begrenzt die Anzahl gleichzeitig aktiver Regeln. Wer viele große
Filterlisten einschaltet, überschreitet das Kontingent.

pBlock kürzt in dem Fall **ausschließlich** Regeln aus Filterlisten. Ausnahmen,
eigene Regeln und die mitgelieferten Kategorien bleiben vollständig erhalten.

Abhilfe: Eine Liste abschalten. EasyList und EasyPrivacy zusammen decken den
Großteil ab; zusätzliche Listen bringen oft weniger als sie kosten.

Die genaue Zahl steht unter Diagnose → „Dynamische Regeln“.

---

## Eine Filterliste lässt sich nicht aktualisieren

Der Fehler steht direkt an der Liste. Häufige Ursachen:

| Meldung                               | Bedeutung                                            |
| ------------------------------------- | ---------------------------------------------------- |
| Zeitüberschreitung beim Herunterladen | Server nicht erreichbar oder Verbindung sehr langsam |
| Server antwortete mit HTTP 404        | Die Liste ist umgezogen — bitte melden               |
| Server antwortete mit HTTP 429        | Zu viele Anfragen; später erneut versuchen           |
| Die Liste ist größer als erlaubt      | Die Quelle hat sich unerwartet stark vergrößert      |

pBlock versucht es alle sechs Stunden von selbst erneut. Die zuletzt erfolgreich
heruntergeladene Fassung bleibt so lange in Kraft.

---

## Der Element-Picker startet nicht

Der Picker funktioniert nicht auf:

- `chrome://`-Seiten und internen Browserseiten
- dem Chrome Web Store
- PDF-Ansichten
- Seiten, die vor der Installation von pBlock geöffnet wurden

Im letzten Fall hilft ein Neuladen der Seite.

---

## Einstellungen sind verschwunden

### Nach einem Update

pBlock 5 übernimmt die Einstellungen aus Version 4 automatisch. Sollte etwas
fehlen, lässt es sich neu setzen — die Datenübernahme läuft nur einmal.

### Nach einem Browser-Wechsel

pBlock nutzt bewusst **keine** Geräte-Synchronisation. Der Grund steht in
[`architektur.md`](architektur.md): Chromes Sync-Speicher hätte die Daten bei
Überschreitung stillschweigend verworfen.

Zum Übertragen: Einstellungen → **Sicherung** → „Einstellungen exportieren“, die
Datei auf das andere Gerät bringen und dort importieren.

### Nach einem Import

Der Import ersetzt die bisherigen Einstellungen vollständig. Wer die alten
zurückwill, braucht eine vorherige Sicherung.

---

## Immer noch ein Problem?

1. **Diagnosebericht erstellen:** Einstellungen → Diagnose →
   „Diagnosebericht herunterladen“
2. **Issue eröffnen:**
   [Fehler melden](https://github.com/philppplik/pBlock/issues/new/choose)
3. **Bericht anhängen**

Der Bericht enthält Versionsnummer, Regelzahlen, Speicherauslastung, den Zustand
der Filterlisten und die letzten Protokolleinträge. Er enthält **keine** besuchten
Adressen und keine persönlichen Daten — man kann ihn bedenkenlos veröffentlichen.
