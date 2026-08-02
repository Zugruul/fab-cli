import { initialSmokeState, smokeReducer } from './reducer';
import { summarizeSmokeState } from './summary';
import type { SmokeState } from './types';

function apply(state: SmokeState, actions: Parameters<typeof smokeReducer>[1][]): SmokeState {
  return actions.reduce(smokeReducer, state);
}

describe('summarizeSmokeState', () => {
  it('reports all four modules pending before any check runs', () => {
    const summary = summarizeSmokeState(initialSmokeState());
    expect(summary).toEqual({ okCount: 0, errorCount: 0, pendingCount: 4, allSettled: false });
  });

  it('counts checking as pending, not settled', () => {
    const state = apply(initialSmokeState(), [{ type: 'CHECK_START', module: 'llama' }]);
    const summary = summarizeSmokeState(state);
    expect(summary.pendingCount).toBe(4);
    expect(summary.allSettled).toBe(false);
  });

  it('splits ok vs error counts once modules settle', () => {
    const state = apply(initialSmokeState(), [
      { type: 'CHECK_OK', module: 'llama', detail: 'linked' },
      { type: 'CHECK_OK', module: 'sqlite', detail: 'vec0 ok' },
      { type: 'CHECK_ERROR', module: 'camera', detail: 'permission denied' },
      { type: 'CHECK_OK', module: 'tflite', detail: 'module loaded' },
    ]);
    expect(summarizeSmokeState(state)).toEqual({
      okCount: 3,
      errorCount: 1,
      pendingCount: 0,
      allSettled: true,
    });
  });

  it('allSettled is only true once every module is ok or error', () => {
    const threeSettled = apply(initialSmokeState(), [
      { type: 'CHECK_OK', module: 'llama', detail: 'linked' },
      { type: 'CHECK_OK', module: 'sqlite', detail: 'vec0 ok' },
      { type: 'CHECK_ERROR', module: 'camera', detail: 'permission denied' },
    ]);
    expect(summarizeSmokeState(threeSettled).allSettled).toBe(false);
  });
});
