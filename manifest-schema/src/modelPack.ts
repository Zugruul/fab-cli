import { z } from "zod";
import { EvalScoresSchema } from "./evalScores.js";
import { ModelPackTierSchema } from "./tiers.js";
import { BenchmarkResultSchema } from "./benchmarkResults.js";

// Re-exported from ./tiers.js (moved there so benchmarkResults.ts can
// import the tier enum without a modelPack.ts <-> benchmarkResults.ts
// import cycle — see tiers.ts's doc comment). Kept here too so no existing
// `import { ModelPackTierSchema } from "./modelPack.js"` breaks.
export { ModelPackTierSchema };
export type ModelPackTier = z.infer<typeof ModelPackTierSchema>;

const SHA256_RE = /^[0-9a-f]{64}$/i;

/**
 * Shape of a bare SPDX license identifier (e.g. "MIT", "Apache-2.0",
 * "GPL-3.0-only"): letters/digits plus "." "+" "-". This checks *format*
 * only — it does not validate against the real SPDX license list, and it
 * does not parse the full SPDX license-expression grammar (AND/OR/WITH
 * combinators); that's out of scope for v0.1.0.
 */
const SPDX_ID_FORMAT_RE = /^[A-Za-z0-9][A-Za-z0-9.+-]*$/;

/**
 * A short list of literal placeholder values that are shaped like a bare
 * identifier (so SPDX_ID_FORMAT_RE alone wouldn't catch them) but are
 * never real SPDX license identifiers — the failure mode this guards
 * against is a manifest built with the field left unfilled, not a
 * genuinely ambiguous license name.
 */
const KNOWN_PLACEHOLDER_LICENSE_IDS = new Set(["TODO", "TBD", "FIXME", "XXX", "UNKNOWN", "N/A", "NONE"]);

export const ModelPackArtifactSchema = z.object({
  name: z.string(),
  file: z.string(),
  sha256: z.string().regex(SHA256_RE, "sha256 must be a 64-character hex string"),
  sizeBytes: z.number().int().nonnegative(),
  /** SPDX license identifier (e.g. "Apache-2.0") — REQUIRED per §4 Glossary
   * "Manifest": "per-artifact license identifiers". */
  licenseId: z
    .string()
    .min(1)
    .regex(
      SPDX_ID_FORMAT_RE,
      'licenseId must look like a bare SPDX license identifier (letters/digits/"."/"+"/"-" only, e.g. "Apache-2.0", "MIT", "GPL-3.0-only") — free text and full SPDX expressions (AND/OR/WITH) are not accepted',
    )
    .refine((v) => !KNOWN_PLACEHOLDER_LICENSE_IDS.has(v.toUpperCase()), {
      message: "licenseId must be a real SPDX license identifier, not a placeholder",
    }),
  version: z.string(),
});
export type ModelPackArtifact = z.infer<typeof ModelPackArtifactSchema>;

/**
 * Model pack manifest (SPEC-APP.md §4 Glossary "Model pack", §9.3
 * compatibility fields: embedder version ↔ index version, model ↔ app
 * min-version).
 */
const ModelPackManifestShape = z.object({
  schemaVersion: z.string().min(1),
  tier: ModelPackTierSchema,
  artifacts: z.array(ModelPackArtifactSchema),
  baseModelHash: z.string(),
  textEmbedderVersion: z.string(),
  visionEmbedderVersion: z.string(),
  detectorVersion: z.string(),
  /** Semver range of compatible knowledge-pack versions (§4 Glossary: "a
   * model pack is compatible with ≥1 knowledge pack versions as declared
   * in manifests"). */
  compatibleKnowledgePacks: z.string(),
  appMinVersion: z.string(),
  corpusSnapshotHash: z.string(),
  /** Per-suite eval-gate results (SPEC-APP.md §8.5, §13 invariant 8: "no
   * model or knowledge pack is released without passing the eval gate").
   * REQUIRED, not optional — a model pack manifest with no eval record
   * would silently re-open the exact hole invariant 8 exists to close.
   * Produced by pipeline/src/eval (APP-022, #134); see evalScores.ts for
   * the per-suite shape and its own runtime invariants (all eight named
   * suites present, no duplicates, no zero-item vacuous suite).
   */
  evalScores: EvalScoresSchema,
  /** On-device benchmark protocol results (SPEC-APP.md §8.6/§10.2/§14;
   * APP-024 issue #136) — the "release-manifest integration" point.
   * OPTIONAL, unlike evalScores: see benchmarkResults.ts's doc comment for
   * why this manifest must keep validating before a real device run
   * exists. */
  benchmarkResults: BenchmarkResultSchema.optional(),
});

export const ModelPackManifestSchema = ModelPackManifestShape.superRefine((manifest, ctx) => {
  if (manifest.benchmarkResults && manifest.benchmarkResults.tier !== manifest.tier) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["benchmarkResults", "tier"],
      message: `benchmarkResults.tier ("${manifest.benchmarkResults.tier}") must match the model pack's own tier ("${manifest.tier}") — a device run recorded for one tier cannot be attached to a different tier's manifest`,
    });
  }
});
export type ModelPackManifest = z.infer<typeof ModelPackManifestShape>;
