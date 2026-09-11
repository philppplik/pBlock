/**
 * Hostname- und Domain-Logik.
 *
 * Der wichtigste Punkt hier ist {@link isHostnameCoveredBy}. v4 verglich mit
 * `hostname.includes(domain)`. Damit galt ein Whitelist-Eintrag `ard.de` auch für
 * `boulevard.de.angreifer.example` — also für eine Domain, die der Nutzer nie
 * freigegeben hat. Sicherheitsrelevanter Fehler, hier durch echten
 * Suffix-Vergleich auf Label-Grenzen ersetzt.
 */

/**
 * Extrahiert den Hostnamen aus einer URL.
 * @param {string|null|undefined} url
 * @returns {string|null} Kleingeschriebener Hostname ohne Punkt am Ende, sonst `null`.
 */
export function extractHostname(url) {
  if (typeof url !== 'string' || url.length === 0) return null;
  try {
    const { hostname } = new URL(url);
    return normalizeHostname(hostname);
  } catch {
    return null;
  }
}

/**
 * Normalisiert einen Hostnamen: Kleinschreibung, ohne Leerzeichen und ohne Punkt
 * am Ende. Ein führendes `www.` bleibt bewusst erhalten, damit man es bei Bedarf
 * getrennt behandeln kann.
 *
 * @param {string|null|undefined} hostname
 * @returns {string|null}
 */
export function normalizeHostname(hostname) {
  if (typeof hostname !== 'string') return null;
  const trimmed = hostname.trim().toLowerCase().replace(/\.$/, '');
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Nutzereingabe (evtl. komplette URL, evtl. mit Pfad) zu einer Domain normalisieren.
 *
 * Akzeptiert `https://example.com/pfad`, `example.com`, `  EXAMPLE.com/ ` und
 * liefert jeweils `example.com`.
 *
 * @param {string} input
 * @returns {string|null} `null`, wenn daraus keine plausible Domain wird.
 */
export function parseDomainInput(input) {
  if (typeof input !== 'string') return null;
  let value = input.trim().toLowerCase();
  if (value.length === 0) return null;

  if (value.includes('://')) {
    const fromUrl = extractHostname(value);
    if (fromUrl) return fromUrl;
  }

  // Schema-lose Eingaben wie "example.com/pfad?x=1" auf den Host reduzieren.
  value = value.split('/')[0].split('?')[0].split('#')[0];
  // Optionalen Port abschneiden.
  value = value.replace(/:\d+$/, '');
  value = value.replace(/^\*\./, '').replace(/\.$/, '');

  if (!isPlausibleDomain(value)) return null;
  return value;
}

/**
 * Grobe Plausibilitätsprüfung für eine Domain.
 *
 * Das ist bewusst keine vollständige Public-Suffix-Validierung — wir wollen nur
 * verhindern, dass offensichtlicher Unsinn in die Whitelist wandert und dort
 * DNR-Regeln ungültig macht.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isPlausibleDomain(value) {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > 253) return false;
  if (value.startsWith('.') || value.endsWith('.')) return false;
  if (value.includes('..')) return false;
  if (/\s/.test(value)) return false;
  // localhost und IPv4 sind erlaubt, alles andere braucht mindestens einen Punkt.
  if (value === 'localhost') return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return true;
  return /^([a-z0-9¡-￿](?:[a-z0-9¡-￿-]{0,61}[a-z0-9¡-￿])?\.)+[a-z¡-￿]{2,}$/.test(value);
}

/**
 * Prüft, ob `hostname` von einem Domain-Eintrag abgedeckt wird.
 *
 * Abgedeckt heißt: exakt gleich **oder** echte Subdomain. Der Vergleich
 * respektiert Label-Grenzen, damit `ard.de` nicht `boulevard.de` matcht.
 *
 * @param {string} hostname z. B. `news.example.com`
 * @param {string} domain z. B. `example.com`
 * @returns {boolean}
 *
 * @example
 * isHostnameCoveredBy('news.example.com', 'example.com'); // true
 * isHostnameCoveredBy('example.com', 'example.com');      // true
 * isHostnameCoveredBy('boulevard.de', 'ard.de');          // false  (v4 lieferte true)
 * isHostnameCoveredBy('notexample.com', 'example.com');   // false  (v4 lieferte true)
 */
export function isHostnameCoveredBy(hostname, domain) {
  const host = normalizeHostname(hostname);
  const base = normalizeHostname(domain);
  if (!host || !base) return false;
  if (host === base) return true;
  return host.endsWith(`.${base}`);
}

/**
 * Prüft, ob ein Hostname von irgendeinem Eintrag der Liste abgedeckt wird.
 * @param {string} hostname
 * @param {readonly string[]} domains
 * @returns {boolean}
 */
export function isHostnameWhitelisted(hostname, domains) {
  if (!Array.isArray(domains) || domains.length === 0) return false;
  return domains.some((domain) => isHostnameCoveredBy(hostname, domain));
}

/**
 * Findet den Whitelist-Eintrag, der einen Hostnamen abdeckt.
 * Nützlich für die UI („freigegeben über: example.com“).
 *
 * @param {string} hostname
 * @param {readonly string[]} domains
 * @returns {string|null}
 */
export function findCoveringDomain(hostname, domains) {
  if (!Array.isArray(domains)) return null;
  return domains.find((domain) => isHostnameCoveredBy(hostname, domain)) ?? null;
}

/**
 * Liefert `true` für URLs, in die eine Extension weder Skripte noch CSS
 * injizieren darf. Spart im Service Worker sinnlose Fehler in der Konsole.
 *
 * @param {string|null|undefined} url
 * @returns {boolean}
 */
export function isRestrictedUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return true;
  return (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('devtools://') ||
    url.startsWith('view-source:') ||
    url.startsWith('https://chromewebstore.google.com/') ||
    url.startsWith('https://chrome.google.com/webstore')
  );
}
