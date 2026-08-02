// APP-034: injectable interfaces the memory-lifecycle manager and tier
// selector are built against.
//
// Nothing in this file talks to a real llama.rn context, RN AppState, iOS
// memory-warning notifications, or react-native-device-info — production
// wiring lives outside src/lifecycle (see SPEC-APP.md §9.6/§9.8) and is not
// part of this task. Every class in this directory is constructed with
// these interfaces so unit tests can supply deterministic in-memory fakes
// instead (fab-app/src/lifecycle/__tests__/testDoubles.ts), mirroring
// fab-app/src/artifacts/types.ts's role for that module.

/** A live llama.rn-style inference context handle. */
export interface InferenceContextHandle {
  readonly isLoaded: boolean;
  saveSession(path: string): Promise<void>;
  release(): Promise<void>;
}

/** Creates (loads) a fresh inference context. A real implementation
 * restores a previously-saved session from `sessionPath` when one exists on
 * disk, giving §9.6's "contexts lazily reload with session restore" — kept
 * as a single call so LifecycleManager doesn't need to know how session
 * restoration works, only that it happened. */
export interface InferenceContextFactory {
  load(sessionPath: string): Promise<InferenceContextHandle>;
}

export type LifecycleState = "loaded" | "releasing" | "released" | "reloading";

export type LifecycleSignalKind = "background" | "memory-pressure" | "foreground" | "use";

export interface LifecycleTransitionEvent {
  from: LifecycleState;
  to: LifecycleState;
  signal: LifecycleSignalKind;
  at: string;
  /** Extra context for a transition — currently only used to flag a
   * memory-pressure release that had to give up waiting on an in-flight
   * generation (see LifecycleManager's forced-release path). */
  details?: Record<string, unknown>;
}

export type Tier = "1.7B" | "0.6B";

export type TierSelectionReason = "ram-below-floor" | "ok" | "load-failure" | "load-failure-persisted";

/** Shared diagnostics sink for both halves of this module — a real
 * implementation persists these (settings/diagnostics store per §9.8) so a
 * support flow can read back what happened without reproducing it. */
export interface DiagnosticsStore {
  recordLifecycleTransition(event: LifecycleTransitionEvent): Promise<void>;
  recordActiveTier(tier: Tier, reason: TierSelectionReason): Promise<void>;
}

export interface Clock {
  now(): number;
}

export interface TierSelectionInput {
  totalRamBytes: number;
  /** Attempts to load the 1.7B pack (e.g. a real llama.rn initLlama probe
   * against the installed model). Only invoked when RAM is at/above the
   * §14 6 GB floor and no fallback is already persisted. Resolving `false`
   * or rejecting are both treated as a load failure. */
  canLoad17B: () => Promise<boolean>;
}

/** Persists "the 1.7B pack failed to load" across selectTier calls, per
 * §9.8's "fails to load" clause — the fallback must stick until the
 * artifacts themselves change (a fresh pack install), not just for one
 * session. */
export interface TierFallbackStore {
  isFallbackForced(): Promise<boolean>;
  recordLoadFailure(reason: string): Promise<void>;
  /** Call when new 1.7B artifacts are installed — a stale load failure
   * against the old pack no longer applies to the new one. */
  clearFallback(): Promise<void>;
}

/** Device RAM source abstracted per §9.8 — production wiring is
 * react-native-device-info, added in a later device-integration task. */
export interface DeviceRamSource {
  getTotalRamBytes(): Promise<number>;
}

/** The subset of LifecycleManager's public surface AppLifecycleAdapter
 * drives — kept as a small structural interface (rather than importing the
 * concrete class) so the adapter and its tests don't need a fully-wired
 * LifecycleManager. */
export interface LifecycleController {
  onBackground(): Promise<void>;
  onForeground(): Promise<void>;
  onMemoryPressure(): Promise<void>;
}

/** App background/foreground/memory-warning event source, abstracted per
 * §9.6 — production wiring is RN AppState (background/foreground) + an
 * iOS native memory-warning module, added in a later device-integration
 * task. Each `on*` returns an unsubscribe function. */
export interface AppLifecycleSource {
  onBackground(handler: () => void): () => void;
  onForeground(handler: () => void): () => void;
  onMemoryWarning(handler: () => void): () => void;
}
