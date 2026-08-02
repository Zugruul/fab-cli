module.exports = {
  preset: '@react-native/jest-preset',
  // Native modules mocked for the merge-gating test run (SPEC-APP.md §15
  // "App (merge-gating): ... with llama.rn/tflite mocked"). None of these
  // four packages have a real native binding available in a headless jest
  // environment (no device/simulator); the device-only behaviour they wrap
  // (src/smokeScreen/checks.ts, SmokeScreen.tsx's camera hooks) is exercised
  // by a human per APP-030's device smoke test, not by this suite.
  moduleNameMapper: {
    '^llama\\.rn$': '<rootDir>/__mocks__/llamaRn.ts',
    '^@op-engineering/op-sqlite$': '<rootDir>/__mocks__/opSqlite.ts',
    '^react-native-vision-camera$': '<rootDir>/__mocks__/visionCamera.ts',
    '^react-native-fast-tflite$': '<rootDir>/__mocks__/fastTflite.ts',
    // @fab/manifest-schema (APP-031) ships plain NodeNext-style TS source
    // with explicit ".js" relative-import specifiers (resolved to the
    // sibling .ts files by tsc/vitest, its own build/test tooling) — jest's
    // resolver has no NodeNext mode, so strip the extension and let
    // moduleFileExtensions (which includes "ts") find the .ts file instead.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // Extends the preset's own pattern (which allows-through (jest-)?react-native
  // and @react-native(-community)? packages) rather than replacing it — jest
  // does not merge transformIgnorePatterns across preset + config.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@fab/manifest-schema)/)',
  ],
  // Default testPathIgnorePatterns is just ["/node_modules/"]; re-declaring
  // it here (jest doesn't merge this option with the preset/default) to
  // also exclude shared test-double/fixture files that live under
  // __tests__/ alongside real *.test.ts files but aren't themselves a test
  // suite (jest's default testMatch otherwise treats every file directly
  // under __tests__/ as one, regardless of name).
  //
  // screenRegistry.tsx (#219) is the same pattern one level up: the SCREENS
  // registration table shared by src/a11y/__tests__/screens.a11y.test.tsx
  // and src/theme/__tests__/screens.theme.test.tsx.
  testPathIgnorePatterns: [
    '/node_modules/',
    '/__tests__/testDoubles\\.ts$',
    '/__tests__/screenRegistry\\.tsx$',
  ],
};
