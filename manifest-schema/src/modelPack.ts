import { z } from "zod";

/** SPEC-APP.md §14: the two shipped model tiers (1.7B on ≥6GB RAM, 0.6B otherwise). */
export const ModelPackTierSchema = z.enum(["1.7B", "0.6B"]);
export type ModelPackTier = z.infer<typeof ModelPackTierSchema>;

const SHA256_RE = /^[0-9a-f]{64}$/i;

export const ModelPackArtifactSchema = z.object({
  name: z.string(),
  file: z.string(),
  sha256: z.string().regex(SHA256_RE, "sha256 must be a 64-character hex string"),
  sizeBytes: z.number().int().nonnegative(),
  /** SPDX license identifier (e.g. "Apache-2.0") — REQUIRED per §4 Glossary
   * "Manifest": "per-artifact license identifiers". */
  licenseId: z.string().min(1),
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
