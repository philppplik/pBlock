/**
 * Prüft die echten Filterlisten gegen den eigenen Parser.
 *
 * ## Warum es dieses Skript gibt
 *
 * In v5.0.0 schlugen bei einem Nutzer alle fünf Listen mit „Failed to fetch“
 * fehl — innerhalb von vier Millisekunden. So schnell scheitert kein
 * Netzwerkzugriff. Die Ursache war eine aus EasyList Germany erzeugte Regel, die
 * jede HTTPS-Anfrage blockierte, einschließlich der Downloads der Erweiterung
 * selbst.
 *
 * Unit-Tests hätten das nicht gefunden: Die auslösende Zeile stand in einer
 * fremden Liste, die sich jede Woche ändert. Dieses Skript schließt die Lücke,
 * indem es die echten Listen herunterlädt und durch dieselbe Schutzfunktion
 * schickt, die auch zur Laufzeit greift.
 *
 * Aufruf: node scripts/audit-filter-lists.mjs
 */

import {
  buildRulesFromParsedList,
  findSelfBlockingRules,
  parseFilterList,
} from '../src/core/filter-parser.js';
import { PRESETS, PRESET_SOURCE_URLS } from '../src/core/presets.js';

/** Adressen, die unter keinen Umständen blockiert werden dürfen. */
const CANARY_URLS = [
  ...PRESET_SOURCE_URLS,
  'https://www.google.com/',
  'https://chromewebstore.google.com/',
  'https://github.com/',
  'https://www.wikipedia.org/',
  'https://example.com/',
  'https://www.bild.de/',
  'https://www.spiegel.de/',
];

/**
 * Lädt eine Liste über die erste erreichbare Quelle.
 * @param {import('../src/core/presets.js').PresetDefinition} preset
 * @returns {Promise<{text: string, url: string}>}
 */
async function download(preset) {
  const failures = [];

  for (const url of preset.urls) {
    try {
      const response = await fetch(url, { redirect: 'follow' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { text: await response.text(), url };
    } catch (error) {
      failures.push(`${new URL(url).hostname}: ${error.message}`);
    }
  }

  throw new Error(failures.join(' · '));
}

async function main() {
  let problems = 0;
  let totalRules = 0;

  for (const preset of Object.values(PRESETS)) {
    process.stdout.write(`\n${preset.name}\n${'─'.repeat(64)}\n`);

    let downloaded;
    try {
      downloaded = await download(preset);
    } catch (error) {
      console.error(`  Keine Quelle erreichbar: ${error.message}`);
      problems += 1;
      continue;
    }

    const parsed = parseFilterList(downloaded.text);
    const rules = buildRulesFromParsedList(parsed);
    totalRules += rules.length;

    console.log(`  Quelle:        ${new URL(downloaded.url).hostname}`);
    console.log(
      `  Umfang:        ${(downloaded.text.length / 1024).toFixed(0)} KB, ${parsed.stats.lines} Zeilen`
    );
    console.log(`  Übernommen:    ${parsed.stats.accepted}`);
    console.log(`  Verworfen:     ${parsed.stats.skipped}`);
    console.log(`  → Domains:     ${parsed.domains.length}`);
    console.log(`  → $all-Domains:${String(parsed.documentDomains.length).padStart(6)}`);
    console.log(`  → Muster:      ${parsed.patterns.length}`);
    console.log(`  → Regeln:      ${rules.length}`);

    const scoped = parsed.patterns.filter((p) => p.initiatorDomains?.length > 0).length;
    if (scoped > 0) console.log(`     davon auf Domains eingegrenzt: ${scoped}`);

    const topReasons = Object.entries(parsed.stats.reasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    if (topReasons.length > 0) {
      console.log('  Verwerfungsgründe:');
      for (const [reason, count] of topReasons) {
        console.log(`      ${reason.padEnd(28)} ${count}`);
      }
    }

    // --- Die eigentliche Prüfung, mit der echten Laufzeitfunktion ---------
    const offenders = findSelfBlockingRules(rules, CANARY_URLS);
    if (offenders.length > 0) {
      problems += offenders.length;
      console.log(`\n  *** ${offenders.length} Regel(n) treffen unverzichtbare Adressen ***`);
      for (const entry of offenders.slice(0, 8)) {
        console.log(`      ${JSON.stringify(entry.condition)}`);
        console.log(`        → würde ${entry.url} blockieren`);
      }
    }
  }

  console.log(`\n${'═'.repeat(64)}`);
  console.log(`Regeln insgesamt: ${totalRules}`);

  if (problems > 0) {
    console.error(`\n${problems} Problem(e) gefunden.`);
    process.exit(1);
  }
  console.log('Keine Regel blockiert eine unverzichtbare Adresse.');
}

main().catch((error) => {
  console.error('Prüfung abgebrochen:', error);
  process.exit(1);
});
