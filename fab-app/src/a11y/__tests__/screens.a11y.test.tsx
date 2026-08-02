/**
 * @format
 */

// #218 (SPEC-APP.md §9.12): every current screen's interactive elements
// must expose an accessible name + role (assertAccessibleTree.ts). This
// suite is the "adding a future screen requires only registering it, not
// new check logic" mechanism the brief asks for — the SCREENS table
// (extracted to ./screenRegistry.tsx by #219 so #219's own theme suites
// reuse it) is the only thing a new screen touches; the it.each loop and
// the assertion itself never change. Mirrors #217's own zero-config pattern
// (SUPPORTED_LOCALES / LOCALE_BUNDLES iteration) one level up: that one
// is generic over locales, this one is generic over screens+locales.
//
// #219 acceptance criterion 5: the walk now also runs under both themes
// (light/dark) — a theme × locale matrix, cheap since both dimensions are
// already data-driven (SUPPORTED_LOCALES, THEME_NAMES). assertAccessibleTree
// itself doesn't care about color, but forcing each screen through both
// themes proves rendering + the accessibility walk hold regardless of which
// theme's tokens a screen resolves — a screen that threw or lost an
// accessible name under only one theme would otherwise go undetected here.
//
// Accessible names sourced from i18n text are asserted generically (via
// the walker's own non-empty-string check) — not against a specific
// locale's literal string — so this suite doesn't need its own
// per-locale-string assertions; #217's screen test files already own
// verifying the *content* of translated copy.

// See src/theme/__tests__/useTheme.test.tsx for why useColorScheme is
// mocked via a Proxy pass-through rather than spreading the whole
// react-native module: spreading eagerly evaluates every lazy getter on
// RN's index (including native-module-backed ones like DevMenu), which
// throws under jest's headless environment.
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  const mockUseColorScheme = jest.fn();
  return new Proxy(actual, {
    get(target, prop, receiver) {
      if (prop === 'useColorScheme') {
        return mockUseColorScheme;
      }
      return Reflect.get(target, prop, receiver);
    },
  });
});

import {useColorScheme} from 'react-native';

import {assertAccessibleTree} from '../assertAccessibleTree';
import {SUPPORTED_LOCALES} from '../../i18n/locales';
import {THEME_NAMES} from '../../theme/tokens';
import {SCREENS} from './screenRegistry';

const mockUseColorScheme = useColorScheme as jest.Mock;

describe.each(SUPPORTED_LOCALES)('a11y: every interactive element has a name + role (%s)', locale => {
  describe.each(THEME_NAMES)('theme: %s', themeName => {
    beforeEach(() => {
      mockUseColorScheme.mockReturnValue(themeName);
    });

    it.each(SCREENS.map(s => [`${s.screen} — ${s.variant}`, s.render] as const))('%s', async (_label, render) => {
      const tree = await render(locale);
      assertAccessibleTree(tree.root);
    });
  });
});
