# pBlock v5 — Arbeitsstand

Branch: `feat/v5-architektur-qualitaet-website` (von `origin/main`)

## Erledigt

1. **Commit 97f2379** — `src/core/` (plattformneutrale Logik) + Toolchain
   (npm, ESLint 9 flat, Prettier, Vitest). 289 Tests, 97 % Statements.
2. **Commit 5ed1fe2** — `src/background/`, `src/content/`, `src/ui/`,
   `src/manifest.json`, esbuild-Build, Manifest-Validator. v4-Dateien gelöscht.

## Offen

3. Website für GitHub Pages (`website/`, statisch, ohne Firebase)
4. `.github/`: CI-, Pages- und Release-Workflow, Issue-/PR-Vorlagen,
   Dependabot, CODEOWNERS, SECURITY.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md
5. Deutsche Dokumentation: README, `docs/*`, CHANGELOG.md, CREDITS.md
6. Pull Request eröffnen

## Wichtige Entscheidungen

- **Storage:** nur `chrome.storage.local`. `sync` hat 8 KB pro Eintrag — v4 lief
  dagegen und verlor Daten stillschweigend. Ausgleich: Export/Import.
- **DNR:** dynamische Regeln mit `requestDomains`-Bündelung (aus ~200 Einzelregeln
  werden <20). Whitelist über `allowAllRequests` mit Priorität 1000.
- **Scriptlets:** kein `eval` mehr, stattdessen Content-Script mit `world: MAIN`
  (daher `minimum_chrome_version: 111`).
- **Statistik:** `days` ist die einzige Wahrheit; „heute“/„diese Woche“ werden
  berechnet. Kein Rollover-Code mehr.

## Umgebung

- GateGuard-Hook verlangt vor jeder neuen Datei einen 4-Punkte-Faktenblock
  (Importeure, Dublettenprüfung, Datenschema, wörtliches Nutzerzitat).
- `npm run verify` = lint + format:check + test + build + validate:manifest
