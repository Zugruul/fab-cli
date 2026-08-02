/**
 * @format
 */

// #217: the minimal manual-override settings surface — per user directive,
// bare-minimum default RN components only (no styling). Renders one option
// per registered locale (SUPPORTED_LOCALES) plus "system"; tapping one
// persists the choice via useLanguagePreference and switches the running
// UI language. Assertions are generic over the locale registry — not
// "there are three options" — so a locale added to LOCALE_BUNDLES is
// covered automatically with no change to this file.

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { I18nProvider } from '../I18nProvider';
import { LanguageSwitcher } from '../LanguageSwitcher';
import { LOCALE_BUNDLES, SUPPORTED_LOCALES } from '../locales';
import type { LanguagePreferenceStore } from '../languageStore';
import type { LanguagePreference } from '../types';

function createFakeStore(initial: LanguagePreference = 'system'): LanguagePreferenceStore {
  let value = initial;
  return {
    getPreference: jest.fn(async () => value),
    setPreference: jest.fn(async pref => {
      value = pref;
    }),
  };
}

async function render(store: LanguagePreferenceStore) {
  let tree: ReactTestRenderer.ReactTestRenderer;
  // async act: I18nProvider's effect always resolves the persisted
  // preference and calls i18n.changeLanguage(), which schedules its own
  // React update — await it so it lands inside this act(), not the next
  // test.
  await act(async () => {
    tree = ReactTestRenderer.create(
      <I18nProvider store={store} systemLocaleSource={{ getSystemLocale: () => 'en-US' }}>
        <LanguageSwitcher />
      </I18nProvider>,
    );
  });
  return tree!;
}

describe('LanguageSwitcher (#217 minimal manual-override settings surface)', () => {
  it('renders a title and one option per registered locale, plus "system"', async () => {
    const tree = await render(createFakeStore('system'));
    expect(tree.root.findByProps({ testID: 'language-switcher' })).toBeTruthy();

    expect(optionText(tree, 'system')).toBe(LOCALE_BUNDLES.en.settings.language.system);
    for (const locale of SUPPORTED_LOCALES) {
      expect(optionText(tree, locale)).toBe(LOCALE_BUNDLES.en.settings.language[locale]);
    }
  });

  it.each(SUPPORTED_LOCALES)('tapping the %s option persists the override and re-renders translated', async locale => {
    const store = createFakeStore('system');
    const tree = await render(store);
    await act(async () => {
      tree.root.findByProps({ testID: `language-option-${locale}` }).props.onPress();
    });
    expect(store.setPreference).toHaveBeenCalledWith(locale);
    expect(flatten(tree.root.findByProps({ testID: 'language-switcher-title' }).props.children)).toBe(
      LOCALE_BUNDLES[locale].settings.language.title,
    );
  });

  it('marks the active preference as selected via accessibilityState', async () => {
    const tree = await render(createFakeStore('en'));
    await act(async () => {}); // let the persisted-preference effect settle
    expect(tree.root.findByProps({ testID: 'language-option-en' }).props.accessibilityState).toEqual({
      selected: true,
    });
    expect(tree.root.findByProps({ testID: 'language-option-system' }).props.accessibilityState).toEqual({
      selected: false,
    });
  });
});

function optionText(tree: ReactTestRenderer.ReactTestRenderer, value: string): string {
  const option = tree.root.findByProps({ testID: `language-option-${value}` });
  return flatten(option.findByType(Text).props.children);
}

function flatten(children: React.ReactNode): string {
  return React.Children.toArray(children).join('');
}
