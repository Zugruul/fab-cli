// #217: createI18nInstance wires the compiled-in en/pt-BR bundles into an
// i18next instance (SPEC-APP.md §13 invariant 5 — bundles compiled into the
// JS bundle, no runtime network fetch). Because resources are provided
// synchronously (no backend/loader), i18next finishes initializing
// synchronously, so t() must work immediately after createI18nInstance
// returns — no awaiting the init() promise — which is what lets the app
// resolve+apply a locale before first render (see I18nProvider.tsx).

import { createI18nInstance } from '../i18n';

describe('createI18nInstance', () => {
  it('translates immediately with the "en" bundle — no async wait needed', () => {
    const instance = createI18nInstance('en');
    expect(instance.t('settings.language.title')).toBe('Language');
  });

  it('translates immediately with the "pt-BR" bundle', () => {
    const instance = createI18nInstance('pt-BR');
    expect(instance.t('settings.language.title')).toBe('Idioma');
  });

  it('interpolates values (e.g. the provenance "knowledge up to" string)', () => {
    const instance = createI18nInstance('en');
    expect(instance.t('screens.provenance.knowledgeUpTo', { set: 'OTA' })).toBe('knowledge up to: OTA');
  });

  it('switches language at runtime via changeLanguage — manual override applied without reinstall', async () => {
    const instance = createI18nInstance('en');
    expect(instance.t('settings.language.title')).toBe('Language');
    await instance.changeLanguage('pt-BR');
    expect(instance.t('settings.language.title')).toBe('Idioma');
  });

  it('creates independent instances (two screens/tests never share mutable language state)', async () => {
    const a = createI18nInstance('en');
    const b = createI18nInstance('pt-BR');
    expect(a.t('settings.language.title')).toBe('Language');
    expect(b.t('settings.language.title')).toBe('Idioma');
  });
});
