// Manual jest mock for llama.rn (jest.config.js maps the real package to
// this file). llama.rn ships its own jest/mock.js, but it re-exports its
// real (uncompiled TS/ESM) src/ via jest.requireActual — that needs a babel
// transform Jest doesn't apply to hoisted node_modules by default, and pulling
// it in would mean transforming llama.cpp's JS glue in the merge gate for no
// real benefit. This stub covers exactly what src/smokeScreen/checks.ts calls.
export const BuildInfo = { number: 'mock', commit: 'mock' };

export function installJsi(): Promise<void> {
  return Promise.resolve();
}
