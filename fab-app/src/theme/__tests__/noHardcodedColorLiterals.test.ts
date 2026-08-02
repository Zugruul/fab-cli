// #219 acceptance criterion 4(a): the gate must fail on a raw color literal
// in shipped screen source. That gate rule is `.eslintrc.js`'s
// `react-native/no-color-literals` override (scoped identically to #217's
// `react/jsx-no-literals` and #218's `react-native-a11y/basic` overrides:
// App.tsx + src/**/*.tsx, test files excluded — fixture colors rendered in
// tests are sample data, not shipped UI). `eslint-plugin-react-native` is
// already a transitive dependency of `@react-native/eslint-config` (which
// fab-app's `.eslintrc.js` extends via `@react-native`) and is already
// registered in that config's `plugins` array — no new dependency needed
// for this rule. This suite runs the project's *actual* configured ESLint
// (not a hand-rolled duplicate config) against small in-memory fixtures,
// mirroring src/i18n/__tests__/noHardcodedJsxLiterals.test.ts and
// src/a11y/__tests__/a11yLintGate.test.ts exactly.

import { ESLint } from 'eslint';
import * as path from 'path';

const fabAppRoot = path.resolve(__dirname, '../../..');

function createLinter(): ESLint {
  return new ESLint({ cwd: fabAppRoot });
}

describe('react-native/no-color-literals gate (#219 no-hardcoded-color-literals)', () => {
  it('flags a hex color literal inside a StyleSheet.create() declaration in production src', async () => {
    const eslint = createLinter();
    const code = [
      "import { StyleSheet } from 'react-native';",
      'export const styles = StyleSheet.create({',
      "  row: { color: '#333333' },",
      '});',
      '',
    ].join('\n');

    const results = await eslint.lintText(code, {
      filePath: path.join(fabAppRoot, 'src/theme/__fixtures__/hardcodedStylesheet.tsx'),
    });

    expect(results[0].messages.some(m => m.ruleId === 'react-native/no-color-literals')).toBe(true);
  });

  it('flags a hex color literal in an inline JSX style object', async () => {
    const eslint = createLinter();
    const code = [
      "import React from 'react';",
      "import { Text } from 'react-native';",
      'export function X(): React.JSX.Element {',
      "  return <Text style={{ color: '#ff0000' }}>hi</Text>;",
      '}',
      '',
    ].join('\n');

    const results = await eslint.lintText(code, {
      filePath: path.join(fabAppRoot, 'src/theme/__fixtures__/hardcodedInline.tsx'),
    });

    expect(results[0].messages.some(m => m.ruleId === 'react-native/no-color-literals')).toBe(true);
  });

  it('does not flag a StyleSheet declaration whose color comes from a token variable', async () => {
    const eslint = createLinter();
    const code = [
      "import { StyleSheet } from 'react-native';",
      "const tokens = { text: '#000000' };",
      'export const styles = StyleSheet.create({',
      '  row: { color: tokens.text },',
      '});',
      '',
    ].join('\n');

    const results = await eslint.lintText(code, {
      filePath: path.join(fabAppRoot, 'src/theme/__fixtures__/tokenized.tsx'),
    });

    expect(results[0].messages.some(m => m.ruleId === 'react-native/no-color-literals')).toBe(false);
  });

  it('does not flag a color literal inside a test file (fixture content, not shipped UI)', async () => {
    const eslint = createLinter();
    const code = [
      "import { StyleSheet } from 'react-native';",
      "test('x', () => {",
      "  const styles = StyleSheet.create({ row: { color: '#333333' } });",
      '  expect(styles).toBeTruthy();',
      '});',
      '',
    ].join('\n');

    const results = await eslint.lintText(code, {
      filePath: path.join(fabAppRoot, 'src/theme/__tests__/fixture.test.tsx'),
    });

    expect(results[0].messages.some(m => m.ruleId === 'react-native/no-color-literals')).toBe(false);
  });
});
