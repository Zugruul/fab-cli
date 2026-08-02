// #217 acceptance criterion 5(a): the gate must fail on hardcoded
// user-facing JSX string literals. That gate rule is `.eslintrc.js`'s
// `react/jsx-no-literals` override (scoped to App.tsx + src/**/*.tsx,
// excluding test files, which legitimately render fixture text). This
// suite runs the project's *actual* configured ESLint (not a hand-rolled
// duplicate config) against small in-memory fixtures, so it proves the
// gate rule itself is wired and behaves as intended — per the brief's
// "the parity check and no-literal lint are themselves gate code —
// testable" instruction.

import { ESLint } from 'eslint';
import * as path from 'path';

const fabAppRoot = path.resolve(__dirname, '../../..');

function createLinter(): ESLint {
  return new ESLint({ cwd: fabAppRoot });
}

describe('react/jsx-no-literals gate (#217 no-hardcoded-JSX-literals)', () => {
  it('flags a raw string literal used as JSX children in production src', async () => {
    const eslint = createLinter();
    const code = [
      "import React from 'react';",
      "import { Text } from 'react-native';",
      'export function X(): React.JSX.Element {',
      '  return <Text>Hello world</Text>;',
      '}',
      '',
    ].join('\n');

    const results = await eslint.lintText(code, {
      filePath: path.join(fabAppRoot, 'src/i18n/__fixtures__/hardcoded.tsx'),
    });

    expect(results[0].messages.some(m => m.ruleId === 'react/jsx-no-literals')).toBe(true);
  });

  it('flags a raw string literal wrapped in a JSX expression container', async () => {
    const eslint = createLinter();
    const code = [
      "import React from 'react';",
      "import { Text } from 'react-native';",
      'export function X(): React.JSX.Element {',
      "  return <Text>{'Hello world'}</Text>;",
      '}',
      '',
    ].join('\n');

    const results = await eslint.lintText(code, {
      filePath: path.join(fabAppRoot, 'src/i18n/__fixtures__/hardcodedContainer.tsx'),
    });

    expect(results[0].messages.some(m => m.ruleId === 'react/jsx-no-literals')).toBe(true);
  });

  it('does not flag JSX children driven through the i18n t() function', async () => {
    const eslint = createLinter();
    const code = [
      "import React from 'react';",
      "import { Text } from 'react-native';",
      "import { useTranslation } from 'react-i18next';",
      'export function X(): React.JSX.Element {',
      '  const { t } = useTranslation();',
      "  return <Text>{t('x.y')}</Text>;",
      '}',
      '',
    ].join('\n');

    const results = await eslint.lintText(code, {
      filePath: path.join(fabAppRoot, 'src/i18n/__fixtures__/translated.tsx'),
    });

    expect(results[0].messages.some(m => m.ruleId === 'react/jsx-no-literals')).toBe(false);
  });

  it('does not flag literal JSX text inside a test file (fixture content, not shipped UI copy)', async () => {
    const eslint = createLinter();
    const code = [
      "import React from 'react';",
      "import { Text } from 'react-native';",
      "test('x', () => {",
      '  const el = <Text>Ask a question</Text>;',
      '  expect(el).toBeTruthy();',
      '});',
      '',
    ].join('\n');

    const results = await eslint.lintText(code, {
      filePath: path.join(fabAppRoot, 'src/i18n/__tests__/hardcoded.test.tsx'),
    });

    expect(results[0].messages.some(m => m.ruleId === 'react/jsx-no-literals')).toBe(false);
  });
});
