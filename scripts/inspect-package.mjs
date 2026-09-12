/**
 * Prüft ein gebautes Store-Archiv, ohne es zu entpacken.
 *
 * Die drei Dinge, an denen ein Upload in den Chrome Web Store scheitert, bevor
 * die eigentliche Prüfung überhaupt beginnt:
 *
 *  1. `manifest.json` liegt nicht auf oberster Ebene, sondern in einem
 *     Unterordner (passiert, wenn man den Ordner statt seines Inhalts packt).
 *  2. Pfadtrenner sind Backslashes statt Forward Slashes. Die ZIP-Spezifikation
 *     verlangt Forward Slashes; manche Entpacker legen sonst Dateien mit
 *     Backslash im Namen an statt Verzeichnisse.
 *  3. Das Archiv ist beschädigt und lässt sich gar nicht lesen.
 *
 * Aufruf: node scripts/inspect-package.mjs [pfad-zum-zip]
 */

import { inflateRawSync } from 'node:zlib';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Findet das neueste Archiv im Projektverzeichnis.
 * @returns {Promise<string|null>}
 */
async function findArchive() {
  const candidates = (await readdir(ROOT)).filter(
    (name) => name.startsWith('pblock-') && name.endsWith('.zip')
  );
  return candidates.sort().pop() ?? null;
}

/**
 * Liest das zentrale Verzeichnis eines ZIP-Archivs.
 * @param {Buffer} buffer
 * @returns {Array<{name: string, compressedSize: number, size: number, offset: number}>}
 */
function readCentralDirectory(buffer) {
  const entries = [];

  for (let i = 0; i < buffer.length - 4; i += 1) {
    if (buffer.readUInt32LE(i) !== 0x02014b50) continue;

    const nameLength = buffer.readUInt16LE(i + 28);
    entries.push({
      name: buffer.toString('utf8', i + 46, i + 46 + nameLength),
      compressedSize: buffer.readUInt32LE(i + 20),
      size: buffer.readUInt32LE(i + 24),
      offset: buffer.readUInt32LE(i + 42),
    });
  }

  return entries;
}

/**
 * Entpackt einen einzelnen Eintrag über seinen Offset.
 * @param {Buffer} buffer
 * @param {{offset: number, compressedSize: number}} entry
 * @returns {Buffer}
 */
function extractEntry(buffer, entry) {
  const nameLength = buffer.readUInt16LE(entry.offset + 26);
  const extraLength = buffer.readUInt16LE(entry.offset + 28);
  const start = entry.offset + 30 + nameLength + extraLength;
  return inflateRawSync(buffer.subarray(start, start + entry.compressedSize));
}

async function main() {
  const argument = process.argv[2];
  const archiveName = argument ?? (await findArchive());

  if (!archiveName) {
    console.error('Kein Archiv gefunden. Zuerst `npm run package` ausführen.');
    process.exit(1);
  }

  const archivePath = path.isAbsolute(archiveName) ? archiveName : path.join(ROOT, archiveName);
  const buffer = await readFile(archivePath);
  const entries = readCentralDirectory(buffer);

  if (entries.length === 0) {
    console.error('Kein zentrales Verzeichnis gefunden — das Archiv ist beschädigt.');
    process.exit(1);
  }

  const problems = [];
  const backslashes = entries.filter((entry) => entry.name.includes('\\'));
  if (backslashes.length > 0) {
    problems.push(`${backslashes.length} Eintrag/Einträge nutzen Backslashes als Pfadtrenner.`);
  }

  const manifest = entries.find((entry) => entry.name === 'manifest.json');
  if (!manifest) {
    problems.push('manifest.json liegt nicht auf oberster Ebene des Archivs.');
  }

  const uncompressed = entries.reduce((sum, entry) => sum + entry.size, 0);

  console.log(`Archiv:     ${path.basename(archivePath)}`);
  console.log(`Größe:      ${(buffer.length / 1024).toFixed(1)} KB gepackt`);
  console.log(`            ${(uncompressed / 1024).toFixed(1)} KB entpackt`);
  console.log(`Einträge:   ${entries.length}`);
  console.log('');

  for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(
      `  ${entry.name.padEnd(34)} ${String(Math.ceil(entry.size / 1024)).padStart(5)} KB`
    );
  }

  if (manifest) {
    const parsed = JSON.parse(extractEntry(buffer, manifest).toString('utf8'));
    console.log('');
    console.log('manifest.json liest sich sauber:');
    console.log(`  Name:           ${parsed.name} ${parsed.version}`);
    console.log(`  Manifest:       V${parsed.manifest_version}`);
    console.log(`  Ab Chrome:      ${parsed.minimum_chrome_version}`);
    console.log(`  Berechtigungen: ${(parsed.permissions ?? []).join(', ')}`);

    // Jede im Manifest genannte Datei muss auch im Archiv liegen.
    const referenced = [
      parsed.background?.service_worker,
      parsed.action?.default_popup,
      parsed.options_ui?.page,
      ...Object.values(parsed.icons ?? {}),
      ...(parsed.content_scripts ?? []).flatMap((script) => script.js ?? []),
    ].filter(Boolean);

    const names = new Set(entries.map((entry) => entry.name));
    const missing = referenced.filter((file) => !names.has(file));
    if (missing.length > 0) {
      problems.push(`Im Manifest referenziert, aber nicht im Archiv: ${missing.join(', ')}`);
    }
  }

  console.log('');
  if (problems.length > 0) {
    for (const problem of problems) console.error(`  FEHLER: ${problem}`);
    process.exit(1);
  }
  console.log('Archiv ist bereit für den Chrome Web Store.');
}

main().catch((error) => {
  console.error('Prüfung fehlgeschlagen:', error);
  process.exit(1);
});
