// #217 key sequence 2: user changes language -> preference persisted ->
// i18n switched at runtime -> UI re-renders translated, no reinstall.
// Combines the LanguagePreferenceStore + SystemLocaleSource from the
// nearest I18nProvider (useI18nSettings) with the active i18next instance
// (useTranslation) so LanguageSwitcher never has to know about either
// directly.

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useI18nSettings } from './I18nProvider';
import { resolveLocale } from './resolveLocale';
import type { LanguagePreference } from './types';

export interface UseLanguagePreferenceResult {
  preference: LanguagePreference;
  setPreference: (preference: LanguagePreference) => Promise<void>;
}

export function useLanguagePreference(): UseLanguagePreferenceResult {
  const { store, systemLocaleSource } = useI18nSettings();
  const { i18n } = useTranslation();
  const [preference, setPreferenceState] = useState<LanguagePreference>('system');

  useEffect(() => {
    let cancelled = false;
    store.getPreference().then(loaded => {
      if (!cancelled) {
        setPreferenceState(loaded);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [store]);

  const setPreference = useCallback(
    async (next: LanguagePreference) => {
      await store.setPreference(next);
      setPreferenceState(next);
      const locale = resolveLocale(next, systemLocaleSource.getSystemLocale());
      await i18n.changeLanguage(locale);
    },
    [store, systemLocaleSource, i18n],
  );

  return { preference, setPreference };
}
