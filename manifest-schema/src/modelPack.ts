import { z } from "zod";

/** SPEC-APP.md §14: the two shipped model tiers (1.7B on ≥6GB RAM, 0.6B otherwise). */
export const ModelPackTierSchema = z.enum(["1.7B", "0.6B"]);
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
export const ModelPackManifestSchema = z.object({
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
});
export type ModelPackManifest = z.infer<typeof ModelPackManifestSchema>;
