// #219 (SPEC-APP.md §9.13): semantic theme token sets for `light` and
// `dark`, data-driven (THEMES registry) the same way #217's LOCALE_BUNDLES
// and #218's SCREENS registration table are — adding a theme is a matter of
// adding an entry here plus THEME_NAMES, no change to the check logic that
// consumes it (tokenContrastGate.ts, useTheme.ts).
//
// Roles are derived from what the six current shipped screens actually use
// (see PR body audit): primary content (`text`), de-emphasized/secondary
// content (`mutedText`, consolidating several near-identical grays the
// screens used ad hoc — #333333/#555555/#666666/#888888 — into one coherent
// role, since the visual difference between them was never meaningful),
// call-to-action text (`accent`), a decorative hairline separator
// (`border`), and the SmokeScreen module-status colors (`warning`,
// `success`, alongside `danger`, which ProgressScreen's error text also
// uses). `background`/`surface` are the two container tones a real design
// system needs (WCAG's "text-on-surface" contrast case) — `surface` isn't
// consumed by any current screen (none has a distinct card/panel look yet,
// only flat full-bleed containers), but it's provisioned and contrast-
// proven now so E4+ screens can adopt it without a later token-set change.
// All nine colors are picked to individually clear WCAG AA (4.5:1 normal
// text) against both `background` and `surface`, verified in both themes by
// tokenContrastGate.ts's CONTRAST_PAIRS check.

export type ThemeName = 'light' | 'dark';

export interface ThemeTokens {
  background: string;
  surface: string;
  text: string;
  mutedText: string;
  border: string;
  accent: string;
  danger: string;
  warning: string;
  success: string;
}

export const THEMES: Record<ThemeName, ThemeTokens> = {
  light: {
    background: '#ffffff',
    surface: '#f7f7f7',
    text: '#000000',
    mutedText: '#666666',
    border: '#cccccc',
    accent: '#0968d6',
    danger: '#cc3333',
    warning: '#916c00',
    success: '#1a7f37',
  },
  dark: {
    background: '#121212',
    surface: '#1e1e1e',
    text: '#ffffff',
    mutedText: '#a8a8a8',
    border: '#3a3a3a',
    accent: '#5aa9ff',
    danger: '#ff6b6b',
    warning: '#e0b23d',
    success: '#4fd67a',
  },
};

/** Iteration order for anything generic over "every registered theme"
 * (tokenContrastGate.ts's default, the a11y/theme test matrices). */
export const THEME_NAMES: ThemeName[] = ['light', 'dark'];
