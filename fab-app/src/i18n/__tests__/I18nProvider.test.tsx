/**
 * @format
 */

// #217 key sequences (docs/design/app-E3.md):
//  1. App start -> read persisted preference -> resolve locale (override ??
//     system mapping) -> init i18n before first render -> screens render
//     translated strings.
//  2. User changes language in the settings surface -> preference persisted
//     -> i18n switched at runtime -> UI re-renders in the new language
//     without reinstall.
// Both are exercised here against fake store/systemLocaleSource (mirrors
// onboarding's NetworkStateSource injection pattern) so this runs fully
// offline and deterministically, independent of the real op-sqlite/Intl
// bindings.

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { I18nProvider } from '../I18nProvider';
import { useLanguagePreference } from '../useLanguagePreference';
import type { LanguagePreferenceStore } from '../languageStore';
import type { LanguagePreference } from '../types';
import type { SystemLocaleSource } from '../systemLocale';

function createFakeStore(initial: LanguagePreference = 'system'): LanguagePreferenceStore {
  let value = initial;
  return {
    getPreference: jest.fn(async () => value),
    setPreference: jest.fn(async pref => {
      value = pref;
    }),
  };
}

function fakeSystemLocaleSource(locale: string): SystemLocaleSource {
  return { getSystemLocale: () => locale };
}

function Probe() {
  const { t } = useTranslation();
  const { preference, setPreference } = useLanguagePreference();
  return (
    <>
      <Text testID="title">{t('settings.language.title')}</Text>
      <Text testID="preference">{preference}</Text>
      <TouchableOpacity testID="choose-ptBR" onPress={() => setPreference('pt-BR')}>
        <Text>set</Text>
      </TouchableOpacity>
    </>
  );
}

function renderProbe(store: LanguagePreferenceStore, systemLocale: string) {
  let tree: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <I18nProvider store={store} systemLocaleSource={fakeSystemLocaleSource(systemLocale)}>
        <Probe />
      </I18nProvider>,
    );
  });
  return tree!;
}

describe('I18nProvider + useLanguagePreference (#217)', () => {
  it('renders with the system-resolved locale on first paint (pt-* system -> pt-BR)', () => {
    const tree = renderProbe(createFakeStore('system'), 'pt-BR');
    expect(tree.root.findByProps({ testID: 'title' }).props.children).toBe('Idioma');
  });

  it('renders with "en" on first paint for a non-pt system locale', () => {
    const tree = renderProbe(createFakeStore('system'), 'en-US');
    expect(tree.root.findByProps({ testID: 'title' }).props.children).toBe('Language');
  });

  it('applies a persisted manual override once loaded, even against a different system locale', async () => {
    const store = createFakeStore('pt-BR');
    let tree: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <I18nProvider store={store} systemLocaleSource={fakeSystemLocaleSource('en-US')}>
          <Probe />
        </I18nProvider>,
      );
    });
    expect(tree!.root.findByProps({ testID: 'title' }).props.children).toBe('Idioma');
  });

  it('setPreference persists the choice and switches the running UI language without reinstall', async () => {
    const store = createFakeStore('system');
    let tree: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <I18nProvider store={store} systemLocaleSource={fakeSystemLocaleSource('en-US')}>
          <Probe />
        </I18nProvider>,
      );
    });
    expect(tree!.root.findByProps({ testID: 'title' }).props.children).toBe('Language');

    await act(async () => {
      tree!.root.findByProps({ testID: 'choose-ptBR' }).props.onPress();
    });

    expect(store.setPreference).toHaveBeenCalledWith('pt-BR');
    expect(tree!.root.findByProps({ testID: 'title' }).props.children).toBe('Idioma');
    expect(tree!.root.findByProps({ testID: 'preference' }).props.children).toBe('pt-BR');
  });
});
