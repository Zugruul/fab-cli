/**
 * Pure ExportRunSpec -> slm-training export-gguf bundle config builder
 * (APP-021, SPEC-APP.md §8.2). Mirrors training/configBuilder.ts's role:
 * nothing here touches a filesystem or a process — this module only decides
 * what JSON to write for the remote job, resolving spec overrides onto
 * documented defaults the same way training/configBuilder.ts resolves
 * hyperparams onto TIER_DEFAULTS.
 */
import { createHash } from "node:crypto";
import { BASE_MODEL_BY_TIER } from "../training/types.js";
import type { ModelTier } from "../training/types.js";
import type { ExportBundleConfig, ExportRunSpec, SmokeConfig } from "./types.js";

/** §8.2: "quantize (Q4_K_M primary; Q8_0 reference)". */
export const DEFAULT_QUANTIZATIONS = ["q4_k_m", "q8_0"];

/** Matches training/configBuilder.ts's TIER_DEFAULTS.maxSeqLength — the
 * export should be able to serve whatever context the training run itself
 * assumed by default. */
export const DEFAULT_MAX_SEQ_LENGTH = 2048;

/**
 * §8.2's smoke requirement is "load + ONE JSON-schema-constrained
 * completion" — a mechanical llama.cpp-loads-and-obeys-a-schema check, not a
 * model-quality eval (that's APP-022). The default prompt/schema are
 * deliberately domain-agnostic (no FAB-specific content) so the smoke never
 * depends on the model having actually learned anything yet — it only
 * proves the exported GGUF loads in llama.cpp and that grammar-constrained
 * decoding against a schema still parses as valid JSON on that artifact.
 */
export const DEFAULT_SMOKE_PROMPT = "Reply with a single JSON object matching the schema. Do not include any other text.";
export const DEFAULT_SMOKE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
};
export const DEFAULT_SMOKE_MAX_TOKENS = 128;

export function resolveSmoke(spec: ExportRunSpec): SmokeConfig {
  const override = spec.smoke ?? {};
  const resolved: SmokeConfig = {
    prompt: override.prompt ?? DEFAULT_SMOKE_PROMPT,
    jsonSchema: override.jsonSchema ?? DEFAULT_SMOKE_SCHEMA,
    maxTokens: override.maxTokens ?? DEFAULT_SMOKE_MAX_TOKENS,
  };
  // Omitted entirely (not even `undefined`-valued) when not overridden, so
  // buildExportConfig doesn't have to distinguish "unset" from "explicitly
  // undefined" — export_gguf.py's own fallback discovery applies whenever
  // the bundle config's smoke.llama_server key is simply absent.
  if (override.llamaServer !== undefined) resolved.llamaServer = override.llamaServer;
  // Deprecated (issue #221) but still passed through independently — see
  // SmokeConfig.llamaCli's doc comment for why this isn't folded into
  // llamaServer here (export_gguf.py does that derivation, remotely).
  if (override.llamaCli !== undefined) resolved.llamaCli = override.llamaCli;
  return resolved;
}

/**
 * Builds the exact bundle config for the remote export-gguf job.
 * `adaptersDir` is the ALREADY-RESOLVED local/training-run adapters path (or
 * null for a base-as-is export) — resolution itself (reading a training
 * run's manifest, validating exactly-one-source) is runner.ts's job, not
 * this pure module's; see runner.ts's resolveAdapters().
 */
export function buildExportConfig(spec: ExportRunSpec, adaptersDir: string | null): ExportBundleConfig {
  const smoke = resolveSmoke(spec);
  const config: ExportBundleConfig = {
    base_model: BASE_MODEL_BY_TIER[spec.tier],
    quantizations: spec.quantizations ?? DEFAULT_QUANTIZATIONS,
    max_seq_length: spec.maxSeqLength ?? DEFAULT_MAX_SEQ_LENGTH,
    smoke: {
      prompt: smoke.prompt,
      json_schema: smoke.jsonSchema,
      max_tokens: smoke.maxTokens,
    },
  };
  if (adaptersDir) config.adapters = adaptersDir;
  if (smoke.llamaServer !== undefined) config.smoke.llama_server = smoke.llamaServer;
  if (smoke.llamaCli !== undefined) config.smoke.llama_cli = smoke.llamaCli;
  return config;
}

/**
 * Same "identity hash over the id string, not a weights hash" honesty rule
 * as training/configBuilder.ts's computeBaseModelHash — see that module's
 * doc comment for the full rationale (a real weights hash only exists once
 * the bundle actually downloads/runs the model remotely, and would have to
 * land in the manifest from a real artifact, never fabricated locally).
 * Export doesn't take a baseModelRevision override — the run always targets
 * whatever base model name BASE_MODEL_BY_TIER[tier] resolves to, matching
 * the training run it exports — so this only ever hashes the bare id.
 */
export function computeBaseModelHash(tier: ModelTier): string {
  return createHash("sha256").update(BASE_MODEL_BY_TIER[tier]).digest("hex");
}
