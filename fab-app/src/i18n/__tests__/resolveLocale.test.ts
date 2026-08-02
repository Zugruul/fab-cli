// #217: resolveLocale is the single place that turns a stored preference +
// a raw system-locale string into one of the two locales fab-app actually
// ships. Pure function, no RN/i18next import — exercised directly here so
// the mapping rule (explicit override wins; else pt-* -> pt-BR, else en)
// is covered without needing a renderer or a real device locale.

import { resolveLocale } from '../resolveLocale';

describe('resolveLocale', () => {
  it('returns the explicit override when the preference is not "system"', () => {
    expect(resolveLocale('pt-BR', 'en-US')).toBe('pt-BR');
    expect(resolveLocale('en', 'pt-BR')).toBe('en');
  });

  it('maps pt-* system locales to pt-BR when the preference is "system"', () => {
    expect(resolveLocale('system', 'pt-BR')).toBe('pt-BR');
    expect(resolveLocale('system', 'pt-PT')).toBe('pt-BR');
    expect(resolveLocale('system', 'pt')).toBe('pt-BR');
  });

  it('maps every other system locale to en when the preference is "system"', () => {
    expect(resolveLocale('system', 'en-US')).toBe('en');
    expect(resolveLocale('system', 'es-ES')).toBe('en');
    expect(resolveLocale('system', 'fr')).toBe('en');
    expect(resolveLocale('system', '')).toBe('en');
  });

  it('matches the pt-* prefix case-insensitively', () => {
    expect(resolveLocale('system', 'PT-br')).toBe('pt-BR');
    expect(resolveLocale('system', 'Pt')).toBe('pt-BR');
  });
});
