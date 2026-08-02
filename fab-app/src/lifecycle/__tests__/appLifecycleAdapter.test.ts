// §9.6's "AppState/memory-warning sources abstracted injectable" — the thin
// glue between a real event source (RN AppState + iOS memory-warning native
// module, wired later per SPEC-APP.md) and LifecycleManager's signal
// handlers. This test uses a fake AppLifecycleSource; no RN module loads.

import { AppLifecycleAdapter } from "../appLifecycleAdapter";
import type { AppLifecycleSource, LifecycleController } from "../types";

class FakeAppLifecycleSource implements AppLifecycleSource {
  private backgroundHandlers: Array<() => void> = [];
  private foregroundHandlers: Array<() => void> = [];
  private memoryWarningHandlers: Array<() => void> = [];

  onBackground(handler: () => void): () => void {
    this.backgroundHandlers.push(handler);
    return () => {
      this.backgroundHandlers = this.backgroundHandlers.filter((h) => h !== handler);
    };
  }

  onForeground(handler: () => void): () => void {
    this.foregroundHandlers.push(handler);
    return () => {
      this.foregroundHandlers = this.foregroundHandlers.filter((h) => h !== handler);
    };
  }

  onMemoryWarning(handler: () => void): () => void {
    this.memoryWarningHandlers.push(handler);
    return () => {
      this.memoryWarningHandlers = this.memoryWarningHandlers.filter((h) => h !== handler);
    };
  }

  fireBackground(): void {
    this.backgroundHandlers.forEach((h) => h());
  }

  fireForeground(): void {
    this.foregroundHandlers.forEach((h) => h());
  }

  fireMemoryWarning(): void {
    this.memoryWarningHandlers.forEach((h) => h());
  }
}

function makeController(): LifecycleController & {
  onBackground: jest.Mock;
  onForeground: jest.Mock;
  onMemoryPressure: jest.Mock;
} {
  return {
    onBackground: jest.fn().mockResolvedValue(undefined),
    onForeground: jest.fn().mockResolvedValue(undefined),
    onMemoryPressure: jest.fn().mockResolvedValue(undefined),
  };
}

describe("AppLifecycleAdapter", () => {
  it("wires source events to the corresponding controller signal handlers", () => {
    const source = new FakeAppLifecycleSource();
    const controller = makeController();
    const adapter = new AppLifecycleAdapter(source, controller);

    adapter.start();
    source.fireBackground();
    source.fireForeground();
    source.fireMemoryWarning();

    expect(controller.onBackground).toHaveBeenCalledTimes(1);
    expect(controller.onForeground).toHaveBeenCalledTimes(1);
    expect(controller.onMemoryPressure).toHaveBeenCalledTimes(1);
  });

  it("stops forwarding events after stop() unsubscribes", () => {
    const source = new FakeAppLifecycleSource();
    const controller = makeController();
    const adapter = new AppLifecycleAdapter(source, controller);

    adapter.start();
    adapter.stop();
    source.fireBackground();
    source.fireForeground();
    source.fireMemoryWarning();

    expect(controller.onBackground).not.toHaveBeenCalled();
    expect(controller.onForeground).not.toHaveBeenCalled();
    expect(controller.onMemoryPressure).not.toHaveBeenCalled();
  });

  it("start() is idempotent-safe to call once and subscribes exactly one handler per source event", () => {
    const source = new FakeAppLifecycleSource();
    const controller = makeController();
    const adapter = new AppLifecycleAdapter(source, controller);

    adapter.start();
    source.fireBackground();

    expect(controller.onBackground).toHaveBeenCalledTimes(1);
  });
});
