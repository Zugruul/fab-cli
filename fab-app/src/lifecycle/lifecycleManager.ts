// SPEC-APP.md §9.6: "WHILE the app is backgrounded or under memory pressure
// THE SYSTEM SHALL release inference contexts (models unloaded, sessions
// persisted via saveSession) so iOS Jetsam does not terminate the app;
// contexts lazily reload with session restore on foreground."

import { GenerationGate } from "./generationGate";
import type {
  Clock,
  DiagnosticsStore,
  InferenceContextFactory,
  InferenceContextHandle,
  LifecycleSignalKind,
  LifecycleState,
} from "./types";

const DEFAULT_GENERATION_WAIT_TIMEOUT_MS = 5000;

export interface LifecycleManagerOptions {
  contextFactory: InferenceContextFactory;
  /** Where sessions are saved to / restored from — passed straight through
   * to both InferenceContextFactory.load and InferenceContextHandle.saveSession,
   * so a release/reload pair always round-trips through the same file. */
  sessionPath: string;
  diagnostics: DiagnosticsStore;
  clock?: Clock;
  generationGate?: GenerationGate;
  /** Bounded wait for an in-flight generation to finish before a
   * memory-pressure release proceeds anyway (§9.6 finish-then-release).
   * Default 5s — long enough for a normal turn to wrap up, short enough to
   * still beat Jetsam. */
  generationWaitTimeoutMs?: number;
}

type ExclusiveKind = "reload" | "release";

/**
 * Owns the loaded/releasing/released/reloading state machine for one
 * inference context. Two concurrency guarantees, both required by §9.6 and
 * both unit-tested (lifecycleManager.test.ts):
 *
 *  - A release racing a reload serializes (never interleaves) — the second
 *    signal to arrive always waits for the first to fully finish.
 *  - Multiple triggers of the SAME kind (e.g. two foreground/next-use
 *    signals firing concurrently) join a single in-flight operation rather
 *    than reloading/releasing more than once.
 */
export class LifecycleManager {
  private state: LifecycleState = "released";
  private handle: InferenceContextHandle | null = null;
  private readonly clock: Clock;
  private readonly generationGate: GenerationGate;

  private inFlightKind: ExclusiveKind | null = null;
  private inFlightPromise: Promise<void> | null = null;

  constructor(private readonly opts: LifecycleManagerOptions) {
    this.clock = opts.clock ?? { now: () => Date.now() };
    this.generationGate = opts.generationGate ?? new GenerationGate();
  }

  get currentState(): LifecycleState {
    return this.state;
  }

  /** Marks a generation as in-flight; pair with endGeneration() once the
   * response finishes streaming so a concurrent memory-pressure release
   * knows to wait for a safe point instead of releasing mid-turn. */
  beginGeneration(): void {
    this.generationGate.begin();
  }

  endGeneration(): void {
    this.generationGate.end();
  }

  /** Ensures a loaded context is available — reloading (with session
   * restore) if necessary — and returns it. The "next use" trigger from
   * §9.6. */
  async ensureLoaded(): Promise<InferenceContextHandle> {
    await this.runExclusive("reload", () => this.reloadInternal("use"));
    return this.handle!;
  }

  async onForeground(): Promise<void> {
    await this.runExclusive("reload", () => this.reloadInternal("foreground"));
  }

  async onBackground(): Promise<void> {
    await this.runExclusive("release", () => this.releaseInternal("background"));
  }

  async onMemoryPressure(): Promise<void> {
    await this.runExclusive("release", () => this.releaseInternal("memory-pressure"));
  }

  /** Serializes distinct-kind operations against each other (release vs.
   * reload) while deduping same-kind operations onto a single in-flight
   * promise. `inFlightKind`/`inFlightPromise` are set synchronously — before
   * any `await` — so two same-kind calls issued back-to-back in the same
   * tick still dedupe correctly regardless of microtask timing. */
  private runExclusive(kind: ExclusiveKind, fn: () => Promise<void>): Promise<void> {
    if (this.inFlightKind === kind && this.inFlightPromise) {
      return this.inFlightPromise;
    }

    const previous = this.inFlightPromise ?? Promise.resolve();
    this.inFlightKind = kind;
    const run = previous
      // A prior operation's failure must never permanently wedge the
      // manager — later operations still get their turn.
      .catch(() => {})
      .then(fn)
      .finally(() => {
        if (this.inFlightPromise === run) {
          this.inFlightKind = null;
          this.inFlightPromise = null;
        }
      });
    this.inFlightPromise = run;
    return run;
  }

  private async reloadInternal(signal: "foreground" | "use"): Promise<void> {
    if (this.state === "loaded") return;
    await this.transition("reloading", signal);
    this.handle = await this.opts.contextFactory.load(this.opts.sessionPath);
    await this.transition("loaded", signal);
  }

  private async releaseInternal(signal: "background" | "memory-pressure"): Promise<void> {
    if (this.state !== "loaded" || !this.handle) return;
    await this.transition("releasing", signal);

    let forcedAfterTimeout = false;
    if (signal === "memory-pressure" && this.generationGate.isActive) {
      const timeoutMs = this.opts.generationWaitTimeoutMs ?? DEFAULT_GENERATION_WAIT_TIMEOUT_MS;
      const { finishedInTime } = await this.generationGate.waitUntilIdle(timeoutMs);
      forcedAfterTimeout = !finishedInTime;
    }

    // Data-before-marker discipline: the session is durably persisted
    // BEFORE the context is released, unconditionally — on both the clean
    // and forced-timeout paths. A crash/Jetsam kill between save and
    // release must never lose more than a resumed generation regenerates;
    // marker-first (release-before-save) would turn that into permanent
    // silent loss.
    //
    // Both calls are independently try/caught rather than left to propagate:
    // a throw here used to escape releaseInternal entirely, wedging state at
    // "releasing" forever (this method's own guard above requires
    // state === "loaded" to run again) and leaking the native context
    // (release() was never reached). Losing the session is recoverable —
    // the next load just starts fresh; leaking the context is not, and
    // defeats the whole point of this method (Jetsam avoidance). So: always
    // attempt both, always null the handle and land on "released"
    // (retryable) no matter what either call did, and record what actually
    // happened instead of swallowing it.
    const handle = this.handle;
    let saveError: string | undefined;
    try {
      await handle.saveSession(this.opts.sessionPath);
    } catch (err) {
      saveError = describeError(err);
    }

    let releaseError: string | undefined;
    try {
      await handle.release();
    } catch (err) {
      // Second-order failure: the native release call itself threw. Still
      // must not wedge — drop our reference (best effort; the native side
      // may or may not have actually freed anything) and record it.
      releaseError = describeError(err);
    }

    this.handle = null;

    const details: Record<string, unknown> = {};
    if (forcedAfterTimeout) details.forcedAfterTimeout = true;
    if (saveError !== undefined) details.saveFailed = true;
    if (releaseError !== undefined) details.releaseFailed = true;
    const combinedError = [saveError, releaseError].filter((e): e is string => e !== undefined).join("; ");
    if (combinedError) details.error = combinedError;

    await this.transition("released", signal, Object.keys(details).length > 0 ? details : undefined);
  }

  private async transition(
    to: LifecycleState,
    signal: LifecycleSignalKind,
    details?: Record<string, unknown>,
  ): Promise<void> {
    const from = this.state;
    this.state = to;
    await this.opts.diagnostics.recordLifecycleTransition({
      from,
      to,
      signal,
      at: new Date(this.clock.now()).toISOString(),
      ...(details ? { details } : {}),
    });
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
