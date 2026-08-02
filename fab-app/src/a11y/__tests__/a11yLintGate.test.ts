// #218 (SPEC-APP.md §9.12) acceptance criterion 2: the gate must fail on a
// Touchable/Pressable/TextInput with no accessibility wiring at all. That
// gate rule is `.eslintrc.js`'s `plugin:react-native-a11y/basic` override
// (scoped to App.tsx + src/**/*.tsx, excluding test files — same scoping
// rationale as the #217 `react/jsx-no-literals` override right above it:
// fixture elements rendered in tests are sample data, not shipped UI).
// This suite runs the project's *actual* configured ESLint (not a
// hand-rolled duplicate config) against small in-memory fixtures, mirroring
// src/i18n/__tests__/noHardcodedJsxLiterals.test.ts exactly.

import {ESLint} from 'eslint';
import * as path from 'path';

const fabAppRoot = path.resolve(__dirname, '../../..');

function createLinter(): ESLint {
  return new ESLint({cwd: fabAppRoot});
}

describe('react-native-a11y gate (#218 a11y lint)', () => {
  it('flags a TouchableOpacity with no accessibility props at all in production src', async () => {
    const eslint = createLinter();
    const code = [
      "import React from 'react';",
      "import { Text, TouchableOpacity } from 'react-native';",
      'export function X(): React.JSX.Element {',
      '  return <TouchableOpacity onPress={() => {}}><Text>Go</Text></TouchableOpacity>;',
      '}',
      '',
    ].join('\n');

    const results = await eslint.lintText(code, {
      filePath: path.join(fabAppRoot, 'src/a11y/__fixtures__/missingA11y.tsx'),
    });

    expect(results[0].messages.some(m => m.ruleId === 'react-native-a11y/has-valid-accessibility-descriptors')).toBe(
      true,
    );
  });

  it('does not flag a TouchableOpacity that has an accessibilityRole set', async () => {
    const eslint = createLinter();
    const code = [
      "import React from 'react';",
      "import { Text, TouchableOpacity } from 'react-native';",
      'export function X(): React.JSX.Element {',
      '  return <TouchableOpacity accessibilityRole="button" onPress={() => {}}><Text>Go</Text></TouchableOpacity>;',
      '}',
      '',
    ].join('\n');

    const results = await eslint.lintText(code, {
      filePath: path.join(fabAppRoot, 'src/a11y/__fixtures__/wired.tsx'),
    });

    expect(results[0].messages.some(m => m.ruleId === 'react-native-a11y/has-valid-accessibility-descriptors')).toBe(
      false,
    );
  });

  it('flags an accessibilityRole value that is not a real role', async () => {
    const eslint = createLinter();
    const code = [
      "import React from 'react';",
      "import { Text, TouchableOpacity } from 'react-native';",
      'export function X(): React.JSX.Element {',
      '  return <TouchableOpacity accessibilityRole="notarealrole" onPress={() => {}}><Text>Go</Text></TouchableOpacity>;',
      '}',
      '',
    ].join('\n');

    const results = await eslint.lintText(code, {
      filePath: path.join(fabAppRoot, 'src/a11y/__fixtures__/invalidRole.tsx'),
    });

    expect(results[0].messages.some(m => m.ruleId === 'react-native-a11y/has-valid-accessibility-role')).toBe(true);
  });

  it('does not flag a bare Touchable inside a test file (fixture element, not shipped UI)', async () => {
    const eslint = createLinter();
    const code = [
      "import React from 'react';",
      "import { Text, TouchableOpacity } from 'react-native';",
      "test('x', () => {",
      "  const el = <TouchableOpacity onPress={() => {}}><Text>Go</Text></TouchableOpacity>;",
      '  expect(el).toBeTruthy();',
      '});',
      '',
    ].join('\n');

    const results = await eslint.lintText(code, {
      filePath: path.join(fabAppRoot, 'src/a11y/__tests__/fixture.test.tsx'),
    });

    expect(results[0].messages.some(m => m.ruleId?.startsWith('react-native-a11y/'))).toBe(false);
  });
});
