import type { ModuleId, SmokeAction, SmokeState } from './types';

export const MODULE_IDS: ModuleId[] = ['llama', 'sqlite', 'camera', 'tflite'];

export function initialSmokeState(): SmokeState {
  const state = {} as SmokeState;
  for (const id of MODULE_IDS) {
    state[id] = { status: 'idle' };
  }
  return state;
}

export function smokeReducer(
  state: SmokeState,
  action: SmokeAction,
): SmokeState {
  switch (action.type) {
    case 'CHECK_START':
      return { ...state, [action.module]: { status: 'checking' } };
    case 'CHECK_OK':
      return {
        ...state,
        [action.module]: { status: 'ok', detail: action.detail },
      };
    case 'CHECK_ERROR':
      return {
        ...state,
        [action.module]: { status: 'error', detail: action.detail },
      };
    case 'RESET':
      return initialSmokeState();
    default:
      return state;
  }
}
