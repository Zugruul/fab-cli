// #219 acceptance criterion 2: the active theme follows the system scheme
// via RN's useColorScheme() (Appearance API), and updates live when the
// system scheme changes (no remount needed).
//
// react-native's `useColorScheme` export is a lazy getter on the module's
// index (`get useColorScheme() { return require('./Libraries/Utilities/
// useColorScheme').default; }`) — spreading the whole module in a mock
// factory (`{...jest.requireActual('react-native'), useColorScheme: fn}`)
// eagerly evaluates *every* lazy getter, including native-module-backed
// ones (e.g. DevMenu), which throws under jest's headless environment. A
// Proxy that only intercepts the one property we need to control keeps
// every other RN export lazy exactly as before, so the rest of RN's
// surface (Text, View, StyleSheet, ...) behaves unmocked.
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

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { useColorScheme } from 'react-native';

import { useTheme, resolveThemeName, type Theme } from '../useTheme';
import { THEMES } from '../tokens';

const mockUseColorScheme = useColorScheme as jest.Mock;

describe('resolveThemeName (pure)', () => {
  it.each([
    ['dark', 'dark'],
    ['light', 'light'],
    [null, 'light'],
    [undefined, 'light'],
    ['some-future-scheme', 'light'],
  ])('resolves %p to %p', (scheme, expected) => {
    expect(resolveThemeName(scheme as never)).toBe(expected);
  });
});

describe('useTheme (follows the system color scheme live)', () => {
  function Probe({ onRender }: { onRender: (theme: Theme) => void }): null {
    const theme = useTheme();
    onRender(theme);
    return null;
  }

  it('resolves the light token set when the system scheme is light', () => {
    mockUseColorScheme.mockReturnValue('light');
    let captured: Theme | undefined;
    act(() => {
      ReactTestRenderer.create(<Probe onRender={t => (captured = t)} />);
    });
    expect(captured).toEqual({ name: 'light', tokens: THEMES.light });
  });

  it('resolves the dark token set when the system scheme is dark', () => {
    mockUseColorScheme.mockReturnValue('dark');
    let captured: Theme | undefined;
    act(() => {
      ReactTestRenderer.create(<Probe onRender={t => (captured = t)} />);
    });
    expect(captured).toEqual({ name: 'dark', tokens: THEMES.dark });
  });

  it('defaults to light when the system reports no preference', () => {
    mockUseColorScheme.mockReturnValue(null);
    let captured: Theme | undefined;
    act(() => {
      ReactTestRenderer.create(<Probe onRender={t => (captured = t)} />);
    });
    expect(captured?.name).toBe('light');
  });

  it('updates live when the system scheme changes, without remounting', () => {
    mockUseColorScheme.mockReturnValue('light');
    const renders: Theme[] = [];
    let tree: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(<Probe onRender={t => renders.push(t)} />);
    });
    expect(renders.map(r => r.name)).toEqual(['light']);

    mockUseColorScheme.mockReturnValue('dark');
    act(() => {
      tree.update(<Probe onRender={t => renders.push(t)} />);
    });
    expect(renders.map(r => r.name)).toEqual(['light', 'dark']);
    expect(renders[1].tokens).toEqual(THEMES.dark);
  });
});
