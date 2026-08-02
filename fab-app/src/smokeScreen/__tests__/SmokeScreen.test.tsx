/**
 * @format
 */

// #217: SmokeScreen is one of the six user-facing surfaces in scope for
// the app-language layer (title, running summary, per-module labels,
// status words, the "run checks again" button, and the device-run note
// all flow through i18next). The four native pillars are mocked (see
// jest.config.js moduleNameMapper / __mocks__), same as __tests__/App.test.tsx
// — this only asserts the translated copy renders, not real device
// behavior (that's the manual APP-036 TestFlight check).
//
// Parametrized over every registered locale (SUPPORTED_LOCALES) and
// asserted against that locale's own bundle content (LOCALE_BUNDLES) —
// not hardcoded translated strings — so a future locale added to the
// registry is covered automatically with no change to this file.

import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {I18nextProvider} from 'react-i18next';
import {SmokeScreen} from '../SmokeScreen';
import {createI18nInstance} from '../../i18n/i18n';
import {LOCALE_BUNDLES, SUPPORTED_LOCALES} from '../../i18n/locales';
import type {Locale} from '../../i18n/types';

async function render(locale: Locale) {
  let tree: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <I18nextProvider i18n={createI18nInstance(locale)}>
        <SmokeScreen />
      </I18nextProvider>,
    );
  });
  return tree!;
}

describe.each(SUPPORTED_LOCALES)('SmokeScreen translated copy in %s', locale => {
  const bundle = LOCALE_BUNDLES[locale];

  it("renders the title, module label, button, and note using that locale's text", async () => {
    const tree = await render(locale);
    expect(flatten(tree.root.findByProps({testID: 'smoke-title'}).props.children)).toBe(bundle.smoke.title);
    expect(
      flatten(tree.root.findByProps({testID: 'smoke-row-llama'}).props.children[0].props.children),
    ).toBe(bundle.smoke.modules.llama);
    expect(tree.root.findByProps({testID: 'smoke-run-checks'}).props.title).toBe(bundle.smoke.runChecksAgain);
    expect(flatten(tree.root.findByProps({testID: 'smoke-note'}).props.children)).toBe(bundle.smoke.deviceRunNote);
  });

  it("renders the settled summary using that locale's template, once all four mocked modules resolve", async () => {
    const tree = await render(locale);
    const expected = bundle.smoke.summarySettled.replace('{{ok}}', '4').replace('{{error}}', '0');
    expect(flatten(tree.root.findByProps({testID: 'smoke-summary'}).props.children)).toBe(expected);
  });
});

function flatten(children: React.ReactNode): string {
  return React.Children.toArray(children).join('');
}
