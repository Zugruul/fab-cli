// APP-024 (#136): pure reducer for BenchmarkScreen's async run lifecycle —
// mirrors ../smokeScreen/reducer.ts's split of state logic from the React
// component, so this is unit-testable with no renderer/native mocks.

import type { BenchmarkRunResult } from './types';

export type BenchmarkScreenStatus = 'idle' | 'running' | 'done' | 'error';

export type BenchmarkScreenState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; result: BenchmarkRunResult }
  | { status: 'error'; errorMessage: string };

export type BenchmarkScreenAction =
  | { type: 'RUN_START' }
  | { type: 'RUN_OK'; result: BenchmarkRunResult }
  | { type: 'RUN_ERROR'; message: string };

export function initialBenchmarkScreenState(): BenchmarkScreenState {
  return { status: 'idle' };
}

export function benchmarkScreenReducer(
  _state: BenchmarkScreenState,
  action: BenchmarkScreenAction,
): BenchmarkScreenState {
  switch (action.type) {
    case 'RUN_START':
      return { status: 'running' };
    case 'RUN_OK':
      return { status: 'done', result: action.result };
    case 'RUN_ERROR':
      return { status: 'error', errorMessage: action.message };
    default:
      return _state;
  }
}
