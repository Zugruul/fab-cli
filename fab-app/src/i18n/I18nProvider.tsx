// #217 key sequence 1 (docs/design/app-E3.md): app start -> resolve locale
// (system mapping, synchronously — no persisted-preference read blocks
// first paint) -> init i18n before first render -> then, once the
// persisted preference loads (a single async db read), apply it if it
// differs from the system default. A returning user with a saved override
// sees one render at the system locale before the override lands; true
// zero-flash would need native splash-screen infra out of scope here (see
// PR body "decisions").

import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { I18nextProvider } from 'react-i18next';
import type { i18n as I18nInstance } from 'i18next';
import { createI18nInstance } from './i18n';
import { resolveLocale } from './resolveLocale';
import { getDefaultLanguagePreferenceStore } from './defaultLanguagePreferenceStore';
import { intlSystemLocaleSource } from './systemLocale';
import type { LanguagePreferenceStore } from './languageStore';
import type { SystemLocaleSource } from './systemLocale';

export interface I18nProviderProps {
  children: React.ReactNode;
  store?: LanguagePreferenceStore;
  systemLocaleSource?: SystemLocaleSource;
}

interface I18nSettings {
  store: LanguagePreferenceStore;
  systemLocaleSource: SystemLocaleSource;
}

const I18nSettingsContext = createContext<I18nSettings | null>(null);

export function I18nProvider({ children, store, systemLocaleSource }: I18nProviderProps): React.JSX.Element {
  const resolvedStore = useMemo(() => store ?? getDefaultLanguagePreferenceStore(), [store]);
  const resolvedSource = useMemo(() => systemLocaleSource ?? intlSystemLocaleSource, [systemLocaleSource]);

  const instanceRef = useRef<I18nInstance | null>(null);
  if (!instanceRef.current) {
    const initialLocale = resolveLocale('system', resolvedSource.getSystemLocale());
    instanceRef.current = createI18nInstance(initialLocale);
  }

  useEffect(() => {
    let cancelled = false;
    resolvedStore.getPreference().then(preference => {
      if (cancelled) {
        return;
      }
      const locale = resolveLocale(preference, resolvedSource.getSystemLocale());
      instanceRef.current?.changeLanguage(locale);
    });
    return () => {
      cancelled = true;
    };
  }, [resolvedStore, resolvedSource]);

  const settings = useMemo<I18nSettings>(
    () => ({ store: resolvedStore, systemLocaleSource: resolvedSource }),
    [resolvedStore, resolvedSource],
  );

  return (
    <I18nSettingsContext.Provider value={settings}>
      <I18nextProvider i18n={instanceRef.current}>{children}</I18nextProvider>
    </I18nSettingsContext.Provider>
  );
}

export function useI18nSettings(): I18nSettings {
  const settings = useContext(I18nSettingsContext);
  if (!settings) {
    throw new Error('useI18nSettings must be used within an I18nProvider');
  }
  return settings;
}
