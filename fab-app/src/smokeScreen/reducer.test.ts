import { MODULE_IDS, initialSmokeState, smokeReducer } from './reducer';
import type { SmokeState } from './types';

describe('initialSmokeState', () => {
  it('starts every module at idle with no detail', () => {
    const state = initialSmokeState();
    for (const id of MODULE_IDS) {
      expect(state[id]).toEqual({ status: 'idle' });
    }
  });

  it('covers exactly the four native pillars', () => {
    expect(MODULE_IDS.sort()).toEqual(['camera', 'llama', 'sqlite', 'tflite']);
  });
});

describe('smokeReducer', () => {
  let state: SmokeState;

  beforeEach(() => {
    state = initialSmokeState();
  });

  it('CHECK_START moves the target module to checking and drops any prior detail', () => {
    const next = smokeReducer(state, { type: 'CHECK_START', module: 'llama' });
    expect(next.llama).toEqual({ status: 'checking' });
  });

  it('CHECK_OK records ok status with the reported detail', () => {
    const next = smokeReducer(state, {
      type: 'CHECK_OK',
      module: 'sqlite',
      detail: 'vec0 nearest distance 0',
    });
    expect(next.sqlite).toEqual({ status: 'ok', detail: 'vec0 nearest distance 0' });
  });

  it('CHECK_ERROR records error status with a required detail message', () => {
    const next = smokeReducer(state, {
      type: 'CHECK_ERROR',
      module: 'camera',
      detail: 'permission denied',
    });
    expect(next.camera).toEqual({ status: 'error', detail: 'permission denied' });
  });

  it('only touches the targeted module, leaving the other three untouched', () => {
    const next = smokeReducer(state, { type: 'CHECK_START', module: 'tflite' });
    expect(next.llama).toEqual({ status: 'idle' });
    expect(next.sqlite).toEqual({ status: 'idle' });
    expect(next.camera).toEqual({ status: 'idle' });
  });

  it('RESET returns every module to idle regardless of prior state', () => {
    const settled = smokeReducer(state, {
      type: 'CHECK_ERROR',
      module: 'llama',
      detail: 'native module not linked',
    });
    const reset = smokeReducer(settled, { type: 'RESET' });
    expect(reset).toEqual(initialSmokeState());
  });

  it('is pure: it never mutates the state object it was given', () => {
    const before = JSON.stringify(state);
    smokeReducer(state, { type: 'CHECK_START', module: 'llama' });
    expect(JSON.stringify(state)).toEqual(before);
  });
});
