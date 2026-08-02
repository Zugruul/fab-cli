// Manual jest mock for react-native-vision-camera (jest.config.js maps the
// real package to this file). Its permission/device APIs are hooks backed
// by native Nitro modules that don't exist in the jest environment, so this
// stub covers exactly what src/smokeScreen/SmokeScreen.tsx calls.
export function useCameraPermission() {
  return {
    status: 'authorized' as const,
    hasPermission: true,
    canRequestPermission: false,
    requestPermission: jest.fn(async () => true),
  };
}

export function useCameraDevices() {
  return [];
}
