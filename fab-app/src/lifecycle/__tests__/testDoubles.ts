// Shared in-memory fakes for the memory-lifecycle + tier-selection test
// suites (APP-034, SPEC-APP.md §9.6/§9.8). No real llama.rn context, RN
// AppState, iOS memory-warning notification, or react-native-device-info
// call happens anywhere in here — everything is a deterministic,
// inspectable stand-in for the injectable interfaces in ../types.ts,
// mirroring fab-app/src/artifacts/__tests__/testDoubles.ts's role for that
// module.
//
// This file intentionally contains no fab-app runtime/production logic —
// it exists to make the *.test.ts files in this directory runnable.

import type {
  Clock,
  DiagnosticsStore,
  InferenceContextFactory,
  InferenceContextHandle,
  LifecycleTransitionEvent,
  Tier,
  TierFallbackStore,
  TierSelectionReason,
} from "../types";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FakeHandleOptions {
  saveSessionDelayMs?: number;
  releaseDelayMs?: number;
  /** If set, saveSession() rejects with this error instead of succeeding —
   * exercises the save-failure recovery path (a real device might fail to
   * write the session file: disk full, permission error, etc). */
  saveSessionError?: Error;
  /** If set, release() rejects with this error instead of succeeding —
   * exercises the second-order release-failure path (the native
   * unload/free call itself throwing). */
  releaseError?: Error;
}

/** Records every call (and its argument) in call order, on the instance —
 * this is what the data-before-marker test inspects to prove saveSession
 * happens strictly before release. Both calls are still recorded even when
 * configured to throw, so a test can assert "was attempted" independently
 * of "succeeded". */
export class FakeInferenceContextHandle implements InferenceContextHandle {
  isLoaded = true;
  readonly calls: string[] = [];

  constructor(private readonly opts: FakeHandleOptions = {}) {}

  async saveSession(path: string): Promise<void> {
    if (this.opts.saveSessionDelayMs) await delay(this.opts.saveSessionDelayMs);
    this.calls.push(`saveSession:${path}`);
    if (this.opts.saveSessionError) throw this.opts.saveSessionError;
  }

  async release(): Promise<void> {
    if (this.opts.releaseDelayMs) await delay(this.opts.releaseDelayMs);
    this.calls.push("release");
    if (this.opts.releaseError) throw this.opts.releaseError;
    this.isLoaded = false;
  }
}

/** Every load() call mints a fresh handle (as a real context reload would)
 * and records the session path it was asked to restore, so tests can
 * assert both "loaded exactly once" (call count) and "which session path"
 * without inspecting private manager state. */
export class FakeInferenceContextFactory implements InferenceContextFactory {
  readonly loadedSessionPaths: string[] = [];
  readonly handles: FakeInferenceContextHandle[] = [];
  loadDelayMs = 0;

  constructor(private readonly handleOpts: FakeHandleOptions = {}) {}

  async load(sessionPath: string): Promise<InferenceContextHandle> {
    this.loadedSessionPaths.push(sessionPath);
    if (this.loadDelayMs) await delay(this.loadDelayMs);
    const handle = new FakeInferenceContextHandle(this.handleOpts);
    this.handles.push(handle);
    return handle;
  }
}

export class FakeDiagnosticsStore implements DiagnosticsStore {
  readonly lifecycleTransitions: LifecycleTransitionEvent[] = [];
  readonly tierRecords: { tier: Tier; reason: TierSelectionReason }[] = [];

  async recordLifecycleTransition(event: LifecycleTransitionEvent): Promise<void> {
    this.lifecycleTransitions.push(event);
  }

  async recordActiveTier(tier: Tier, reason: TierSelectionReason): Promise<void> {
    this.tierRecords.push({ tier, reason });
  }
}

export class FakeTierFallbackStore implements TierFallbackStore {
  forced = false;
  reason: string | null = null;

  async isFallbackForced(): Promise<boolean> {
    return this.forced;
  }

  async recordLoadFailure(reason: string): Promise<void> {
    this.forced = true;
    this.reason = reason;
  }

  async clearFallback(): Promise<void> {
    this.forced = false;
    this.reason = null;
  }
}

export class ManualClock implements Clock {
  constructor(private current: number = 0) {}

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}
