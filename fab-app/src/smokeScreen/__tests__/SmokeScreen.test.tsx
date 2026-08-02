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

import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {I18nextProvider} from 'react-i18next';
import {SmokeScreen} from '../SmokeScreen';
import {createI18nInstance} from '../../i18n/i18n';
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

describe('SmokeScreen (#217 translated device smoke test)', () => {
  it('renders the title, module label, button, and note translated in en', async () => {
    const tree = await render('en');
    expect(flatten(tree.root.findByProps({testID: 'smoke-title'}).props.children)).toBe(
      'fab-app device smoke test',
    );
    expect(
      flatten(tree.root.findByProps({testID: 'smoke-row-llama'}).props.children[0].props.children),
    ).toBe('llama.rn');
    expect(tree.root.findByProps({testID: 'smoke-run-checks'}).props.title).toBe('Run checks again');
    expect(flatten(tree.root.findByProps({testID: 'smoke-note'}).props.children)).toContain(
      'Device run: pending human device test via the APP-036 TestFlight pipeline.',
    );
  });

  it('renders the title, button, and note translated in pt-BR', async () => {
    const tree = await render('pt-BR');
    expect(flatten(tree.root.findByProps({testID: 'smoke-title'}).props.children)).toBe(
      'Teste de fumaça do dispositivo fab-app',
    );
    expect(tree.root.findByProps({testID: 'smoke-run-checks'}).props.title).toBe(
      'Executar verificações novamente',
    );
    expect(flatten(tree.root.findByProps({testID: 'smoke-note'}).props.children)).toContain(
      'Execução no dispositivo: teste manual pendente via pipeline TestFlight do APP-036.',
    );
  });

  it('renders the settled summary translated once all four mocked modules resolve', async () => {
    const tree = await render('en');
    expect(flatten(tree.root.findByProps({testID: 'smoke-summary'}).props.children)).toBe(
      '4/4 native modules ok, 0/4 failed',
    );
  });
});

function flatten(children: React.ReactNode): string {
  return React.Children.toArray(children).join('');
}
