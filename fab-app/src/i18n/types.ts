// #217 app-language layer: pure data shapes shared across locale detection,
// persistence, and the i18next wiring. No RN or i18next import here so
// resolveLocale/checkParity/languageStore stay unit-testable without a
// renderer, mirroring src/onboarding/types.ts's split.

/** A resource bundle fab-app actually ships. `en` is the source of truth;
 * `pt-BR` must carry full key parity (machine-checked, see checkParity.ts). */
export type Locale = 'en' | 'pt-BR';

/** The user's stored choice: `system` defers to the device locale (mapped
 * via resolveLocale.ts), or an explicit override. */
export type LanguagePreference = 'system' | Locale;
