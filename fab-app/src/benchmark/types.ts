// APP-024 (#136): SPEC-APP.md §8.6/§10.2/§14 on-device benchmark protocol
// types. Every model-dependent client below is an injectable interface —
// mirroring ../retrieval/types.ts's and ../lifecycle/types.ts's own
// injection style — so runner.ts is fully unit-testable against
// deterministic stub clients (see __tests__/testDoubles.ts); the real
// llama.rn/native wiring lands with device-integration work, out of scope
// here (§8.6's device-run leg is QA-gated separately on #136).

import type { ModelPackTier } from '@fab/manifest-schema';
import type { RetrievalEngine } from '../retrieval/engine';

/** Every §8.6 metric supports this honest "not-run" state instead of a
 * fabricated number — a missing client, empty query list, or unavailable
 * native capability (e.g. no on-device RAM sampler) all resolve here.
 * Mirrors @fab/manifest-schema's own MeasuredMetric shape exactly (see
 * manifestMapping.ts, which passes these straight through unchanged). */
export type MeasuredMetric =
  | { status: 'measured'; value: number }
  | { status: 'not-run'; reason: string };

export interface BenchmarkMetrics {
  decodeTokensPerSec: MeasuredMetric;
  prefillTokensPerSec: MeasuredMetric;
  ttftWarmMs: MeasuredMetric;
  ttftColdMs: MeasuredMetric;
  queryEmbeddingLatencyMs: MeasuredMetric;
  retrievalP95Ms: MeasuredMetric;
  peakRamMb: MeasuredMetric;
}

export interface DecodeClient {
  /** Generates a fixed number of tokens from a short standard prompt,
   * returning DECODE-ONLY wall-clock duration (a real client should start
   * timing after the first token / after prefill completes) and the
   * actual token count generated (a real client may not hit the target
   * exactly). */
  decode(
    tokenCount: number,
  ): Promise<{ durationMs: number; tokensGenerated: number }>;
}

export interface PrefillClient {
  /** Processes a prompt of approximately `promptTokenCount` tokens,
   * returning PREFILL-ONLY wall-clock duration (excludes any generated
   * tokens) and the actual token count processed. */
  prefill(
    promptTokenCount: number,
  ): Promise<{ durationMs: number; tokensProcessed: number }>;
}

export interface TtftClient {
  /** Time-to-first-token for one full turn (prefill + first decoded
   * token). `warmSession` distinguishes an existing KV session/context
   * (§10.6 saveSession/loadSession) from a freshly cold-loaded one —
   * mirrors §14's warm/cold TTFT split. */
  measureTtft(warmSession: boolean): Promise<{ durationMs: number }>;
}

export interface EmbeddingClient {
  embedQuery(text: string): Promise<{ durationMs: number }>;
}

export interface RamPeakSampler {
  /** One instantaneous resident-memory sample in bytes. See runner.ts's
   * doc comment for exactly what this measures and why no default/
   * production implementation ships in this task. */
  sampleResidentMemoryBytes(): Promise<number>;
}

export interface IterationConfig {
  /** Measured iterations aggregated into each metric's reported value. */
  iterations: number;
  /** Iterations run and discarded before the measured iterations begin —
   * applies uniformly to every iterated metric (decode/prefill/TTFT/
   * embedding/retrieval); RAM peak sampling has no warmup concept of its
   * own (see ramPeak config below). */
  warmupIterations: number;
}

export interface BenchmarkRunnerConfig {
  tier: ModelPackTier;
  device: { model: string; osVersion: string };
  appVersion: string;
  buildNumber: string;
  iterations: IterationConfig;
  decode?: { client: DecodeClient; tokenCount: number };
  prefill?: { client: PrefillClient; promptTokenCount: number };
  ttftWarm?: { client: TtftClient };
  ttftCold?: { client: TtftClient };
  embedding?: { client: EmbeddingClient; queries: string[] };
  /** The REAL APP-033 retrieval engine (../retrieval/engine.ts) — this
   * benchmark measures its actual query() latency, never a fake stand-in,
   * per the APP-024 brief's "cite APP-033's engine" instruction. */
  retrieval?: { engine: RetrievalEngine; queries: string[] };
  ramPeak?: { sampler: RamPeakSampler; sampleCount: number };
  /** Injectable clock for startedAt/completedAt — defaults to `new Date()`.
   * Overridden in tests for deterministic timestamps. */
  now?: () => Date;
}

export interface BenchmarkRunResult {
  tier: ModelPackTier;
  device: { model: string; osVersion: string };
  appVersion: string;
  buildNumber: string;
  iterations: number;
  startedAt: string;
  completedAt: string;
  metrics: BenchmarkMetrics;
}
