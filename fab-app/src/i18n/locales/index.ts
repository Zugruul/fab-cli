// #217: the locale registry — the single place a shipped language is
// registered. Everything downstream (i18next's `resources`, the key-parity
// gate check, and the per-locale screen tests) derives from this data
// instead of hardcoding the en/pt-BR pair, so this is also the *only*
// place touched to add a future locale: drop in `locales/<code>.json`,
// add one line to LOCALE_BUNDLES below. No other gate-check or test code
// changes — a new locale is picked up automatically by every consumer
// that iterates SUPPORTED_LOCALES / LOCALE_BUNDLES.

import en from './en.json';
import ptBR from './pt-BR.json';

export const LOCALE_BUNDLES = {
  en,
  'pt-BR': ptBR,
} as const;

export type Locale = keyof typeof LOCALE_BUNDLES;

/** `en` is the source-of-truth bundle every other locale is checked
 * against for key parity, and i18next's fallback language. */
export const SOURCE_LOCALE: Locale = 'en';

export const SUPPORTED_LOCALES: Locale[] = Object.keys(LOCALE_BUNDLES) as Locale[];
