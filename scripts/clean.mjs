/**
 * Entfernt alle erzeugten Verzeichnisse.
 */

import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = ['dist', 'coverage', 'web-ext-artifacts'];

for (const target of TARGETS) {
  await rm(path.join(ROOT, target), { recursive: true, force: true });
}

console.log(`Entfernt: ${TARGETS.join(', ')}`);
