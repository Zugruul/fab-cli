// #217: injectable boundary for the raw system-locale string — mirrors
// onboarding/types.ts's NetworkStateSource pattern. The design doc calls
// for detection via Hermes's Intl rather than a new native module
// (react-native-localize would need native linking the jest gate can't
// exercise); Intl.DateTimeFormat().resolvedOptions().locale is available
// in both Hermes and Node, so the default source works identically in the
// app and under jest with no mocking required.

export interface SystemLocaleSource {
  getSystemLocale(): string;
}

export const intlSystemLocaleSource: SystemLocaleSource = {
  getSystemLocale(): string {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  },
};
