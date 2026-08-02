// #217 acceptance criterion 3 ("every non-source locale has a translation
// for every source key, parity machine-checked") and criterion 5(b) (gate
// fails on a parity mismatch). checkKeyParity is the pairwise comparison
// primitive; checkAllLocalesParity is the gate-facing entry point that
// iterates every locale in the registry generically (no hardcoded pair) —
// exercised here against small fixtures (including deliberately broken
// ones) AND against the real shipped LOCALE_BUNDLES, so a future PR that
// adds a source key without its translation in some locale fails this
// suite — which `npm run test:run` runs as part of `npm run gate`. Adding
// a new locale to LOCALE_BUNDLES needs no change to this file: the
// "real shipped bundles" test below iterates whatever locales are
// registered.

import { checkKeyParity, checkAllLocalesParity } from '../checkParity';
import { LOCALE_BUNDLES, SOURCE_LOCALE, SUPPORTED_LOCALES } from '../locales';

describe('checkKeyParity (pairwise primitive)', () => {
  it('reports no missing keys when both bundles have full parity', () => {
    const result = checkKeyParity({ a: { b: 'x' }, c: 'y' }, { a: { b: 'z' }, c: 'w' });
    expect(result).toEqual({ missingInOther: [], missingInBase: [] });
  });

  it('reports dot-path keys missing from the other bundle (broken-translation fixture)', () => {
    const result = checkKeyParity({ a: { b: 'x' }, c: 'y' }, { a: { b: 'z' } });
    expect(result.missingInOther).toEqual(['c']);
    expect(result.missingInBase).toEqual([]);
  });

  it('reports keys present only in the other bundle', () => {
    const result = checkKeyParity({ a: 'x' }, { a: 'y', b: 'z' });
    expect(result.missingInBase).toEqual(['b']);
  });

  it('flags a nested key missing several levels deep', () => {
    const result = checkKeyParity(
      { onboarding: { consent: { title: 'x', download: 'y' } } },
      { onboarding: { consent: { title: 'x' } } },
    );
    expect(result.missingInOther).toEqual(['onboarding.consent.download']);
  });
});

describe('checkAllLocalesParity (gate-facing, data-driven over the locale set)', () => {
  it('checks every non-source locale against the source, generically', () => {
    const bundles = {
      en: { a: 'x', b: 'y' },
      fr: { a: 'x' }, // missing "b"
      de: { a: 'x', b: 'y', c: 'z' }, // extra "c"
    };
    const results = checkAllLocalesParity(bundles, 'en');

    expect(results.map(r => r.locale)).toEqual(['de', 'fr']); // sorted, source excluded
    expect(results.find(r => r.locale === 'fr')?.missingInLocale).toEqual(['b']);
    expect(results.find(r => r.locale === 'de')?.missingInSource).toEqual(['c']);
  });

  it('adding a new locale to the input is picked up automatically, no code change needed', () => {
    const bundles = {
      en: { a: 'x' },
      es: { a: 'y' },
      fr: { a: 'z' },
    };
    const results = checkAllLocalesParity(bundles, 'en');
    expect(results.map(r => r.locale)).toEqual(['es', 'fr']);
    expect(results.every(r => r.missingInLocale.length === 0 && r.missingInSource.length === 0)).toBe(true);
  });

  it('throws if the given source locale is not present in bundles', () => {
    expect(() => checkAllLocalesParity({ en: { a: 'x' } }, 'de')).toThrow(/source locale/);
  });

  it('has full key parity for every configured locale against the source, in the real shipped bundles', () => {
    const results = checkAllLocalesParity(LOCALE_BUNDLES, SOURCE_LOCALE);

    // Covers exactly whatever's currently registered — no hardcoded pair.
    expect(results.map(r => r.locale)).toEqual(SUPPORTED_LOCALES.filter(locale => locale !== SOURCE_LOCALE).sort());

    for (const result of results) {
      expect(result.missingInLocale).toEqual([]);
      expect(result.missingInSource).toEqual([]);
    }
  });
});
