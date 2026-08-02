// The primitive LifecycleManager uses to implement §9.6's memory-pressure-
// during-generation decision: finish-then-release with a bounded wait
// (never abort a generation, but never block Jetsam avoidance indefinitely
// on a stuck one either).

export interface GenerationWaitResult {
  finishedInTime: boolean;
}

export class GenerationGate {
  private activeCount = 0;
  private idleWaiters: Array<() => void> = [];

  begin(): void {
    this.activeCount += 1;
  }

  end(): void {
    if (this.activeCount === 0) return;
    this.activeCount -= 1;
    if (this.activeCount === 0) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      waiters.forEach((notify) => notify());
    }
  }

  get isActive(): boolean {
    return this.activeCount > 0;
  }

  /** Resolves once no generation is active, or after `timeoutMs` if one
   * never finishes — `finishedInTime` distinguishes the two so the caller
   * can record a forced release. */
  waitUntilIdle(timeoutMs: number): Promise<GenerationWaitResult> {
    if (this.activeCount === 0) {
      return Promise.resolve({ finishedInTime: true });
    }

    return new Promise((resolve) => {
      let settled = false;

      const onIdle = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ finishedInTime: true });
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.idleWaiters = this.idleWaiters.filter((w) => w !== onIdle);
        resolve({ finishedInTime: false });
      }, timeoutMs);

      this.idleWaiters.push(onIdle);
    });
  }
}
