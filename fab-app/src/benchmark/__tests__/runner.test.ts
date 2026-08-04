// APP-024 (#136): BenchmarkRunner orchestrates the §8.6 protocol against
// injected clients. Every timing number below is a hand-picked, hand-
// computed fake — never a real timer — so the percentile/median
// aggregation math is pinned against exact expected values, not just
// "some plausible-looking number" (dev-brain lesson: assert values, not
// shape). Real llama.rn/op-sqlite/native-RAM wiring is out of scope here
// (§8.6's device-run leg is QA-gated separately, tracked on #136) — this
// only proves the orchestration and aggregation are correct.

import { BenchmarkRunner } from '../runner';
import type { BenchmarkRunnerConfig } from '../types';
import {
  FakeDecodeClient,
  FakeEmbeddingClient,
  FakePrefillClient,
  FakeRamPeakSampler,
  FakeTtftClient,
} from './testDoubles';
import { RetrievalEngine } from '../../retrieval/engine';
import {
  HashingBagOfWordsEmbedder,
  InMemoryChunkCorpus,
  StaticVectorStore,
} from '../../retrieval/__tests__/testDoubles';

const BASE_CONFIG: Pick<
  BenchmarkRunnerConfig,
  'tier' | 'device' | 'appVersion' | 'buildNumber' | 'iterations'
> = {
  tier: '1.7B',
  device: { model: 'iPhone 13 Pro', osVersion: 'iOS 17.5.1' },
  appVersion: '1.0.0',
  buildNumber: '42',
  iterations: { iterations: 3, warmupIterations: 1 },
};

function fixedClock(dates: string[]): () => Date {
  let i = 0;
  return () => {
    const d = new Date(dates[Math.min(i, dates.length - 1)]);
    i += 1;
    return d;
  };
}

describe('BenchmarkRunner', () => {
  it('rejects a non-positive iterations count at construction', () => {
    expect(
      () =>
        new BenchmarkRunner({
          ...BASE_CONFIG,
          iterations: { iterations: 0, warmupIterations: 0 },
        }),
    ).toThrow();
    expect(
      () =>
        new BenchmarkRunner({
          ...BASE_CONFIG,
          iterations: { iterations: -1, warmupIterations: 0 },
        }),
    ).toThrow();
  });

  it('rejects a negative warmupIterations count at construction', () => {
    expect(
      () =>
        new BenchmarkRunner({
          ...BASE_CONFIG,
          iterations: { iterations: 3, warmupIterations: -1 },
        }),
    ).toThrow();
  });

  it('reports every metric as not-run, with a distinct reason each, when no clients are injected', async () => {
    const runner = new BenchmarkRunner({
      ...BASE_CONFIG,
      now: fixedClock(['2026-08-01T00:00:00.000Z']),
    });
    const result = await runner.run();
    for (const key of Object.keys(
      result.metrics,
    ) as (keyof typeof result.metrics)[]) {
      expect(result.metrics[key].status).toBe('not-run');
      if (result.metrics[key].status === 'not-run') {
        expect(
          (result.metrics[key] as { reason: string }).reason.length,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('carries top-level fields through exactly (tier, device, appVersion, buildNumber, iterations, timestamps)', async () => {
    const runner = new BenchmarkRunner({
      ...BASE_CONFIG,
      now: fixedClock(['2026-08-01T00:00:00.000Z', '2026-08-01T00:05:00.000Z']),
    });
    const result = await runner.run();
    expect(result.tier).toBe('1.7B');
    expect(result.device).toEqual({
      model: 'iPhone 13 Pro',
      osVersion: 'iOS 17.5.1',
    });
    expect(result.appVersion).toBe('1.0.0');
    expect(result.buildNumber).toBe('42');
    expect(result.iterations).toBe(3);
    expect(result.startedAt).toBe('2026-08-01T00:00:00.000Z');
    expect(result.completedAt).toBe('2026-08-01T00:05:00.000Z');
  });

  it('computes decode tok/s as the MEDIAN (p50) of per-iteration rate, discarding warmup', async () => {
    // warmup 50ms discarded; measured: 100ms, 80ms, 120ms @ 100 tokens/call
    // -> rates 1000, 1250, 833.33 tok/s -> median (nearest-rank p50 of 3) = 1000
    const client = new FakeDecodeClient([50, 100, 80, 120], 100);
    const runner = new BenchmarkRunner({
      ...BASE_CONFIG,
      decode: { client, tokenCount: 64 },
    });
    const result = await runner.run();
    expect(result.metrics.decodeTokensPerSec).toEqual({
      status: 'measured',
      value: 1000,
    });
    expect(client.callCount).toBe(4); // 1 warmup + 3 measured
  });

  it('reports decode as not-run when every measured iteration produces a non-positive duration', async () => {
    // All-zero durations: the client is genuinely called (so this isn't
    // "no client injected"), but every duration fails the durationMs > 0
    // guard, so `rates` stays empty — a distinct not-run path from the
    // "no client injected" one covered above.
    const client = new FakeDecodeClient([0, 0, 0, 0], 100);
    const runner = new BenchmarkRunner({
      ...BASE_CONFIG,
      decode: { client, tokenCount: 64 },
    });
    const result = await runner.run();
    expect(result.metrics.decodeTokensPerSec).toEqual({
      status: 'not-run',
      reason: 'no measured decode iteration produced a positive duration',
    });
    expect(client.callCount).toBe(4); // 1 warmup + 3 measured — genuinely ran
  });

  it('computes prefill tok/s as the MEDIAN (p50) of per-iteration rate, discarding warmup', async () => {
    // warmup 999ms discarded; measured: 400ms, 500ms, 800ms @ 1024 tokens/call
    // -> rates 2560, 2048, 1280 -> median = 2048
    const client = new FakePrefillClient([999, 400, 500, 800], 1024);
    const runner = new BenchmarkRunner({
      ...BASE_CONFIG,
      prefill: { client, promptTokenCount: 1024 },
    });
    const result = await runner.run();
    expect(result.metrics.prefillTokensPerSec).toEqual({
      status: 'measured',
      value: 2048,
    });
  });

  it('reports prefill as not-run when every measured iteration produces a non-positive duration', async () => {
    const client = new FakePrefillClient([0, 0, 0, 0], 1024);
    const runner = new BenchmarkRunner({
      ...BASE_CONFIG,
      prefill: { client, promptTokenCount: 1024 },
    });
    const result = await runner.run();
    expect(result.metrics.prefillTokensPerSec).toEqual({
      status: 'not-run',
      reason: 'no measured prefill iteration produced a positive duration',
    });
    expect(client.callCount).toBe(4);
  });

  it('computes TTFT warm and cold independently as p95, each with its own injected client', async () => {
    // warm: warmup 9999ms discarded; measured 1000,3000,2000 -> p95 (nearest-rank of 3) = 3000
    // cold: warmup 9999ms discarded; measured 5000,7000,6000 -> p95 = 7000
    const warmClient = new FakeTtftClient([9999, 1000, 3000, 2000]);
    const coldClient = new FakeTtftClient([9999, 5000, 7000, 6000]);
    const runner = new BenchmarkRunner({
      ...BASE_CONFIG,
      ttftWarm: { client: warmClient },
      ttftCold: { client: coldClient },
    });
    const result = await runner.run();
    expect(result.metrics.ttftWarmMs).toEqual({
      status: 'measured',
      value: 3000,
    });
    expect(result.metrics.ttftColdMs).toEqual({
      status: 'measured',
      value: 7000,
    });
  });

  it('computes query-embedding latency as p95, cycling through the supplied queries', async () => {
    // warmup 999ms discarded; measured 100,300,200 -> p95 = 300
    const client = new FakeEmbeddingClient([999, 100, 300, 200]);
    const runner = new BenchmarkRunner({
      ...BASE_CONFIG,
      embedding: { client, queries: ['dominate', 'go again'] },
    });
    const result = await runner.run();
    expect(result.metrics.queryEmbeddingLatencyMs).toEqual({
      status: 'measured',
      value: 300,
    });
  });

  it('reports embedding as not-run when queries is empty even though a client is present', async () => {
    const client = new FakeEmbeddingClient([100]);
    const runner = new BenchmarkRunner({
      ...BASE_CONFIG,
      embedding: { client, queries: [] },
    });
    const result = await runner.run();
    expect(result.metrics.queryEmbeddingLatencyMs.status).toBe('not-run');
  });

  it('computes RAM peak in MB as the max sample across sampleCount calls', async () => {
    const sampler = new FakeRamPeakSampler([
      1 * 1024 * 1024,
      5 * 1024 * 1024,
      2 * 1024 * 1024,
      3 * 1024 * 1024,
    ]);
    const runner = new BenchmarkRunner({
      ...BASE_CONFIG,
      ramPeak: { sampler, sampleCount: 4 },
    });
    const result = await runner.run();
    expect(result.metrics.peakRamMb).toEqual({ status: 'measured', value: 5 });
    expect(sampler.callCount).toBe(4);
  });

  it('reports RAM peak as not-run when sampleCount is configured below 1, WITHOUT calling the sampler', async () => {
    // A misconfigured sampleCount is distinct from "no sampler injected"
    // (covered below) — the sampler IS present here, but the guard fires
    // before the sampling loop, so the sampler is never actually called.
    const sampler = new FakeRamPeakSampler([1]);
    const runner = new BenchmarkRunner({
      ...BASE_CONFIG,
      ramPeak: { sampler, sampleCount: 0 },
    });
    const result = await runner.run();
    expect(result.metrics.peakRamMb).toEqual({
      status: 'not-run',
      reason: 'sampleCount must be >= 1 (configured: 0)',
    });
    expect(sampler.callCount).toBe(0);
  });

  it('reports RAM peak as not-run with a limitation-explaining reason when no sampler is injected', async () => {
    const runner = new BenchmarkRunner(BASE_CONFIG);
    const result = await runner.run();
    expect(result.metrics.peakRamMb.status).toBe('not-run');
    if (result.metrics.peakRamMb.status === 'not-run') {
      expect(result.metrics.peakRamMb.reason).toMatch(/native/i);
    }
  });

  it('measures retrieval p95 against the REAL RetrievalEngine (APP-033), not a fake interface', async () => {
    const embedder = new HashingBagOfWordsEmbedder();
    const corpus = new InMemoryChunkCorpus([
      {
        id: 'c1',
        text: 'dominate ability text',
        tags: ['dominate'],
        cardNames: [],
        links: [],
        source: { document: 'test', url: 'https://example.test/c1' },
      },
      {
        id: 'c2',
        text: 'go again reaction text',
        tags: ['go-again'],
        cardNames: [],
        links: [],
        source: { document: 'test', url: 'https://example.test/c2' },
      },
    ]);
    const vectorStore = new StaticVectorStore([{ chunkId: 'c1', score: 0.9 }]);
    const engine = new RetrievalEngine(corpus, vectorStore, embedder, {
      retrievalFloor: 0.3,
      oodThreshold: 0.1,
    });
    const runner = new BenchmarkRunner({
      ...BASE_CONFIG,
      iterations: { iterations: 2, warmupIterations: 1 },
      retrieval: { engine, queries: ['dominate', 'go again'] },
    });
    const result = await runner.run();
    expect(result.metrics.retrievalP95Ms.status).toBe('measured');
    if (result.metrics.retrievalP95Ms.status === 'measured') {
      expect(result.metrics.retrievalP95Ms.value).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(result.metrics.retrievalP95Ms.value)).toBe(true);
    }
  });

  it("runs measurements in isolation — one metric's client is never called while measuring another", async () => {
    const decodeClient = new FakeDecodeClient([10, 10], 10);
    const prefillClient = new FakePrefillClient([10, 10], 10);
    const runner = new BenchmarkRunner({
      ...BASE_CONFIG,
      iterations: { iterations: 1, warmupIterations: 0 },
      decode: { client: decodeClient, tokenCount: 10 },
      prefill: { client: prefillClient, promptTokenCount: 10 },
    });
    await runner.run();
    expect(decodeClient.callCount).toBe(1);
    expect(prefillClient.callCount).toBe(1);
  });
});
