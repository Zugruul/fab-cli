/**
 * @format
 */

// #219 acceptance criterion 5 (second half): a theme-specific generic check
// that every registered screen renders under both themes without throwing —
// separate from screens.a11y.test.tsx's theme x locale accessibility walk
// (which also now runs under both themes), this suite only asserts the
// render itself succeeds, reusing the exact same SCREENS registration table
// (src/a11y/__tests__/screenRegistry.tsx) so a future screen needs no new
// check logic here either — only registering it once, in one place.

// See src/theme/__tests__/useTheme.test.tsx for why useColorScheme is
// mocked via a Proxy pass-through rather than spreading the whole
// react-native module.
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

import {SCREENS} from '../../a11y/__tests__/screenRegistry';
import {THEME_NAMES} from '../tokens';

const mockUseColorScheme = useColorScheme as jest.Mock;

describe.each(THEME_NAMES)('theme: every registered screen renders without throwing (%s)', themeName => {
  beforeEach(() => {
    mockUseColorScheme.mockReturnValue(themeName);
  });

  it.each(SCREENS.map(s => [`${s.screen} — ${s.variant}`, s.render] as const))('%s', async (_label, render) => {
    const tree = await render('en');
    expect(tree.root).toBeTruthy();
  });
});
