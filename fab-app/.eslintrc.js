module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {
      // #217: every user-facing JSX string must flow through the i18n
      // layer (react-i18next's t()), not a hardcoded literal — gate-
      // enforced per SPEC-APP.md §9.11. Scoped away from test files:
      // fixture text rendered in tests (e.g. `<Text>Ask a question</Text>`
      // in FeatureGate.test.tsx) is sample data, not shipped UI copy.
      files: ['App.tsx', 'src/**/*.tsx'],
      excludedFiles: ['**/__tests__/**', '**/*.test.tsx'],
      rules: {
        'react/jsx-no-literals': ['error', { noStrings: true, ignoreProps: true }],
      },
    },
  ],
};
