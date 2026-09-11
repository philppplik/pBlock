/**
 * Prüft das gebaute Manifest und das Paket.
 *
 * Läuft in CI vor jedem Release. Die Prüfungen sind aus den Ablehnungsgründen
 * des Chrome Web Store und aus konkreten Fehlern der Version 4 abgeleitet — sie
 * sollen verhindern, dass genau diese Fehler ein zweites Mal ausgeliefert werden.
 */

import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

/** @type {string[]} */
const errors = [];
/** @type {string[]} */
const warnings = [];

/**
 * @param {boolean} condition
 * @param {string} message
 */
function require(condition, message) {
  if (!condition) errors.push(message);
}

/**
 * @param {boolean} condition
 * @param {string} message
 */
function prefer(condition, message) {
  if (!condition) warnings.push(message);
}

/**
 * Berechtigungen, die eine manuelle Prüfung im Web Store auslösen oder dem
 * Nutzer eine abschreckende Warnung zeigen.
 */
const SENSITIVE_PERMISSIONS = new Set([
  'tabs',
  'webRequest',
  'webRequestBlocking',
  'history',
  'bookmarks',
  'cookies',
  'downloads',
  'management',
  'debugger',
  'proxy',
  'nativeMessaging',
]);

async function main() {
  if (!existsSync(DIST)) {
    console.error('dist/ fehlt. Zuerst `npm run build` ausführen.');
    process.exit(1);
  }

  const manifestPath = path.join(DIST, 'manifest.json');
  require(existsSync(manifestPath), 'manifest.json fehlt im Paket.');
  if (errors.length > 0) return report();

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));

  // --- Grundlagen ------------------------------------------------------
  require(manifest.manifest_version === 3, 'manifest_version muss 3 sein.');
  require(/^\d+(\.\d+){0,3}$/.test(
    manifest.version ?? ''
  ), 'version muss aus bis zu vier Zahlen bestehen.');
  require(manifest.version ===
    pkg.version, `Version weicht ab: manifest ${manifest.version}, package.json ${pkg.version}.`);
  require(typeof manifest.description === 'string' &&
    manifest.description.length <=
      132, 'description fehlt oder ist länger als die vom Store erlaubten 132 Zeichen.');
  require(manifest.default_locale === undefined, 'default_locale darf nicht null sein.');

  // --- Berechtigungen --------------------------------------------------
  const permissions = manifest.permissions ?? [];
  for (const permission of permissions) {
    prefer(
      !SENSITIVE_PERMISSIONS.has(permission),
      `Berechtigung "${permission}" löst eine strengere Store-Prüfung aus. Wird sie wirklich gebraucht?`
    );
  }
  require(permissions.includes(
    'declarativeNetRequest'
  ), 'declarativeNetRequest fehlt — ohne sie blockiert nichts.');
  // v4 nutzte onRuleMatchedDebug und getMatchedRules ohne diese Berechtigung.
  // Beide Aufrufe schlugen deshalb dauerhaft fehl.
  require(permissions.includes(
    'declarativeNetRequestFeedback'
  ), 'declarativeNetRequestFeedback fehlt — die Trefferzählung funktioniert dann nicht.');
  require(permissions.includes(
    'alarms'
  ), 'alarms fehlt — im Service Worker gibt es kein setInterval.');
  prefer(
    !permissions.includes('scripting'),
    'scripting wird nicht mehr gebraucht, seit Content-Scripts deklarativ registriert sind.'
  );

  // --- Service Worker ---------------------------------------------------
  require(typeof manifest.background?.service_worker ===
    'string', 'background.service_worker fehlt.');
  const workerPath = path.join(DIST, manifest.background.service_worker);
  require(existsSync(
    workerPath
  ), `Service Worker nicht gefunden: ${manifest.background.service_worker}`);

  // --- Content-Scripts --------------------------------------------------
  for (const entry of manifest.content_scripts ?? []) {
    for (const file of entry.js ?? []) {
      require(existsSync(path.join(DIST, file)), `Content-Script fehlt: ${file}`);
    }
    require(entry.world === 'MAIN' ||
      entry.world === 'ISOLATED', 'Jedes Content-Script sollte seine Welt ausdrücklich benennen.');
  }
  const usesMainWorld = (manifest.content_scripts ?? []).some((entry) => entry.world === 'MAIN');
  if (usesMainWorld) {
    require(Number(manifest.minimum_chrome_version) >=
      111, 'world: MAIN in content_scripts erfordert minimum_chrome_version 111 oder höher.');
  }

  // --- Oberflächenseiten ------------------------------------------------
  const pages = [manifest.action?.default_popup, manifest.options_ui?.page].filter(Boolean);
  for (const page of pages) {
    require(existsSync(path.join(DIST, page)), `Seite fehlt: ${page}`);
  }

  // --- Symbole ----------------------------------------------------------
  for (const [size, file] of Object.entries(manifest.icons ?? {})) {
    require(existsSync(path.join(DIST, file)), `Symbol ${size}px fehlt: ${file}`);
  }
  require(manifest.icons?.['128'] !== undefined, 'Ein 128px-Symbol ist für den Store Pflicht.');

  // --- Sicherheit -------------------------------------------------------
  const csp = manifest.content_security_policy?.extension_pages ?? '';
  prefer(csp.includes("script-src 'self'"), 'Die CSP sollte script-src auf self begrenzen.');
  require(!csp.includes('unsafe-eval') &&
    !csp.includes('unsafe-inline'), 'Die CSP darf weder unsafe-eval noch unsafe-inline enthalten.');
  prefer(
    manifest.web_accessible_resources === undefined,
    'web_accessible_resources macht Dateien für jede Website sichtbar und erlaubt das Erkennen der Erweiterung.'
  );

  // --- Gebündelter Code -------------------------------------------------
  // Dynamische Codeausführung ist in MV3 unzulässig. v4 schickte Skript-Quelltext
  // an den Service Worker und führte ihn dort mit eval() aus.
  await assertNoDynamicCode(manifest);

  report();
}

/**
 * Sucht in allen gebündelten Skripten nach dynamischer Codeausführung.
 * @param {any} manifest
 */
async function assertNoDynamicCode(manifest) {
  const files = [
    manifest.background?.service_worker,
    ...(manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []),
  ].filter(Boolean);

  const patterns = [
    { regex: /\beval\s*\(/, label: 'eval(' },
    { regex: /new\s+Function\s*\(/, label: 'new Function(' },
    { regex: /setTimeout\s*\(\s*["'`]/, label: 'setTimeout mit String' },
  ];

  for (const file of files) {
    const full = path.join(DIST, file);
    if (!existsSync(full)) continue;

    const source = await readFile(full, 'utf8');
    for (const pattern of patterns) {
      require(!pattern.regex.test(
        source
      ), `${file} enthält ${pattern.label} — in Manifest V3 unzulässig.`);
    }

    const size = (await stat(full)).size;
    prefer(size < 600 * 1024, `${file} ist ${Math.round(size / 1024)} KB groß.`);
  }
}

function report() {
  for (const warning of warnings) console.warn(`  Hinweis:  ${warning}`);
  for (const error of errors) console.error(`  FEHLER:   ${error}`);

  if (errors.length > 0) {
    console.error(`\nManifest-Prüfung fehlgeschlagen: ${errors.length} Fehler.`);
    process.exit(1);
  }

  console.log(
    `Manifest-Prüfung bestanden${warnings.length > 0 ? ` (${warnings.length} Hinweis(e))` : ''}.`
  );
}

main().catch((error) => {
  console.error('Prüfung abgebrochen:', error);
  process.exit(1);
});
