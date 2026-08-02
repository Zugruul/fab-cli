// #219 acceptance criterion 4(b) (continued): checkTokenContrast is the
// gate-facing entry point — it iterates every foreground-role-on-
// background-role pair in CONTRAST_PAIRS against every registered theme,
// generically (mirrors ../../i18n/checkParity.ts's checkAllLocalesParity:
// a pairwise primitive re-used across a data-driven registered set, so
// adding a theme or a pair needs no new check logic here). Exercised here
// against small fixtures (including a deliberately broken one) AND against
// the real shipped THEMES/CONTRAST_PAIRS, so a future PR that adds a token
// pair without sufficient contrast fails this suite — which `npm run
// test:run` runs as part of `npm run gate`.

import { checkTokenContrast, CONTRAST_PAIRS } from '../tokenContrastGate';
import { THEMES, THEME_NAMES } from '../tokens';
import type { ThemeName, ThemeTokens } from '../tokens';

const GOOD_LIGHT: ThemeTokens = {
  background: '#ffffff',
  surface: '#f7f7f7',
  text: '#000000',
  mutedText: '#666666',
  border: '#cccccc',
  accent: '#0968d6',
  danger: '#cc3333',
  warning: '#916c00',
  success: '#1a7f37',
};

describe('checkTokenContrast (gate-facing, data-driven over pairs x themes)', () => {
  it('reports no failures for a well-designed fixture theme', () => {
    const themes: Record<ThemeName, ThemeTokens> = { light: GOOD_LIGHT, dark: THEMES.dark };
    const failures = checkTokenContrast(themes, CONTRAST_PAIRS, ['light']);
    expect(failures).toEqual([]);
  });

  it('flags a pair whose contrast falls below WCAG AA (broken-token fixture)', () => {
    const brokenThemes: Record<ThemeName, ThemeTokens> = {
      light: { ...GOOD_LIGHT, mutedText: '#cccccc' }, // too light on white — fails 4.5:1
      dark: THEMES.dark,
    };
    const failures = checkTokenContrast(brokenThemes, CONTRAST_PAIRS, ['light']);
    expect(
      failures.some(f => f.theme === 'light' && f.fg === 'mutedText' && f.bg === 'background'),
    ).toBe(true);
    expect(
      failures.some(f => f.theme === 'light' && f.fg === 'mutedText' && f.bg === 'surface'),
    ).toBe(true);
    // unrelated pairs in the same theme stay unaffected
    expect(failures.some(f => f.fg === 'text')).toBe(false);
  });

  it('reports the actual computed ratio alongside each failure', () => {
    const brokenThemes: Record<ThemeName, ThemeTokens> = {
      light: { ...GOOD_LIGHT, danger: '#eeeeee' },
      dark: THEMES.dark,
    };
    const failures = checkTokenContrast(brokenThemes, CONTRAST_PAIRS, ['light']);
    const failure = failures.find(f => f.fg === 'danger' && f.bg === 'background');
    expect(failure).toBeDefined();
    expect(failure!.ratio).toBeLessThan(4.5);
  });

  it('adding a theme to the input is picked up automatically, no code change needed', () => {
    const themes: Record<string, ThemeTokens> = {
      light: GOOD_LIGHT,
      dark: THEMES.dark,
      highContrast: { ...THEMES.dark, text: '#ffffff', background: '#000000' },
    };
    const failures = checkTokenContrast(
      themes as unknown as Record<ThemeName, ThemeTokens>,
      CONTRAST_PAIRS,
      ['light', 'dark', 'highContrast'] as unknown as ThemeName[],
    );
    expect(failures).toEqual([]);
  });

  it('has full WCAG AA contrast for every registered pair, in every real shipped theme', () => {
    // Covers exactly whatever's currently registered — no hardcoded pair or
    // theme name.
    const failures = checkTokenContrast();
    expect(failures).toEqual([]);
  });

  it('CONTRAST_PAIRS covers every non-decorative role used by shipped screens', () => {
    // "border" is decorative-only (no text is ever rendered in that color),
    // so WCAG's text-contrast requirement doesn't apply to it — it's
    // intentionally absent from the pair table.
    const roles = new Set(CONTRAST_PAIRS.flatMap(p => [p.fg, p.bg]));
    expect(roles.has('border')).toBe(false);
    for (const role of ['text', 'mutedText', 'accent', 'danger', 'warning', 'success'] as const) {
      expect(CONTRAST_PAIRS.some(p => p.fg === role)).toBe(true);
    }
  });

  it('covers exactly the currently-registered THEME_NAMES by default', () => {
    expect(THEME_NAMES).toEqual(['light', 'dark']);
  });
});
