/**
 * APP-029 (SPEC-APP.md §8.8/§8.9/§7.10; issue #141): shared types for the
 * pack-assembly + publish machinery. Nothing here is a schema shape of its
 * own — @fab/manifest-schema stays the single source of truth for
 * ModelPackManifest/KnowledgePackManifest/DeltaPackManifest (§7.11's "no
 * lane invents its own manifest shape"). These types describe the
 * ASSEMBLY-TIME inputs (which real files feed a pack) and the
 * PUBLISH-TIME outputs (which flat assets a release would carry).
 */
import type { ModelPackTier, EvalScores } from "@fab/manifest-schema";
import type { BuildFullPackInput } from "../knowledge/build.js";
import type { SnapshotForDelta } from "../knowledge/deltaPack.js";

export type { ModelPackTier };

/** A real, already-produced file this pipeline never re-derives — the
 * assembler hashes it directly from disk rather than trusting any
 * producer-recorded checksum. `version` is a free-form label (a run id,
 * an embedder version string, ...) echoed into the manifest's per-artifact
 * `version` field; `licenseId` must be a bare SPDX identifier (validated
 * by @fab/manifest-schema, not re-validated here). */
export interface ResolvedArtifactFile {
  path: string;
  licenseId: string;
  version: string;
}

export type ModelPackArtifactSlot = "mergedGguf" | "textEmbedderGguf" | "detectorTflite" | "visionEmbedderTflite";

/** One entry per file a model pack ships (SPEC-APP.md §8.9): the merged +
 * quantized LLM, the text embedder, the card detector, and the vision
 * (recognition) embedder. A `null` slot is a first-class "not produced
 * yet" state — never a fabricated placeholder file. */
export interface ModelPackArtifactMap {
  mergedGguf: ResolvedArtifactFile | null;
  textEmbedderGguf: ResolvedArtifactFile | null;
  detectorTflite: ResolvedArtifactFile | null;
  visionEmbedderTflite: ResolvedArtifactFile | null;
}

export interface AssembleModelPackInput {
  tier: ModelPackTier;
  /** Directory the assembled manifest.json is written to (mirrors
   * pipeline/src/knowledge/build.ts's own outDir convention). */
  outDir: string;
  artifacts: ModelPackArtifactMap;
  baseModelHash: string;
  textEmbedderVersion: string;
  visionEmbedderVersion: string;
  detectorVersion: string;
  compatibleKnowledgePacks: string;
  appMinVersion: string;
  corpusSnapshotHash: string;
  evalScores: EvalScores;
}

/** One file a publish step would upload, named per releaseLayout.ts's
 * convention — the flat namespace a GitHub Release asset list actually
 * is (no subdirectories). */
export interface PublishAsset {
  assetName: string;
  localPath: string;
  sha256: string;
  sizeBytes: number;
}

export type PublishBundleKind = "model-pack" | "knowledge-full" | "knowledge-delta";

export interface PublishBundle {
  kind: PublishBundleKind;
  /** Human label distinguishing bundles of the same kind (a tier, or a
   * pack version) — used only for reporting, not asset naming (that's
   * releaseLayout.ts's job, kept as a pure function of the real
   * filenames). */
  label: string;
  assets: PublishAsset[];
}

/** A planned release asset, with enough context (kind/label) for a human
 * reading release-manifest.json to see what each file is without opening
 * it. */
export interface ReleasePlanAsset extends PublishAsset {
  kind: PublishBundleKind;
  label: string;
}

export interface ReleasePlan {
  releaseVersion: string;
  tag: string;
  createdAt: string;
  assets: ReleasePlanAsset[];
}

export interface BuildReleasePlanInput {
  releaseVersion: string;
  /** Local directory the complete flat bundle tree is written to — exactly
   * what a real publish would upload, one file per asset, plus
   * checksums.txt and release-manifest.json. Refused if non-empty already,
   * unless `force` is passed (SPEC-APP.md §14 "Reliability": a corrupted/
   * mismatched re-publish must never silently clobber a previous one). */
  outDir: string;
  /** Raw (unvalidated) corpus-snapshot-manifest JSON — the §7.10 shipping-
   * mode precondition is checked against this BEFORE any assembly is
   * attempted. */
  corpusSnapshotManifestRaw: unknown;
  /** Which tiers to attempt. A tier whose artifact map is incomplete fails
   * ONLY that tier (partial-tier publishing is an intentional boundary
   * convention — see releasePlan.ts's doc comment) rather than the whole
   * plan. */
  modelPacks: { tier: ModelPackTier; input: Omit<AssembleModelPackInput, "outDir" | "tier"> }[];
  /** `outDir` is chosen internally (a staging subdir) — the caller only
   * supplies the builder input, mirroring modelPacks[].input above. */
  knowledgeFull?: { input: Omit<BuildFullPackInput, "outDir"> };
  knowledgeDelta?: { from: SnapshotForDelta; to: SnapshotForDelta };
  /** Re-publish an outDir/tag that already has content. Off by default. */
  force?: boolean;
}

export type ModelPackPlanResult = { tier: ModelPackTier; status: "ok" } | { tier: ModelPackTier; status: "failed"; error: string };

export type KnowledgeDeltaPlanResult = { status: "ok" } | { status: "refused"; reason: string };

export type BuildReleasePlanResult =
  | { ok: false; reason: string; modelPackResults?: undefined }
  | {
      ok: true;
      plan: ReleasePlan;
      modelPackResults: ModelPackPlanResult[];
      knowledgeDeltaResult?: KnowledgeDeltaPlanResult;
    };
