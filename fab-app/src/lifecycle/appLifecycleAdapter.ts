// §9.6's "AppState/memory-warning sources abstracted injectable (RN
// AppState + iOS memory warnings wired later — this task is the logic + a
// thin adapter skeleton)". Pure glue: forwards a real event source's
// background/foreground/memory-warning events to a LifecycleManager's
// signal handlers. Production wiring (RN AppState + a native iOS
// memory-warning module) is a later device-integration task — this class
// is independently testable with a fake AppLifecycleSource.

import type { AppLifecycleSource, LifecycleController } from "./types";

export class AppLifecycleAdapter {
  private unsubscribers: Array<() => void> = [];

  constructor(
    private readonly source: AppLifecycleSource,
    private readonly controller: LifecycleController,
  ) {}

  start(): void {
    this.unsubscribers.push(
      this.source.onBackground(() => {
        // Fire-and-forget: the native event handler can't be async, and
        // failures are already surfaced via the diagnostics transitions
        // LifecycleManager records — swallowing here just prevents an
        // unhandled-rejection warning, it isn't the error-reporting path.
        this.controller.onBackground().catch(() => {});
      }),
      this.source.onForeground(() => {
        this.controller.onForeground().catch(() => {});
      }),
      this.source.onMemoryWarning(() => {
        this.controller.onMemoryPressure().catch(() => {});
      }),
    );
  }

  stop(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
  }
}
