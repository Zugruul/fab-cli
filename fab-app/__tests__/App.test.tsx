/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

test('renders correctly', async () => {
  // async act: I18nProvider's effect resolves the default (op-sqlite-
  // mocked) preference store and calls i18n.changeLanguage() — await it so
  // that update settles here rather than warning in a later test.
  //
  // Note: SafeAreaProvider renders null children under jest (no native
  // initial-insets event fires in this headless environment), so — same as
  // before #217 — this only asserts App() mounts without throwing; it
  // can't assert on LanguageSwitcher/SmokeScreen content. Those are
  // covered directly by src/i18n/__tests__/LanguageSwitcher.test.tsx and
  // src/smokeScreen/__tests__/SmokeScreen.test.tsx.
  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(<App />);
  });
});
