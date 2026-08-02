// The primitive LifecycleManager uses to implement §9.6's "finish-then-
// release with a bounded wait" decision for memory pressure arriving mid-
// generation (see lifecycleManager.test.ts for that integration).

import { GenerationGate } from "../generationGate";

describe("GenerationGate", () => {
  it("reports idle immediately when nothing is active", async () => {
    const gate = new GenerationGate();

    expect(gate.isActive).toBe(false);
    await expect(gate.waitUntilIdle(1000)).resolves.toEqual({ finishedInTime: true });
  });

  it("resolves as soon as the active generation ends", async () => {
    const gate = new GenerationGate();
    gate.begin();
    expect(gate.isActive).toBe(true);

    const waitP = gate.waitUntilIdle(1000);
    gate.end();

    await expect(waitP).resolves.toEqual({ finishedInTime: true });
    expect(gate.isActive).toBe(false);
  });

  it("times out with finishedInTime: false if generation never ends", async () => {
    jest.useFakeTimers();
    try {
      const gate = new GenerationGate();
      gate.begin();

      const waitP = gate.waitUntilIdle(50);
      await jest.advanceTimersByTimeAsync(50);

      await expect(waitP).resolves.toEqual({ finishedInTime: false });
      expect(gate.isActive).toBe(true); // never actually ended
    } finally {
      jest.useRealTimers();
    }
  });

  it("supports nested begin/end pairs, only going idle once the count reaches zero", async () => {
    const gate = new GenerationGate();
    gate.begin();
    gate.begin();
    gate.end();
    expect(gate.isActive).toBe(true);

    const waitP = gate.waitUntilIdle(1000);
    gate.end();

    await expect(waitP).resolves.toEqual({ finishedInTime: true });
  });
});
