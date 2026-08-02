// Manual jest mock for react-native-fast-tflite (jest.config.js maps the
// real package to this file). No native TFLite runtime exists in the jest
// environment; this stub only needs to exist as a function export so
// checkTflite()'s "module loaded" smoke check passes.
export function loadTensorflowModel() {
  return Promise.resolve(undefined);
}
