// #217 app-language layer: pure data shapes shared across locale detection,
// persistence, and the i18next wiring. No RN or i18next import here so
// resolveLocale/checkParity/languageStore stay unit-testable without a
// renderer, mirroring src/onboarding/types.ts's split.

// `Locale` is derived from the locale registry (./locales/index.ts) rather
// than declared as its own union here — the registry (LOCALE_BUNDLES) is
// the single source of truth for which languages fab-app ships, so this
// type always matches it exactly with no risk of drifting out of sync.
import type { Locale } from './locales';
export type { Locale };

/** The user's stored choice: `system` defers to the device locale (mapped
 * via resolveLocale.ts), or an explicit override. */
export type LanguagePreference = 'system' | Locale;
