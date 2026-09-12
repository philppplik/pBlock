/**
 * Build-Skript.
 *
 * Bündelt die ES-Module aus `src/` nach `dist/` und legt die statischen Dateien
 * daneben. Ergebnis ist ein Verzeichnis, das sich unter `chrome://extensions`
 * direkt als entpackte Erweiterung laden lässt.
 *
 * Warum überhaupt ein Build: Content-Scripts unterstützen keine ES-Module. v4
 * löste das über globale Variablen und `importScripts` — jede Datei musste
 * wissen, in welcher Reihenfolge sie geladen wird, und nichts davon war für
 * einen Test importierbar. Mit esbuild bleibt der Quelltext modular, und im
 * Paket landen eigenständige Dateien.
 *
 * Aufruf:
 *   node scripts/build.mjs            einmalig
 *   node scripts/build.mjs --watch    beobachtend
 */

import { build, context } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

const isWatch = process.argv.includes('--watch');
const isProduction = process.argv.includes('--production') || !isWatch;

/**
 * Einstiegspunkte des Bundles.
 *
 * Jeder wird eigenständig gebündelt. Gemeinsamer Code aus `src/core` landet
 * dadurch mehrfach im Paket — das ist gewollt: Code-Splitting würde zusätzliche
 * Ladevorgänge erzeugen, und in einem Content-Script ist eine einzelne,
 * eigenständige Datei das Schnellste und Robusteste.
 */
const ENTRY_POINTS = [
  { in: 'background/service-worker.js', out: 'background/service-worker', format: 'esm' },
  { in: 'content/cosmetic.js', out: 'content/cosmetic', format: 'iife' },
  { in: 'content/element-picker.js', out: 'content/element-picker', format: 'iife' },
  { in: 'content/main-world.js', out: 'content/main-world', format: 'iife' },
  { in: 'ui/popup/popup.js', out: 'ui/popup/popup', format: 'iife' },
  { in: 'ui/options/options.js', out: 'ui/options/options', format: 'iife' },
  { in: 'ui/onboarding/onboarding.js', out: 'ui/onboarding/onboarding', format: 'iife' },
];

/**
 * Statische Dateien und Verzeichnisse, die unverändert übernommen werden.
 *
 * `images/` fehlt hier bewusst: Das Verzeichnis enthält Logos in mehreren
 * Varianten und fünf Store-Screenshots, zusammen rund 400 KB. Weder das Manifest
 * noch eine Oberflächenseite verweist darauf — es sind Material für README und
 * Store-Eintrag, nicht für die Erweiterung. In v4 wurde alles mit ausgeliefert.
 */
const STATIC_COPIES = [
  { from: 'manifest.json', to: 'manifest.json' },
  { from: '../icons', to: 'icons' },
  { from: 'ui/popup/index.html', to: 'ui/popup/index.html' },
  { from: 'ui/popup/popup.css', to: 'ui/popup/popup.css' },
  { from: 'ui/options/index.html', to: 'ui/options/index.html' },
  { from: 'ui/options/options.css', to: 'ui/options/options.css' },
  { from: 'ui/onboarding/index.html', to: 'ui/onboarding/index.html' },
  { from: 'ui/onboarding/onboarding.css', to: 'ui/onboarding/onboarding.css' },
  { from: 'ui/shared/tokens.css', to: 'ui/shared/tokens.css' },
  { from: 'ui/shared/base.css', to: 'ui/shared/base.css' },
];

/**
 * Gemeinsame esbuild-Optionen.
 * @param {{in: string, out: string, format: string}} entry
 * @returns {import('esbuild').BuildOptions}
 */
function optionsFor(entry) {
  return {
    entryPoints: [path.join(SRC, entry.in)],
    outfile: path.join(DIST, `${entry.out}.js`),
    bundle: true,
    format: entry.format,
    // Chrome 111 ist die Untergrenze aus dem Manifest (erste Version mit
    // `world: MAIN` für deklarierte Content-Scripts).
    target: 'chrome111',
    platform: 'browser',
    charset: 'utf8',
    legalComments: 'none',
    minify: isProduction,
    sourcemap: isProduction ? false : 'inline',
    define: {
      'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
    },
    logLevel: 'warning',
  };
}

/**
 * Kopiert die statischen Dateien.
 */
async function copyStatic() {
  for (const item of STATIC_COPIES) {
    const source = path.resolve(SRC, item.from);
    const target = path.join(DIST, item.to);

    if (!existsSync(source)) {
      console.warn(`  ! übersprungen (fehlt): ${item.from}`);
      continue;
    }

    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, { recursive: true });
  }
}

/**
 * Schreibt das Manifest mit der Version aus der package.json.
 *
 * Damit gibt es genau eine Stelle, an der die Versionsnummer gepflegt wird.
 * In v4 standen in `manifest.json` 4.0.0 und im README-Badge 3.0.2.
 */
async function syncManifestVersion() {
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const manifestPath = path.join(DIST, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  manifest.version = pkg.version;
  // `default_locale: null` ist nur ein Platzhalter in der Quelle und im
  // ausgelieferten Manifest ungültig.
  if (manifest.default_locale === null) delete manifest.default_locale;

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return pkg.version;
}

/**
 * Baut alles einmal.
 */
async function runBuild() {
  const startedAt = Date.now();

  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  await Promise.all(ENTRY_POINTS.map((entry) => build(optionsFor(entry))));
  await copyStatic();
  const version = await syncManifestVersion();

  console.log(
    `pBlock ${version} gebaut nach dist/ in ${Date.now() - startedAt} ms ` +
      `(${isProduction ? 'Produktion' : 'Entwicklung'})`
  );
}

/**
 * Startet den Beobachtungsmodus.
 */
async function runWatch() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  await copyStatic();
  await syncManifestVersion();

  const contexts = await Promise.all(ENTRY_POINTS.map((entry) => context(optionsFor(entry))));
  await Promise.all(contexts.map((ctx) => ctx.watch()));

  console.log('Beobachte src/ … (Strg+C zum Beenden)');
  console.log('Hinweis: Statische Dateien werden nur beim Start kopiert.');
}

try {
  if (isWatch) await runWatch();
  else await runBuild();
} catch (error) {
  console.error('Build fehlgeschlagen:', error);
  process.exit(1);
}
