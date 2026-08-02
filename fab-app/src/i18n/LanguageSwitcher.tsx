// #217 minimal manual-override settings surface. Per user directive
// (mid-task, all UI stays bare-minimum until a dedicated UI-refinement
// task): default RN components only, no StyleSheet/styling/design effort —
// a plain list of text buttons. Options are generated from the locale
// registry (SUPPORTED_LOCALES, ./locales/index.ts) plus "system", so a
// future locale needs no change here — it just appears as another option.

import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLanguagePreference } from './useLanguagePreference';
import { SUPPORTED_LOCALES } from './locales';
import type { LanguagePreference } from './types';

const OPTIONS: LanguagePreference[] = ['system', ...SUPPORTED_LOCALES];

export function LanguageSwitcher(): React.JSX.Element {
  const { t } = useTranslation();
  const { preference, setPreference } = useLanguagePreference();

  return (
    <View testID="language-switcher">
      <Text testID="language-switcher-title">{t('settings.language.title')}</Text>
      {OPTIONS.map(option => (
        <TouchableOpacity
          key={option}
          testID={`language-option-${option}`}
          accessibilityState={{ selected: preference === option }}
          onPress={() => {
            setPreference(option);
          }}>
          <Text>{t(`settings.language.${option}`)}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}
