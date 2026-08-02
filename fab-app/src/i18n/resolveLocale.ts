// #217: resolves a stored LanguagePreference + a raw system-locale string
// (e.g. from Intl.DateTimeFormat().resolvedOptions().locale) down to one of
// the two Locales fab-app actually ships. Pure, no i18next/RN import — the
// design doc's contract verbatim: "explicit override if set, else system
// mapping (pt-* -> pt-BR, else en)".

import type { Locale, LanguagePreference } from './types';

export function resolveLocale(preference: LanguagePreference, systemLocale: string): Locale {
  if (preference !== 'system') {
    return preference;
  }
  return systemLocale.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
}
