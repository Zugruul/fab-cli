// #219 (SPEC-APP.md §9.13) acceptance criterion 2: the active theme follows
// the system scheme via RN's useColorScheme() (Appearance API) — no
// persisted override, no Provider/context needed (unlike #217's i18n layer,
// which needs one for its async persisted-preference read; theme is a pure
// synchronous read of the system scheme every render). useColorScheme()
// itself is what makes updates live: it's backed by useSyncExternalStore
// subscribed to Appearance's change listener (see react-native's own
// Libraries/Utilities/useColorScheme.js), so a system scheme change
// re-renders every component that calls useTheme() with no extra wiring
// here — proven in useTheme.test.tsx by mocking the hook's return value and
// re-rendering.

import {useColorScheme} from 'react-native';
import {THEMES} from './tokens';
import type {ThemeName, ThemeTokens} from './tokens';

export interface Theme {
  name: ThemeName;
  tokens: ThemeTokens;
}

/** Maps RN's ColorSchemeName (`'light' | 'dark' | null | undefined`, and
 * forward-compatibly any future string) to a registered ThemeName —
 * anything other than exactly `'dark'` resolves to `'light'`, the same
 * fallback App.tsx's pre-#219 `useColorScheme() === 'dark'` check used. */
export function resolveThemeName(scheme: string | null | undefined): ThemeName {
  return scheme === 'dark' ? 'dark' : 'light';
}

export function useTheme(): Theme {
  const scheme = useColorScheme();
  const name = resolveThemeName(scheme);
  return {name, tokens: THEMES[name]};
}
