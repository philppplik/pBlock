import { describe, expect, test } from 'vitest';
import {
  extractHostname,
  findCoveringDomain,
  isHostnameCoveredBy,
  isHostnameWhitelisted,
  isPlausibleDomain,
  isRestrictedUrl,
  normalizeHostname,
  parseDomainInput,
} from '../../src/core/domain.js';

describe('extractHostname', () => {
  test('liefert den kleingeschriebenen Host einer URL', () => {
    expect(extractHostname('https://News.Example.COM/artikel?x=1')).toBe('news.example.com');
  });

  test('liefert null für ungültige Eingaben', () => {
    for (const input of ['', 'kein-url', null, undefined, 42]) {
      expect(extractHostname(input)).toBeNull();
    }
  });
});

describe('normalizeHostname', () => {
  test('entfernt Leerzeichen und den Punkt am Ende', () => {
    expect(normalizeHostname('  Example.com.  ')).toBe('example.com');
  });

  test('behält www. bei, damit es getrennt behandelt werden kann', () => {
    expect(normalizeHostname('www.example.com')).toBe('www.example.com');
  });
});

describe('isHostnameCoveredBy', () => {
  test('deckt exakte Treffer ab', () => {
    expect(isHostnameCoveredBy('example.com', 'example.com')).toBe(true);
  });

  test('deckt echte Subdomains ab', () => {
    expect(isHostnameCoveredBy('news.example.com', 'example.com')).toBe(true);
    expect(isHostnameCoveredBy('a.b.c.example.com', 'example.com')).toBe(true);
  });

  // Regression: v4 nutzte hostname.includes(domain). Damit galt ein
  // Whitelist-Eintrag für Domains, die der Nutzer nie freigegeben hat.
  test('matcht NICHT über Label-Grenzen hinweg', () => {
    expect(isHostnameCoveredBy('boulevard.de', 'ard.de')).toBe(false);
    expect(isHostnameCoveredBy('notexample.com', 'example.com')).toBe(false);
    expect(isHostnameCoveredBy('example.com.angreifer.test', 'example.com')).toBe(false);
    expect(isHostnameCoveredBy('myexample.com', 'example.com')).toBe(false);
  });

  test('gibt bei leeren Werten false zurück', () => {
    expect(isHostnameCoveredBy('', 'example.com')).toBe(false);
    expect(isHostnameCoveredBy('example.com', '')).toBe(false);
    expect(isHostnameCoveredBy(null, null)).toBe(false);
  });
});

describe('isHostnameWhitelisted', () => {
  const whitelist = ['example.com', 'beispiel.test'];

  test('erkennt abgedeckte Hosts', () => {
    expect(isHostnameWhitelisted('shop.example.com', whitelist)).toBe(true);
  });

  test('erkennt nicht abgedeckte Hosts', () => {
    expect(isHostnameWhitelisted('example.org', whitelist)).toBe(false);
  });

  test('leere Whitelist deckt nichts ab', () => {
    expect(isHostnameWhitelisted('example.com', [])).toBe(false);
    expect(isHostnameWhitelisted('example.com', null)).toBe(false);
  });
});

describe('findCoveringDomain', () => {
  test('nennt den verantwortlichen Eintrag', () => {
    expect(findCoveringDomain('a.example.com', ['other.test', 'example.com'])).toBe('example.com');
  });

  test('liefert null, wenn nichts passt', () => {
    expect(findCoveringDomain('a.example.com', ['other.test'])).toBeNull();
  });
});

describe('parseDomainInput', () => {
  test.each([
    ['https://example.com/pfad?x=1', 'example.com'],
    ['  EXAMPLE.com/  ', 'example.com'],
    ['example.com:8443', 'example.com'],
    ['*.example.com', 'example.com'],
    ['example.com.', 'example.com'],
    ['localhost', 'localhost'],
    ['192.168.1.1', '192.168.1.1'],
  ])('normalisiert %s zu %s', (input, expected) => {
    expect(parseDomainInput(input)).toBe(expected);
  });

  test.each(['', '   ', 'nur-text', 'exa mple.com', '..', 'a..b.com', null, 42])(
    'verwirft ungültige Eingabe %s',
    (input) => {
      expect(parseDomainInput(input)).toBeNull();
    }
  );
});

describe('isPlausibleDomain', () => {
  test('akzeptiert normale Domains', () => {
    expect(isPlausibleDomain('example.com')).toBe(true);
    expect(isPlausibleDomain('sub.example.co.uk')).toBe(true);
  });

  test('lehnt zu lange Werte ab', () => {
    expect(isPlausibleDomain(`${'a'.repeat(250)}.com`)).toBe(false);
  });

  test('lehnt Werte ohne Punkt ab (außer localhost)', () => {
    expect(isPlausibleDomain('intranet')).toBe(false);
    expect(isPlausibleDomain('localhost')).toBe(true);
  });
});

describe('isRestrictedUrl', () => {
  test.each([
    'chrome://extensions',
    'chrome-extension://abc/popup.html',
    'about:blank',
    'devtools://devtools/bundled/inspector.html',
    'view-source:https://example.com',
    'https://chromewebstore.google.com/detail/abc',
    '',
    null,
  ])('erkennt %s als gesperrt', (url) => {
    expect(isRestrictedUrl(url)).toBe(true);
  });

  test('normale Seiten sind nicht gesperrt', () => {
    expect(isRestrictedUrl('https://example.com')).toBe(false);
  });
});
