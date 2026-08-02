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
    {
      // #218: every Touchable/Pressable/TextInput in shipped UI must carry
      // enough a11y props for VoiceOver/TalkBack to announce it — gate-
      // enforced per SPEC-APP.md §9.12. `basic` (not `ios`/`android`/`all`)
      // is the WCAG-informed core common to both platforms (accessible
      // name + role/hint/actions/state/value + no-nested-touchables); the
      // iOS/Android "extra" configs add rules for surfaces this app
      // doesn't have yet (e.g. <Image accessibilityIgnoresInvertColors>),
      // which would force preemptive props on elements that don't exist —
      // see PR body for the full justification. Scoped away from test
      // files for the same reason as the #217 override above: fixture
      // elements rendered in tests are sample data, not shipped UI.
      files: ['App.tsx', 'src/**/*.tsx'],
      excludedFiles: ['**/__tests__/**', '**/*.test.tsx'],
      extends: ['plugin:react-native-a11y/basic'],
    },
  ],
};
