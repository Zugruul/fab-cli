// Device smoke screen (APP-030 / SPEC-APP.md §9.1): exercises the four
// native pillars fab-app depends on — llama.rn, op-sqlite (+sqlite-vec),
// react-native-vision-camera, react-native-fast-tflite — and reports whether
// each one linked correctly on the running device. Types here are pure
// (no RN import) so the reducer/summary logic is unit-testable without a
// device or native mocks.

export type ModuleId = 'llama' | 'sqlite' | 'camera' | 'tflite';

export type ModuleStatus = 'idle' | 'checking' | 'ok' | 'error';

export interface ModuleCheckResult {
  status: ModuleStatus;
  detail?: string;
}

export type SmokeState = Record<ModuleId, ModuleCheckResult>;

export type SmokeAction =
  | { type: 'CHECK_START'; module: ModuleId }
  | { type: 'CHECK_OK'; module: ModuleId; detail?: string }
  | { type: 'CHECK_ERROR'; module: ModuleId; detail: string }
  | { type: 'RESET' };

// Module display labels moved to the i18n bundles (#217 —
// src/i18n/locales/{en,pt-BR}.json's smoke.modules.<id>); SmokeScreen.tsx
// looks them up via t() instead of this constant.
