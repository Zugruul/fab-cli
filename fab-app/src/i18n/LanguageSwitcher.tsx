// #217 minimal manual-override settings surface (design doc: "smallest
// honest UI, no navigation library introduction for this task alone").
// Three tappable options — System / English / Português (Brasil) — that
// persist the choice and switch the running UI language immediately.

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLanguagePreference } from './useLanguagePreference';
import type { LanguagePreference } from './types';

const OPTIONS: { value: LanguagePreference; labelKey: string }[] = [
  { value: 'system', labelKey: 'settings.language.system' },
  { value: 'en', labelKey: 'settings.language.en' },
  { value: 'pt-BR', labelKey: 'settings.language.ptBR' },
];

export function LanguageSwitcher(): React.JSX.Element {
  const { t } = useTranslation();
  const { preference, setPreference } = useLanguagePreference();

  return (
    <View style={styles.container} testID="language-switcher">
      <Text style={styles.title} testID="language-switcher-title">
        {t('settings.language.title')}
      </Text>
      <View style={styles.row}>
        {OPTIONS.map(option => {
          const selected = preference === option.value;
          return (
            <TouchableOpacity
              key={option.value}
              testID={`language-option-${option.value}`}
              style={[styles.option, selected && styles.optionSelected]}
              onPress={() => {
                setPreference(option.value);
              }}>
              <Text style={selected ? styles.optionTextSelected : styles.optionText}>{t(option.labelKey)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 8 },
  title: { fontSize: 14, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 8 },
  option: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#cccccc',
  },
  optionSelected: { borderColor: '#0a84ff', backgroundColor: '#0a84ff22' },
  optionText: { fontSize: 13, color: '#333333' },
  optionTextSelected: { fontSize: 13, color: '#0a84ff', fontWeight: '600' },
});
