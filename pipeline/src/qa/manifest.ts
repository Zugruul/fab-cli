import { createHash } from "node:crypto";
import type {
  ChunkGenerationOutcome,
  GenerationConfig,
  ProgressState,
  RunResult,
} from "./types.js";

const SCHEMA_VERSION = "0.1.0"; // local/plain for now — APP-016 formalizes a shared schema package

// Real entailment-checked acceptance sampling is APP-012's job (SPEC-APP.md
// §7.4). This run's acceptedPairCount only reflects "parsed + correctly
// cited" — that's a floor, not the final acceptance rate — so every
// manifest says so explicitly rather than implying a number it can't back.
const ACCEPTANCE_PLACEHOLDER =
  "acceptedPairCount reflects parse success + citation validity only — entailment-checked " +
  "acceptance sampling against the source chunk is APP-012's job (SPEC-APP.md §7.4); this is " +
  "not yet the final acceptance rate.";

/** Deterministic JSON stringification: object keys sorted recursively, so
 * two configs with identical content but different key order hash equal. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeysDeep(v)]));
  }
  return value;
}

/** SHA-256 hex digest of a generation config, stable across key reordering
 * — the run manifest's "config hash" (SPEC-APP.md §7.7 direction). */
export function configHash(config: unknown): string {
  return createHash("sha256").update(stableStringify(config)).digest("hex");
}

export interface QARunManifest {
  schemaVersion: string;
  runDate: string;
  teacherModel: string;
  /** Which teacher transport generated this run (issue #223) — see
   * engine.ts's EngineId. Recorded alongside teacherModel so a shipped
   * dataset's full generation lineage (model AND transport) is auditable
   * from the manifest alone, per SPEC-APP.md §13 invariant 7. */
  engineId: string;
  configHash: string;
  dryRun: boolean;
  /** Total chunks the run was invoked against (including any already
   * done/failed from a prior run and skipped this time). */
  chunkCount: number;
  /** Chunks actually attempted THIS invocation. */
  processedCount: number;
  acceptedPairCount: number;
  rejectedPairCount: number;
  failedChunkCount: number;
  costUsd: number;
  requestCount: number;
  stoppedEarly: string | null;
  acceptancePlaceholder: string;
}

export interface BuildRunManifestOptions {
  config: GenerationConfig;
  dryRun: boolean;
  chunkCount: number;
  outcomes: ChunkGenerationOutcome[];
  progress: ProgressState;
  stoppedEarly: RunResult["stoppedEarly"];
  /** Required, not defaulted here — the caller (cli.ts) resolves it via
   * resolveEngineId before a manifest is ever built, so a manifest can
   * never be written without recording which transport produced it. */
  engineId: string;
  now?: () => string;
}

export function buildRunManifest(opts: BuildRunManifestOptions): QARunManifest {
  const now = opts.now ?? (() => new Date().toISOString());

  let acceptedPairCount = 0;
  let rejectedPairCount = 0;
  let failedChunkCount = 0;
  for (const outcome of opts.outcomes) {
    acceptedPairCount += outcome.pairs.length;
    rejectedPairCount += outcome.rejected.length;
    if (outcome.status === "failed") failedChunkCount++;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    runDate: now(),
    teacherModel: opts.config.teacherModel,
    engineId: opts.engineId,
    configHash: configHash(opts.config),
    dryRun: opts.dryRun,
    chunkCount: opts.chunkCount,
    processedCount: opts.outcomes.length,
    acceptedPairCount,
    rejectedPairCount,
    failedChunkCount,
    costUsd: opts.progress.costUsd,
    requestCount: opts.progress.requestCount,
    stoppedEarly: opts.stoppedEarly?.reason ?? null,
    acceptancePlaceholder: ACCEPTANCE_PLACEHOLDER,
  };
}
