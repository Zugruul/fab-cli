// APP-024 (#136): pure reducer for BenchmarkScreen's async run lifecycle —
// mirrors ../../smokeScreen/reducer.ts's split of pure state logic from the
// React component, so this is unit-testable with no renderer/native mocks.

import { benchmarkScreenReducer, initialBenchmarkScreenState } from "../screenReducer";
import type { BenchmarkRunResult } from "../types";

const FAKE_RESULT: BenchmarkRunResult = {
  tier: "1.7B",
  device: { model: "iPhone 13 Pro", osVersion: "iOS 17.5.1" },
  appVersion: "1.0.0",
  buildNumber: "42",
  iterations: 10,
  startedAt: "2026-08-01T00:00:00.000Z",
  completedAt: "2026-08-01T00:01:00.000Z",
  metrics: {
    decodeTokensPerSec: { status: "measured", value: 12 },
    prefillTokensPerSec: { status: "measured", value: 400 },
    ttftWarmMs: { status: "measured", value: 2000 },
    ttftColdMs: { status: "measured", value: 6000 },
    queryEmbeddingLatencyMs: { status: "measured", value: 200 },
    retrievalP95Ms: { status: "measured", value: 30 },
    peakRamMb: { status: "not-run", reason: "no sampler" },
  },
};

describe("benchmarkScreenReducer", () => {
  it("starts idle", () => {
    expect(initialBenchmarkScreenState()).toEqual({ status: "idle" });
  });

  it("RUN_START moves to running and clears any previous result/error", () => {
    const errored = benchmarkScreenReducer(initialBenchmarkScreenState(), { type: "RUN_ERROR", message: "boom" });
    const next = benchmarkScreenReducer(errored, { type: "RUN_START" });
    expect(next).toEqual({ status: "running" });
  });

  it("RUN_OK moves to done and attaches the result", () => {
    const running = benchmarkScreenReducer(initialBenchmarkScreenState(), { type: "RUN_START" });
    const next = benchmarkScreenReducer(running, { type: "RUN_OK", result: FAKE_RESULT });
    expect(next).toEqual({ status: "done", result: FAKE_RESULT });
  });

  it("RUN_ERROR moves to error and attaches the message, dropping any prior result", () => {
    const running = benchmarkScreenReducer(initialBenchmarkScreenState(), { type: "RUN_START" });
    const done = benchmarkScreenReducer(running, { type: "RUN_OK", result: FAKE_RESULT });
    const next = benchmarkScreenReducer(done, { type: "RUN_START" });
    const errored = benchmarkScreenReducer(next, { type: "RUN_ERROR", message: "native module missing" });
    expect(errored).toEqual({ status: "error", errorMessage: "native module missing" });
  });

  it("a re-run (RUN_START) from a done state clears the previous result while running", () => {
    const done = benchmarkScreenReducer(initialBenchmarkScreenState(), { type: "RUN_OK", result: FAKE_RESULT });
    const next = benchmarkScreenReducer(done, { type: "RUN_START" });
    expect(next).toEqual({ status: "running" });
  });
});
