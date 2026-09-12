/**
 * Schnürt aus `dist/` ein ZIP-Archiv für den Chrome Web Store.
 *
 * ## Warum ein eigener Archivierer
 *
 * Die naheliegende Lösung wäre, das Systemwerkzeug aufzurufen — `zip` unter
 * Linux, `Compress-Archive` unter Windows. Beides hat Nachteile:
 *
 * - `Compress-Archive` schreibt **Backslashes** als Pfadtrenner. Die
 *   ZIP-Spezifikation (APPNOTE, Abschnitt 4.4.17.1) verlangt ausdrücklich
 *   Forward Slashes. Manche Entpacker kommen damit zurecht, andere legen dann
 *   Dateien mit Backslash im Namen an statt Verzeichnisse. Beim Store-Upload
 *   ist das ein unnötiges Risiko.
 * - `zip` fehlt unter Windows in der Regel ganz, auch in Git Bash.
 * - Zwei Codepfade bedeuten zwei mögliche Ergebnisse für dasselbe Release.
 *
 * Ein ZIP mit Deflate zu schreiben sind rund 100 Zeilen und `node:zlib`. Das ist
 * weniger Aufwand als die Fallstricke der Systemwerkzeuge zu umschiffen — und
 * liefert auf jeder Plattform Byte für Byte dasselbe Archiv.
 *
 * ## Reproduzierbarkeit
 *
 * Alle Einträge bekommen einen festen Zeitstempel. Zweimal dasselbe `dist/`
 * ergibt damit zweimal dasselbe Archiv, was Vergleiche zwischen einem lokalen
 * Build und dem aus der CI erst möglich macht.
 */

import { deflateRawSync } from 'node:zlib';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

/**
 * Fester Zeitstempel für alle Einträge: 2020-01-01 00:00:00.
 * Der Wert ist beliebig, nur eben nicht „jetzt“.
 */
const FIXED_DATE = new Date(2020, 0, 1, 0, 0, 0);

/** CRC32-Tabelle, einmalig berechnet. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value;
  }
  return table;
})();

/**
 * Berechnet die CRC32-Prüfsumme.
 * @param {Buffer} buffer
 * @returns {number} Vorzeichenlos.
 */
function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

/**
 * Wandelt ein Datum in die beiden 16-Bit-Felder des DOS-Formats.
 * @param {Date} date
 * @returns {{time: number, date: number}}
 */
function toDosDateTime(date) {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f);
  const dosDate =
    ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: dosDate };
}

/**
 * Sammelt alle Dateien eines Verzeichnisses rekursiv.
 * @param {string} dir
 * @param {string} [prefix='']
 * @returns {Promise<Array<{absolute: string, entry: string}>>} `entry` nutzt immer Forward Slashes.
 */
async function collectFiles(dir, prefix = '') {
  /** @type {Array<{absolute: string, entry: string}>} */
  const files = [];

  for (const name of (await readdir(dir)).sort()) {
    const absolute = path.join(dir, name);
    // Der Eintragsname im Archiv wird bewusst aus Strings gebaut statt über
    // `path.join` — sonst landen unter Windows wieder Backslashes darin.
    const entry = prefix ? `${prefix}/${name}` : name;

    if ((await stat(absolute)).isDirectory()) {
      files.push(...(await collectFiles(absolute, entry)));
    } else {
      files.push({ absolute, entry });
    }
  }

  return files;
}

/**
 * Baut das Archiv.
 * @param {Array<{absolute: string, entry: string}>} files
 * @returns {Promise<Buffer>}
 */
async function buildZip(files) {
  const { time, date } = toDosDateTime(FIXED_DATE);
  /** @type {Buffer[]} */
  const parts = [];
  /** @type {Buffer[]} */
  const central = [];
  let offset = 0;

  for (const file of files) {
    const contents = await readFile(file.absolute);
    const compressed = deflateRawSync(contents, { level: 9 });
    const nameBuffer = Buffer.from(file.entry, 'utf8');
    const checksum = crc32(contents);

    // Bit 11 kennzeichnet den Dateinamen als UTF-8. Ohne das Flag deuten
    // Entpacker ihn als CP437 — Umlaute werden dann zu Kauderwelsch.
    const flags = 0x0800;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // benötigte Version
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(8, 8); // Deflate
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(contents.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28); // keine Extra-Felder

    parts.push(localHeader, nameBuffer, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // erzeugende Version
    centralHeader.writeUInt16LE(20, 6); // benötigte Version
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(contents.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30); // Extra
    centralHeader.writeUInt16LE(0, 32); // Kommentar
    centralHeader.writeUInt16LE(0, 34); // Datenträger
    centralHeader.writeUInt16LE(0, 36); // interne Attribute
    centralHeader.writeUInt32LE(0o644 << 16, 38); // externe Attribute (Unix-Rechte)
    centralHeader.writeUInt32LE(offset, 42);

    central.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + compressed.length;
  }

  const centralBuffer = Buffer.concat(central);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // Datenträgernummer
  end.writeUInt16LE(0, 6); // Datenträger mit zentralem Verzeichnis
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // Archivkommentar

  return Buffer.concat([...parts, centralBuffer, end]);
}

async function main() {
  if (!existsSync(DIST)) {
    console.error('dist/ fehlt. Zuerst `npm run build` ausführen.');
    process.exit(1);
  }

  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const archiveName = `pblock-${pkg.version}.zip`;
  const archivePath = path.join(ROOT, archiveName);

  const files = await collectFiles(DIST);

  if (!files.some((file) => file.entry === 'manifest.json')) {
    console.error('manifest.json liegt nicht auf oberster Ebene — der Store lehnt das ab.');
    process.exit(1);
  }

  const archive = await buildZip(files);
  await writeFile(archivePath, archive);

  console.log(`Archiv erstellt: ${archiveName}`);
  console.log(`  ${files.length} Dateien, ${(archive.length / 1024).toFixed(1)} KB`);
}

main().catch((error) => {
  console.error('Archiv konnte nicht erstellt werden:', error);
  process.exit(1);
});
