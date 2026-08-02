// SPEC-APP.md §9.6: "WHILE the app is backgrounded or under memory pressure
// THE SYSTEM SHALL release inference contexts (models unloaded, sessions
// persisted via saveSession) so iOS Jetsam does not terminate the app;
// contexts lazily reload with session restore on foreground."

import { LifecycleManager } from "../lifecycleManager";
import { FakeDiagnosticsStore, FakeInferenceContextFactory } from "./testDoubles";

const SESSION_PATH = "/sessions/current.bin";

function makeManager(opts: {
  factory?: FakeInferenceContextFactory;
  diagnostics?: FakeDiagnosticsStore;
  generationWaitTimeoutMs?: number;
} = {}) {
  const factory = opts.factory ?? new FakeInferenceContextFactory();
  const diagnostics = opts.diagnostics ?? new FakeDiagnosticsStore();
  const manager = new LifecycleManager({
    contextFactory: factory,
    sessionPath: SESSION_PATH,
    diagnostics,
    generationWaitTimeoutMs: opts.generationWaitTimeoutMs,
  });
  return { factory, diagnostics, manager };
}

describe("LifecycleManager state machine", () => {
  it("starts released and moves to loaded via ensureLoaded", async () => {
    const { manager } = makeManager();
    expect(manager.currentState).toBe("released");

    const handle = await manager.ensureLoaded();

    expect(manager.currentState).toBe("loaded");
    expect(handle.isLoaded).toBe(true);
  });

  it("persists the session BEFORE releasing the context (data-before-marker discipline)", async () => {
    const { factory, manager } = makeManager();
    await manager.ensureLoaded();
    const handle = factory.handles[0];

    await manager.onBackground();

    expect(manager.currentState).toBe("released");
    expect(handle.calls).toEqual([`saveSession:${SESSION_PATH}`, "release"]);
  });

  it("restores the session by passing the same session path back into the factory on reload", async () => {
    const { factory, manager } = makeManager();
    await manager.ensureLoaded();
    await manager.onBackground();

    await manager.onForeground();

    expect(factory.loadedSessionPaths).toEqual([SESSION_PATH, SESSION_PATH]);
  });

  it("is a no-op to release when nothing is loaded", async () => {
    const { factory, diagnostics, manager } = makeManager();

    await manager.onBackground();

    expect(factory.handles).toHaveLength(0);
    expect(diagnostics.lifecycleTransitions).toEqual([]);
  });

  it("is a no-op to reload when already loaded", async () => {
    const { factory, manager } = makeManager();
    await manager.ensureLoaded();

    await manager.onForeground();

    expect(factory.loadedSessionPaths).toHaveLength(1);
  });

  it("reloads exactly once when foreground/next-use fire concurrently", async () => {
    const { factory, manager } = makeManager();

    const [handleA, , handleB] = await Promise.all([
      manager.ensureLoaded(),
      manager.onForeground(),
      manager.ensureLoaded(),
    ]);

    expect(factory.loadedSessionPaths).toHaveLength(1);
    expect(factory.handles).toHaveLength(1);
    expect(handleA).toBe(handleB);
    expect(manager.currentState).toBe("loaded");
  });

  it("serializes a release racing a reload instead of interleaving them", async () => {
    const factory = new FakeInferenceContextFactory({ releaseDelayMs: 20 });
    const diagnostics = new FakeDiagnosticsStore();
    const { manager } = makeManager({ factory, diagnostics });
    await manager.ensureLoaded();
    diagnostics.lifecycleTransitions.length = 0; // isolate the race below

    // Fired back-to-back, synchronously, before either awaits — this is the
    // "concurrent-signal" scenario: a memory-pressure release racing a
    // foreground restore.
    const releaseP = manager.onMemoryPressure();
    const reloadP = manager.onForeground();
    await Promise.all([releaseP, reloadP]);

    expect(diagnostics.lifecycleTransitions.map((e) => `${e.to}:${e.signal}`)).toEqual([
      "releasing:memory-pressure",
      "released:memory-pressure",
      "reloading:foreground",
      "loaded:foreground",
    ]);
    // The reload must have minted a brand-new context (the released one
    // is gone), never reused the released handle.
    expect(factory.handles).toHaveLength(2);
    expect(factory.handles[1]).not.toBe(factory.handles[0]);
  });

  it("waits for an in-flight generation to finish before releasing on memory pressure", async () => {
    const { factory, manager } = makeManager({ generationWaitTimeoutMs: 1000 });
    await manager.ensureLoaded();
    const handle = factory.handles[0];

    manager.beginGeneration();
    const releaseP = manager.onMemoryPressure();

    // Give the pressure handler a macrotask to start waiting (flushing all
    // of runExclusive's promise-chain microtask hops), then prove it hasn't
    // released yet while generation is still active.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(handle.calls).toEqual([]);

    manager.endGeneration();
    await releaseP;

    expect(handle.calls).toEqual([`saveSession:${SESSION_PATH}`, "release"]);
    expect(manager.currentState).toBe("released");
  });

  it("force-releases after a bounded wait if generation never finishes (finish-then-release with a timeout)", async () => {
    jest.useFakeTimers();
    try {
      const { factory, diagnostics, manager } = makeManager({ generationWaitTimeoutMs: 50 });
      await manager.ensureLoaded();
      const handle = factory.handles[0];

      manager.beginGeneration(); // never ended — simulates a stuck/long generation
      const releaseP = manager.onMemoryPressure();

      await jest.advanceTimersByTimeAsync(50);
      await releaseP;

      // Even on the forced path, the session is still saved before release —
      // data-before-marker discipline applies unconditionally, not just on
      // the clean path.
      expect(handle.calls).toEqual([`saveSession:${SESSION_PATH}`, "release"]);
      expect(manager.currentState).toBe("released");
      const releasedEvent = diagnostics.lifecycleTransitions.find(
        (e) => e.to === "released" && e.signal === "memory-pressure",
      );
      expect(releasedEvent?.details).toEqual({ forcedAfterTimeout: true });
    } finally {
      jest.useRealTimers();
    }
  });
});

// Bug found in review (PR #197): a throwing saveSession propagated
// uncaught out of releaseInternal, permanently wedging state at
// "releasing" (releaseInternal's own guard requires state === "loaded" to
// do anything, so it could never run again), leaking the native context
// (release() was never reached), and silently minting a second handle on
// the next reload since reloadInternal has no such guard against a
// non-"loaded" state. These tests pin the fix: saveSession/release
// failures are caught, attempted-but-failed, recorded, and NEVER prevent
// the state machine from reaching "released" and being retryable.
describe("LifecycleManager release resilience — saveSession/release failures never wedge", () => {
  it("a throwing saveSession still releases the context and recovers to released", async () => {
    const factory = new FakeInferenceContextFactory({ saveSessionError: new Error("disk full") });
    const diagnostics = new FakeDiagnosticsStore();
    const { manager } = makeManager({ factory, diagnostics });
    await manager.ensureLoaded();
    const handle = factory.handles[0];

    await expect(manager.onBackground()).resolves.toBeUndefined();

    expect(handle.calls).toEqual([`saveSession:${SESSION_PATH}`, "release"]);
    expect(manager.currentState).toBe("released");
    const releasedEvent = diagnostics.lifecycleTransitions.find(
      (e) => e.to === "released" && e.signal === "background",
    );
    expect(releasedEvent?.details).toEqual({ saveFailed: true, error: "disk full" });
  });

  it("a throwing release() (second-order) still nulls the handle and recovers to released", async () => {
    const factory = new FakeInferenceContextFactory({ releaseError: new Error("native free failed") });
    const diagnostics = new FakeDiagnosticsStore();
    const { manager } = makeManager({ factory, diagnostics });
    await manager.ensureLoaded();
    const handle = factory.handles[0];

    await expect(manager.onBackground()).resolves.toBeUndefined();

    expect(handle.calls).toEqual([`saveSession:${SESSION_PATH}`, "release"]);
    expect(manager.currentState).toBe("released");
    const releasedEvent = diagnostics.lifecycleTransitions.find(
      (e) => e.to === "released" && e.signal === "background",
    );
    expect(releasedEvent?.details).toEqual({ releaseFailed: true, error: "native free failed" });
  });

  it("records both failures when saveSession AND release both throw", async () => {
    const factory = new FakeInferenceContextFactory({
      saveSessionError: new Error("disk full"),
      releaseError: new Error("native free failed"),
    });
    const diagnostics = new FakeDiagnosticsStore();
    const { manager } = makeManager({ factory, diagnostics });
    await manager.ensureLoaded();

    await expect(manager.onBackground()).resolves.toBeUndefined();

    expect(manager.currentState).toBe("released");
    const releasedEvent = diagnostics.lifecycleTransitions.find(
      (e) => e.to === "released" && e.signal === "background",
    );
    expect(releasedEvent?.details?.saveFailed).toBe(true);
    expect(releasedEvent?.details?.releaseFailed).toBe(true);
    expect(releasedEvent?.details?.error).toContain("disk full");
    expect(releasedEvent?.details?.error).toContain("native free failed");
  });

  it("a failed release does not wedge — a subsequent reload/release cycle mints exactly one new handle and completes normally", async () => {
    const factory = new FakeInferenceContextFactory({ saveSessionError: new Error("disk full") });
    const { manager } = makeManager({ factory });
    await manager.ensureLoaded();
    await manager.onBackground(); // the failing release above

    // Recovery: a fresh reload must not be blocked by the earlier failure,
    // and must mint exactly one new context — not double-mint from a stuck
    // race, and not silently reuse/leak the old (never-nulled, pre-fix)
    // handle.
    const handle = await manager.ensureLoaded();
    expect(factory.handles).toHaveLength(2);
    expect(handle).toBe(factory.handles[1]);
    expect(manager.currentState).toBe("loaded");

    // And a normal (non-failing) release cycle still works after that.
    await manager.onBackground();
    expect(manager.currentState).toBe("released");
    expect(factory.handles[1].calls).toEqual([`saveSession:${SESSION_PATH}`, "release"]);
  });

  it("survives a rapid background -> foreground -> background triple signal without wedging or double-minting", async () => {
    const factory = new FakeInferenceContextFactory();
    const diagnostics = new FakeDiagnosticsStore();
    const { manager } = makeManager({ factory, diagnostics });
    await manager.ensureLoaded();
    diagnostics.lifecycleTransitions.length = 0; // isolate the triple-signal race below

    const p1 = manager.onBackground();
    const p2 = manager.onForeground();
    const p3 = manager.onBackground();
    await Promise.all([p1, p2, p3]);

    expect(manager.currentState).toBe("released");
    expect(factory.handles).toHaveLength(2); // initial load + the mid-sequence reload
    expect(diagnostics.lifecycleTransitions.map((e) => `${e.to}:${e.signal}`)).toEqual([
      "releasing:background",
      "released:background",
      "reloading:foreground",
      "loaded:foreground",
      "releasing:background",
      "released:background",
    ]);
  });
});
