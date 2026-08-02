// #219 (SPEC-APP.md §9.13) acceptance criterion 4(b): the gate-facing
// contrast check. CONTRAST_PAIRS is the small table of foreground-role-on-
// background-role pairs shipped screens actually render text with (see
// tokens.ts's role commentary); checkTokenContrast iterates every pair
// against every registered theme generically — mirrors
// ../i18n/checkParity.ts's checkAllLocalesParity shape one level up (a
// pairwise primitive re-used across a data-driven registered set), so
// adding a theme to THEME_NAMES or a pair to CONTRAST_PAIRS needs no new
// check logic here.

import {meetsWcagAA, contrastRatio} from './contrast';
import {THEMES, THEME_NAMES} from './tokens';
import type {ThemeName, ThemeTokens} from './tokens';

export interface TokenPair {
  fg: keyof ThemeTokens;
  bg: keyof ThemeTokens;
}

// `border` is decorative-only (no text is ever rendered in that color), so
// WCAG's text-contrast requirement doesn't apply to it — intentionally
// excluded.
export const CONTRAST_PAIRS: TokenPair[] = [
  {fg: 'text', bg: 'background'},
  {fg: 'text', bg: 'surface'},
  {fg: 'mutedText', bg: 'background'},
  {fg: 'mutedText', bg: 'surface'},
  {fg: 'accent', bg: 'background'},
  {fg: 'accent', bg: 'surface'},
  {fg: 'danger', bg: 'background'},
  {fg: 'danger', bg: 'surface'},
  {fg: 'warning', bg: 'background'},
  {fg: 'warning', bg: 'surface'},
  {fg: 'success', bg: 'background'},
  {fg: 'success', bg: 'surface'},
];

export interface ContrastFailure {
  theme: ThemeName;
  fg: keyof ThemeTokens;
  bg: keyof ThemeTokens;
  ratio: number;
}

/** Gate-facing entry point: checks every pair in `pairs` against every
 * theme named in `themeNames`, generically. Defaults to the real shipped
 * THEMES/CONTRAST_PAIRS/THEME_NAMES — the form the merge gate exercises;
 * the parameters exist so tests can exercise the same logic against small
 * (including deliberately broken) fixtures. */
export function checkTokenContrast(
  themes: Record<ThemeName, ThemeTokens> = THEMES,
  pairs: TokenPair[] = CONTRAST_PAIRS,
  themeNames: ThemeName[] = THEME_NAMES,
): ContrastFailure[] {
  const failures: ContrastFailure[] = [];
  for (const themeName of themeNames) {
    const tokens = themes[themeName];
    for (const {fg, bg} of pairs) {
      if (!meetsWcagAA(tokens[fg], tokens[bg])) {
        failures.push({theme: themeName, fg, bg, ratio: contrastRatio(tokens[fg], tokens[bg])});
      }
    }
  }
  return failures;
}
