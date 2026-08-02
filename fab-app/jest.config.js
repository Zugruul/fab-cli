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
  },
};
