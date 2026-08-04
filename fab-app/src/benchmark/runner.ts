// APP-024 (#136): SPEC-APP.md §8.6 on-device benchmark protocol runner.
//
// Every model-dependent step (decode/prefill/TTFT/embedding/RAM sampling)
// takes an injected client (./types.ts) — mirroring the retrieval engine's
// own injection style (../retrieval/types.ts) and the lifecycle module's
// (../lifecycle/types.ts). A step whose client is omitted from the config
// yields an honest MeasuredMetric{status:"not-run"} for that metric — this
// class NEVER fabricates a number for a step it didn't actually run.
//
// Every measurement is ISOLATED: run sequentially, one metric fully
// completes (including its own warmup) before the next starts, so
// concurrent CPU/GPU contention between e.g. decode and embedding can't
// skew either number. Warmup iterations run and are discarded before the
// measured iterations begin — the discipline is uniform across every
// iterated metric (decode/prefill/TTFT/embedding/retrieval), configured
// once via `iterations` (./types.ts's IterationConfig) rather than
// hardcoded per metric.
//
// PERCENTILE CONVENTION (see ./percentile.ts for the exact formula and its
// cross-check): two different percentiles are used deliberately, per what
// each §14 target actually bounds — NOT a uniform choice:
//   - Latency metrics with an UPPER-BOUND target ("< N ms/s" — TTFT
//     warm/cold, query-embedding latency, retrieval p95) report p95: the
//     tail is exactly the risk a latency SLA cares about (the worst
//     realistic wait a user hits), matching APP-033's own "p95 retrieval"
//     naming.
//   - Throughput metrics with a LOWER-BOUND target ("≥ N tok/s" — decode,
//     prefill) report the MEDIAN (p50): throughput is conventionally
//     summarized by central tendency, robust to a single slow iteration
//     (e.g. a GC pause or thermal blip) masking a device that's typically
//     at/above the floor, or a single lucky fast iteration masking one
//     that typically misses it.
//
// RAM PEAK: "peak RAM" here means the maximum of `sampleCount` sequential
// calls to an injected RamPeakSampler.sampleResidentMemoryBytes() — NOT a
// continuous OS-level sample taken throughout a real decode run (that
// would need the sampling calls interleaved with real generation, which is
// a device-integration concern outside this class's scope). No default/
// production RamPeakSampler ships in this task: iOS has no cross-platform
// JS/JSI API for resident-memory sampling — a real implementation needs a
// small native module reading `task_info`'s `phys_footprint` (Mach), which
// isn't built here (§8.6's device-run leg is QA-gated separately, tracked
// on #136). Omitting the sampler is therefore a first-class, expected
// "not-run" outcome, not a bug.

import { percentile } from './percentile';
import type {
  BenchmarkMetrics,
  BenchmarkRunResult,
  BenchmarkRunnerConfig,
  MeasuredMetric,
  TtftClient,
} from './types';

const BYTES_PER_MB = 1024 * 1024;

export class BenchmarkRunner {
  constructor(private readonly config: BenchmarkRunnerConfig) {
    if (
      !Number.isInteger(config.iterations.iterations) ||
      config.iterations.iterations < 1
    ) {
      throw new Error(
        `BenchmarkRunner: iterations.iterations must be a positive integer (got ${config.iterations.iterations})`,
      );
    }
    if (
      !Number.isInteger(config.iterations.warmupIterations) ||
      config.iterations.warmupIterations < 0
    ) {
      throw new Error(
        `BenchmarkRunner: iterations.warmupIterations must be a non-negative integer (got ${config.iterations.warmupIterations})`,
      );
    }
  }

  async run(): Promise<BenchmarkRunResult> {
    const now = this.config.now ?? (() => new Date());
    const startedAt = now().toISOString();

    const decodeTokensPerSec = await this.measureDecode();
    const prefillTokensPerSec = await this.measurePrefill();
    const ttftWarmMs = await this.measureTtft(this.config.ttftWarm, 'warm');
    const ttftColdMs = await this.measureTtft(this.config.ttftCold, 'cold');
    const queryEmbeddingLatencyMs = await this.measureEmbedding();
    const retrievalP95Ms = await this.measureRetrieval();
    const peakRamMb = await this.measureRamPeak();

    const completedAt = now().toISOString();

    const metrics: BenchmarkMetrics = {
      decodeTokensPerSec,
      prefillTokensPerSec,
      ttftWarmMs,
      ttftColdMs,
      queryEmbeddingLatencyMs,
      retrievalP95Ms,
      peakRamMb,
    };

    return {
      tier: this.config.tier,
      device: this.config.device,
      appVersion: this.config.appVersion,
      buildNumber: this.config.buildNumber,
      iterations: this.config.iterations.iterations,
      startedAt,
      completedAt,
      metrics,
    };
  }

  private get iterationCounts(): {
    iterations: number;
    warmupIterations: number;
  } {
    return this.config.iterations;
  }

  private async measureDecode(): Promise<MeasuredMetric> {
    const cfg = this.config.decode;
    if (!cfg) {
      return { status: 'not-run', reason: 'no DecodeClient injected' };
    }
    const { iterations, warmupIterations } = this.iterationCounts;
    for (let i = 0; i < warmupIterations; i++) {
      await cfg.client.decode(cfg.tokenCount);
    }
    const rates: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const { durationMs, tokensGenerated } = await cfg.client.decode(
        cfg.tokenCount,
      );
      if (durationMs > 0) rates.push((tokensGenerated / durationMs) * 1000);
    }
    if (rates.length === 0) {
      return {
        status: 'not-run',
        reason: 'no measured decode iteration produced a positive duration',
      };
    }
    return { status: 'measured', value: percentile(rates, 50) };
  }

  private async measurePrefill(): Promise<MeasuredMetric> {
    const cfg = this.config.prefill;
    if (!cfg) {
      return { status: 'not-run', reason: 'no PrefillClient injected' };
    }
    const { iterations, warmupIterations } = this.iterationCounts;
    for (let i = 0; i < warmupIterations; i++) {
      await cfg.client.prefill(cfg.promptTokenCount);
    }
    const rates: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const { durationMs, tokensProcessed } = await cfg.client.prefill(
        cfg.promptTokenCount,
      );
      if (durationMs > 0) rates.push((tokensProcessed / durationMs) * 1000);
    }
    if (rates.length === 0) {
      return {
        status: 'not-run',
        reason: 'no measured prefill iteration produced a positive duration',
      };
    }
    return { status: 'measured', value: percentile(rates, 50) };
  }

  private async measureTtft(
    cfg: { client: TtftClient } | undefined,
    session: 'warm' | 'cold',
  ): Promise<MeasuredMetric> {
    if (!cfg) {
      return {
        status: 'not-run',
        reason: `no TtftClient injected for the ${session} session`,
      };
    }
    const { iterations, warmupIterations } = this.iterationCounts;
    const warmSession = session === 'warm';
    for (let i = 0; i < warmupIterations; i++) {
      await cfg.client.measureTtft(warmSession);
    }
    const durations: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const { durationMs } = await cfg.client.measureTtft(warmSession);
      durations.push(durationMs);
    }
    return { status: 'measured', value: percentile(durations, 95) };
  }

  private async measureEmbedding(): Promise<MeasuredMetric> {
    const cfg = this.config.embedding;
    if (!cfg) {
      return { status: 'not-run', reason: 'no EmbeddingClient injected' };
    }
    if (cfg.queries.length === 0) {
      return { status: 'not-run', reason: 'no queries supplied' };
    }
    const { iterations, warmupIterations } = this.iterationCounts;
    for (let i = 0; i < warmupIterations; i++) {
      await cfg.client.embedQuery(cfg.queries[i % cfg.queries.length]);
    }
    const durations: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const { durationMs } = await cfg.client.embedQuery(
        cfg.queries[i % cfg.queries.length],
      );
      durations.push(durationMs);
    }
    return { status: 'measured', value: percentile(durations, 95) };
  }

  private async measureRetrieval(): Promise<MeasuredMetric> {
    const cfg = this.config.retrieval;
    if (!cfg) {
      return { status: 'not-run', reason: 'no RetrievalEngine injected' };
    }
    if (cfg.queries.length === 0) {
      return { status: 'not-run', reason: 'no queries supplied' };
    }
    const { iterations, warmupIterations } = this.iterationCounts;
    for (let i = 0; i < warmupIterations; i++) {
      await cfg.engine.query(cfg.queries[i % cfg.queries.length]);
    }
    const durations: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      await cfg.engine.query(cfg.queries[i % cfg.queries.length]);
      durations.push(Date.now() - start);
    }
    return { status: 'measured', value: percentile(durations, 95) };
  }

  private async measureRamPeak(): Promise<MeasuredMetric> {
    const cfg = this.config.ramPeak;
    if (!cfg) {
      return {
        status: 'not-run',
        reason:
          "no RamPeakSampler injected — iOS has no cross-platform JS/JSI API for resident-memory sampling; a real implementation needs a small native module reading task_info's phys_footprint, not built in this task (§8.6's device-run leg is QA-gated separately, #136)",
      };
    }
    if (cfg.sampleCount < 1) {
      return {
        status: 'not-run',
        reason: `sampleCount must be >= 1 (configured: ${cfg.sampleCount})`,
      };
    }
    const samples: number[] = [];
    for (let i = 0; i < cfg.sampleCount; i++) {
      samples.push(await cfg.sampler.sampleResidentMemoryBytes());
    }
    return { status: 'measured', value: Math.max(...samples) / BYTES_PER_MB };
  }
}
