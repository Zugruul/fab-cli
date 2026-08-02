import { MODULE_IDS } from './reducer';
import type { SmokeState } from './types';

export interface SmokeSummary {
  okCount: number;
  errorCount: number;
  pendingCount: number;
  allSettled: boolean;
}

export function summarizeSmokeState(state: SmokeState): SmokeSummary {
  let okCount = 0;
  let errorCount = 0;
  let pendingCount = 0;
  for (const id of MODULE_IDS) {
    const { status } = state[id];
    if (status === 'ok') {
      okCount += 1;
    } else if (status === 'error') {
      errorCount += 1;
    } else {
      pendingCount += 1;
    }
  }
  return { okCount, errorCount, pendingCount, allSettled: pendingCount === 0 };
}
