// #217: i18next wiring. Resources are the compiled-in JSON bundles
// (SPEC-APP.md §13 invariant 5 — no runtime network fetch); providing them
// synchronously via `resources` (rather than a backend/loader) means
// i18next finishes initializing synchronously, so `t()` works immediately
// after createI18nInstance() returns — no awaiting init()'s promise.
// `createInstance()` (not the shared default `i18next` export) so every
// caller — the real I18nProvider and every screen test — gets its own
// isolated instance instead of mutating shared module-level language state.

import i18next from 'i18next';
import type { i18n as I18nInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { LOCALE_BUNDLES, SOURCE_LOCALE } from './locales';
import type { Locale } from './types';

// Derived from the locale registry (./locales/index.ts) rather than
// listing each locale by hand — a locale added to LOCALE_BUNDLES is
// automatically wired into i18next with no change here.
export const resources = Object.fromEntries(
  Object.entries(LOCALE_BUNDLES).map(([locale, bundle]) => [locale, { translation: bundle }]),
);

export function createI18nInstance(initialLocale: Locale): I18nInstance {
  const instance = i18next.createInstance();
  // Resources are provided synchronously (no backend/loader), so init()
  // finishes its work before this call returns — the returned promise is
  // not needed here (see the module comment above).
  instance.use(initReactI18next).init({
    resources,
    lng: initialLocale,
    fallbackLng: SOURCE_LOCALE,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  return instance;
}
