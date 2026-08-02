/**
 * @format
 */

// #217: the minimal manual-override settings surface (design doc: "smallest
// honest UI, no navigation library"). Renders three options (System /
// English / Português (Brasil)); tapping one persists the choice via
// useLanguagePreference and switches the running UI language.

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { I18nProvider } from '../I18nProvider';
import { LanguageSwitcher } from '../LanguageSwitcher';
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

function render(store: LanguagePreferenceStore) {
  let tree: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <I18nProvider store={store} systemLocaleSource={{ getSystemLocale: () => 'en-US' }}>
        <LanguageSwitcher />
      </I18nProvider>,
    );
  });
  return tree!;
}

describe('LanguageSwitcher (#217 minimal manual-override settings surface)', () => {
  it('renders a title and the three language options in English', () => {
    const tree = render(createFakeStore('system'));
    expect(tree.root.findByProps({ testID: 'language-switcher' })).toBeTruthy();
    expect(flatten(tree.root.findByProps({ testID: 'language-option-system' }).props.children)).toContain('System');
    expect(flatten(tree.root.findByProps({ testID: 'language-option-en' }).props.children)).toContain('English');
    expect(flatten(tree.root.findByProps({ testID: 'language-option-pt-BR' }).props.children)).toContain(
      'Português (Brasil)',
    );
  });

  it('tapping "Português (Brasil)" persists the override and re-renders translated', async () => {
    const store = createFakeStore('system');
    const tree = render(store);
    await act(async () => {
      tree.root.findByProps({ testID: 'language-option-pt-BR' }).props.onPress();
    });
    expect(store.setPreference).toHaveBeenCalledWith('pt-BR');
    expect(flatten(tree.root.findByProps({ testID: 'language-switcher-title' }).props.children)).toContain('Idioma');
  });
});

function flatten(children: React.ReactNode): string {
  return React.Children.toArray(children).join('');
}
