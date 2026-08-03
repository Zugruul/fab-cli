/**
 * Model export chain (APP-021, issue #133, SPEC-APP.md §8.2 + §5) — shared
 * types. Mirrors training/types.ts's shape exactly: a caller-authored spec,
 * a pure bundle config, an injectable dispatcher, a resumable RunState, and
 * a committed per-run manifest — this time recording checksums, licenses,
 * and the llama.cpp smoke result required before packaging eligibility.
 *
 * Deliberately reuses rather than re-derives training's ModelTier and
 * BASE_MODEL_BY_TIER (§8.2 exports the SAME base model the §8.1 run trained
 * against — there is no export-specific tier concept), its
 * TrainingEnvironment shape + EnvironmentInputs assembly (the training-
 * environment capture requirement is §8.1's and applies unchanged to every
 * committed manifest, per the issue's brief), and its TrainingDispatcher
 * interface (aliased ExportDispatcher below — see realDispatcher.ts for why
 * the real dispatcher implementation is reused too, not reimplemented).
 */
import type { EnvironmentInputs, ModelTier, TrainingDispatcher, TrainingEnvironment } from "../training/types.js";
import { BASE_MODEL_BY_TIER } from "../training/types.js";

export type { EnvironmentInputs, ModelTier, TrainingEnvironment };
export { BASE_MODEL_BY_TIER };

/** The generic remote-compute dispatch boundary (run/status/pullArtifacts)
 * has no sft/dpo/export-specific shape — it's identical to
 * training/types.ts's TrainingDispatcher. Aliased here so export/ code
 * never has to name "Training" to describe its own dispatch boundary. */
export type ExportDispatcher = TrainingDispatcher;
export type DispatcherStatus = "running" | "completed" | "failed";

export interface SmokeConfig {
  /** The single prompt sent under grammar-constrained decoding — §8.2 asks
   * for exactly ONE JSON-schema-constrained completion per artifact, not a
   * suite (that's APP-022's eval harness). */
  prompt: string;
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
  /** Optional override of the llama-server binary path on the remote
   * machine (issue #221: the smoke vehicle moved from llama-cli's CLI to
   * llama-server's HTTP API — llama-cli's grammar-sampler init failure and
   * stdin-EOF interactive-REPL busy-loop were reproduced identically across
   * three independent llama.cpp builds and made it unusable on storm590x;
   * llama-server has no in-process grammar-sampler init path and no
   * interactive REPL, so both failure modes are structurally avoided).
   * export_gguf.py falls back to its own documented discovery order
   * (working dir + $HOME, searching llama.cpp-prefixed dirs for
   * llama-server/server) when this is omitted — see that script's doc
   * comment for the exact order. */
  llamaServer?: string;
  /** @deprecated renamed to llamaServer (issue #221) — still accepted and
   * passed through onto the bundle config's smoke.llama_cli, where
   * export_gguf.py derives the llama-server path from the same directory
   * (a WARNING is logged remotely) so an existing caller's config keeps
   * working across the rename rather than breaking outright. */
  llamaCli?: string;
}

/** A caller-authored export run request. Optional fields are overrides onto
 * configBuilder.ts's documented defaults — never required. Exactly one of
 * adaptersRunId/adaptersDir may be set (ambiguous otherwise, refused by
 * runner.ts before ever calling the dispatcher); neither set means "export
 * the base model as-is", export_gguf.py's own documented base-only mode. */
export interface ExportRunSpec {
  tier: ModelTier;
  /** A completed APP-020 training run's id — its committed
   * training-runs/<id>/manifest.json is read for artifacts.adaptersDir +
   * artifacts.files (never re-derived; read verbatim, per §13 Invariant 7's
   * "reproducible from committed manifests"). */
  adaptersRunId?: string;
  /** A local adapters directory to export directly, bypassing the training
   * manifest lookup (e.g. for ad hoc/local exports outside the committed
   * run ledger). */
  adaptersDir?: string;
  /** §8.2: "quantize (Q4_K_M primary; Q8_0 reference)" — defaults to both. */
  quantizations?: string[];
  maxSeqLength?: number;
  smoke?: Partial<SmokeConfig>;
}

/** The exact JSON shape the slm-training:export-gguf capability job's
 * export_gguf.py config surface expects, post its APP-021 `smoke` section
 * extension (capability.yaml's documented keys) — see configBuilder.ts. */
export interface ExportBundleConfig {
  base_model: string;
  adapters?: string;
  quantizations: string[];
  max_seq_length: number;
  smoke: {
    prompt: string;
    json_schema: Record<string, unknown>;
    max_tokens: number;
    llama_server?: string;
    /** @deprecated see SmokeConfig.llamaCli — kept as a passthrough, never
     * synthesized from llamaServer. */
    llama_cli?: string;
  };
}

/** Where the exported adapters came from — echoed into the manifest so a
 * committed export run is traceable back to the exact training run (or
 * local dir, or "none: base model as-is") it merged. */
export interface ExportAdaptersSource {
  trainingRunId: string | null;
  adaptersDir: string | null;
  adaptersSha256s: { name: string; sha256: string }[];
}

/** Mirrors export-summary.json's files[] entries exactly (file, quantization,
 * sizeBytes, sha256) — a zero-transform echo of what export_gguf.py actually
 * produced, never recomputed locally. */
export interface ExportArtifactFile {
  file: string;
  quantization: string;
  sizeBytes: number;
  sha256: string;
}

/** Mirrors export-summary.json's smoke.perFile[] entries exactly. §8.2:
 * "smoke-test each artifact in llama.cpp (load + one JSON-schema-constrained
 * completion) before it is eligible for packaging." */
export interface SmokeFileResult {
  file: string;
  loaded: boolean;
  /** Truncated to 2000 chars by export_gguf.py before it ever lands in
   * export-summary.json — never re-truncated or otherwise transformed here. */
  constrainedOutputRaw: string;
  parsedOk: boolean;
}

export interface ExportLicenses {
  baseModel: string;
  adapters: string;
  ggufs: string;
}

/** The committed per-run export manifest (§8.2's AC: "artifacts load in
 * llama.cpp CLI; constrained output parses; checksums + licenses in
 * manifest"). Written once a run reaches a terminal state (completed or
 * failed) — see runner.ts. */
export interface ExportRunManifest {
  schemaVersion: string;
  runId: string;
  tier: ModelTier;
  baseModel: string;
  baseModelHash: string;
  source: ExportAdaptersSource;
  quantizations: string[];
  artifacts: { files: ExportArtifactFile[] };
  smoke: { schema: Record<string, unknown>; perFile: SmokeFileResult[] };
  licenses: ExportLicenses;
  environment: TrainingEnvironment;
  dispatch: { resource: string; jobId: string; capabilityJob: string };
  timestamps: { dispatchedAt: string; completedAt: string | null };
  status: "completed" | "failed";
}

/** Persisted resumability checkpoint (state.json) — written after every
 * status transition so a killed/resumed process can pick up from exactly
 * where it stopped. Shape mirrors training/types.ts's RunState (see
 * runner.ts's run()/resume() for the transition semantics; note that the
 * "failed" branch here additionally pulls artifacts once, per §8.2's
 * smoke-diagnostics requirement — see runner.ts's doc comment). */
export interface ExportRunState {
  runId: string;
  spec: ExportRunSpec;
  jobId: string;
  status: "dispatched" | "completed" | "manifested" | "failed";
  timestamps: {
    dispatchedAt: string;
    completedAt?: string;
    manifestedAt?: string;
    failedAt?: string;
  };
}

export interface ExportRunnerOptions {
  /** pipeline/export-runs — run dirs live at `${runsDir}/${runId}`. */
  runsDir: string;
  /** pipeline/training-runs — where adaptersRunId resolves a training run's
   * committed manifest.json. Never written to by this module. */
  trainingRunsDir: string;
  dispatcher: ExportDispatcher;
  /** remote-compute.py resource nickname, e.g. "storm590x". */
  resource: string;
  /** capability:job string, e.g. "slm-training:export-gguf". */
  capabilityJob: string;
  /** Local dir shipped to the remote machine via ExportDispatcher's
   * inputsDir (config lands here for the real dispatcher). */
  inputsDir: string;
  environment: EnvironmentInputs;
  now?: () => string;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
}

export interface ExportRunResult {
  runId: string;
  state: ExportRunState;
  manifest: ExportRunManifest | null;
}
