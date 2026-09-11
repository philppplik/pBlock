# Änderung

<!-- Was ändert sich und warum? Bitte das Warum nicht auslassen — der Code zeigt
     bereits das Was, aber nicht die Überlegung dahinter. -->

## Art der Änderung

- [ ] Fehlerbehebung
- [ ] Neue Funktion
- [ ] Refactoring ohne Verhaltensänderung
- [ ] Dokumentation
- [ ] Build, CI oder Werkzeuge

## Betroffene Bereiche

- [ ] `src/core/` — Logik
- [ ] `src/background/` — Service Worker
- [ ] `src/content/` — Content-Scripts
- [ ] `src/ui/` — Oberfläche
- [ ] `website/` — Projektseite
- [ ] Dokumentation

## Prüfung

- [ ] `npm run verify` läuft ohne Fehler durch
- [ ] Neue oder geänderte Logik in `src/core/` ist durch Tests abgedeckt
- [ ] Die Erweiterung wurde entpackt in Chrome geladen und die betroffene Funktion
      tatsächlich bedient

<!-- Bei Änderungen an der Oberfläche bitte einen Screenshot anhängen,
     bei Änderungen an Filtern bitte die betroffenen Domains nennen. -->

## Auswirkungen auf bestehende Installationen

- [ ] Keine — Einstellungen und gespeicherte Daten bleiben unverändert gültig
- [ ] Schema geändert; die Migration in `src/core/settings.js` wurde angepasst und getestet
- [ ] Neue Berechtigung im Manifest (bitte im Text begründen)

## Zusammenhängende Issues

<!-- z. B. Behebt #42 -->
