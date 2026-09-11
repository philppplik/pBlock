/**
 * Schnürt aus `dist/` ein ZIP-Archiv für den Chrome Web Store.
 *
 * Bewusst ohne zusätzliche Abhängigkeit: Für ein reines Store-Upload-Archiv
 * reicht das plattformeigene Werkzeug, und jede Abhängigkeit weniger in der
 * Build-Kette ist eine Angriffsfläche weniger.
 */

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

if (!existsSync(DIST)) {
  console.error('dist/ fehlt. Zuerst `npm run build` ausführen.');
  process.exit(1);
}

const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
const archiveName = `pblock-${pkg.version}.zip`;
const archivePath = path.join(ROOT, archiveName);

try {
  if (process.platform === 'win32') {
    // PowerShell ist auf jedem unterstützten Windows vorhanden.
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path '${DIST}\\*' -DestinationPath '${archivePath}' -Force`,
      ],
      { stdio: 'inherit' }
    );
  } else {
    execFileSync('zip', ['-r', '-q', archivePath, '.'], { cwd: DIST, stdio: 'inherit' });
  }

  console.log(`Archiv erstellt: ${archiveName}`);
} catch (error) {
  console.error('Archiv konnte nicht erstellt werden:', error.message);
  console.error('Alternativ den Inhalt von dist/ manuell als ZIP packen.');
  process.exit(1);
}
