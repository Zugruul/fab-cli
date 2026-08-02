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
import en from './locales/en.json';
import ptBR from './locales/pt-BR.json';
import type { Locale } from './types';

export const resources = {
  en: { translation: en },
  'pt-BR': { translation: ptBR },
} as const;

export function createI18nInstance(initialLocale: Locale): I18nInstance {
  const instance = i18next.createInstance();
  // Resources are provided synchronously (no backend/loader), so init()
  // finishes its work before this call returns — the returned promise is
  // not needed here (see the module comment above).
  instance.use(initReactI18next).init({
    resources,
    lng: initialLocale,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  return instance;
}
