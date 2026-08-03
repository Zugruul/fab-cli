/**
 * APP-029 (SPEC-APP.md §8.9, §7.10, §9.3; issue #141): the dry-run
 * orchestrator. Never touches the network — its only side effect is
 * writing a complete, flat bundle tree (exactly what a real publish would
 * upload) plus checksums.txt + release-manifest.json under `outDir`.
 *
 * Boundary conventions (decided up front, per the task's own "decide
 * before first test" lesson):
 *  - PARTIAL-TIER PUBLISHING IS SUPPORTED: a model-pack tier whose
 *    artifact map is incomplete (or otherwise fails to assemble) is
 *    recorded as `{tier, status: "failed", error}` and simply excluded
 *    from the bundle — it does not abort tiers that DID assemble
 *    successfully. Shipping only the 0.6B tier while 1.7B's artifacts
 *    aren't ready yet is an intentional, expected outcome, not a bug.
 *  - THE SHIPPING-MODE PRECONDITION (§7.10) AND OUTDIR RE-USE CHECK RUN
 *    BEFORE ANY ASSEMBLY IS ATTEMPTED — a failure here means zero bytes
 *    are ever written, staging or otherwise.
 *  - RE-PUBLISHING THE SAME `outDir` IS REFUSED BY DEFAULT — an existing,
 *    non-empty outDir is release-immutability: pass `force` to knowingly
 *    overwrite it (SPEC-APP.md §14 "Reliability": a corrupted/mismatched
 *    re-publish must never silently clobber a previous one).
 *  - CROSS-PACK EMBEDDER-VERSION CHECK: no single manifest schema
 *    enforces that a model pack and the knowledge pack published
 *    alongside it were built against the SAME text/vision embedder —
 *    fab-app's checkModelKnowledgeCompatibility (§9.3) only discovers a
 *    mismatch at LOAD time, on a user's device, which is too late for a
 *    publish that already shipped a broken pair. This module checks it at
 *    publish time instead and refuses the WHOLE plan (writes nothing) on
 *    a mismatch, one assembled tier at a time so the error names exactly
 *    which tier and which versions disagree.
 *  - Assembly happens into a private os.tmpdir() staging root first; only
 *    once every check (including the cross-check) has passed does this
 *    module copy the resulting real files into `outDir` under their final
 *    asset names — so a check that fails after some tiers assembled
 *    successfully still leaves `outDir` completely untouched.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { KnowledgePackManifest, ModelPackManifest, DeltaPackManifest } from "@fab/manifest-schema";
import { assembleModelPack } from "./modelPackAssembler.js";
import { assembleKnowledgeFullPack, assembleKnowledgeDeltaPack } from "./knowledgePackAssembler.js";
import { checkShippingModePrecondition } from "./shippingMode.js";
import { NO_TEXT_EMBEDDER_VERSION } from "../knowledge/textEmbeddingsInput.js";
import { NO_VISION_EMBEDDER_VERSION } from "../knowledge/imageEmbeddingsInput.js";
import { modelAssetName, knowledgeFullAssetName, knowledgeDeltaAssetName, releaseTag, formatChecksumsFile } from "./releaseLayout.js";
import type {
  BuildReleasePlanInput,
  BuildReleasePlanResult,
  KnowledgeDeltaPlanResult,
  ModelPackPlanResult,
  ModelPackTier,
  PublishAsset,
  PublishBundle,
  PublishBundleKind,
  ReleasePlan,
  ReleasePlanAsset,
} from "./types.js";

function copyAsset(asset: PublishAsset, assetName: string, outDir: string, kind: PublishBundleKind, label: string): ReleasePlanAsset {
  const dest = path.join(outDir, assetName);
  fs.copyFileSync(asset.localPath, dest);
  return { assetName, localPath: dest, sha256: asset.sha256, sizeBytes: asset.sizeBytes, kind, label };
}

export function buildReleasePlan(input: BuildReleasePlanInput): BuildReleasePlanResult {
  try {
    if (fs.existsSync(input.outDir) && fs.readdirSync(input.outDir).length > 0 && !input.force) {
      return { ok: false, reason: `publish refused: outDir "${input.outDir}" already contains a release bundle — pass force to overwrite it` };
    }

    const shippingCheck = checkShippingModePrecondition(input.corpusSnapshotManifestRaw);
    if (!shippingCheck.ok) {
      return { ok: false, reason: shippingCheck.reason };
    }

    const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fab-publish-staging-"));
    try {
      const modelPackResults: ModelPackPlanResult[] = [];
      const modelBundles: { tier: ModelPackTier; manifest: ModelPackManifest; bundle: PublishBundle }[] = [];

      for (const { tier, input: modelInput } of input.modelPacks) {
        try {
          const { manifest, bundle } = assembleModelPack({ ...modelInput, tier, outDir: path.join(stagingRoot, `model-${tier}`) });
          modelPackResults.push({ tier, status: "ok" });
          modelBundles.push({ tier, manifest, bundle });
        } catch (err) {
          modelPackResults.push({ tier, status: "failed", error: (err as Error).message });
        }
      }

      let knowledgeFullBundle: { manifest: KnowledgePackManifest; bundle: PublishBundle } | null = null;
      if (input.knowledgeFull) {
        try {
          knowledgeFullBundle = assembleKnowledgeFullPack({ ...input.knowledgeFull.input, outDir: path.join(stagingRoot, "knowledge-full") });
        } catch (err) {
          return { ok: false, reason: `knowledge-full pack assembly failed: ${(err as Error).message}` };
        }
      }

      let knowledgeDeltaResult: KnowledgeDeltaPlanResult | undefined;
      let knowledgeDeltaBundle: { manifest: DeltaPackManifest; bundle: PublishBundle } | null = null;
      if (input.knowledgeDelta) {
        const result = assembleKnowledgeDeltaPack(input.knowledgeDelta.from, input.knowledgeDelta.to, path.join(stagingRoot, "knowledge-delta"));
        if (result.status === "refused") {
          knowledgeDeltaResult = { status: "refused", reason: result.reason };
        } else {
          knowledgeDeltaResult = { status: "ok" };
          knowledgeDeltaBundle = result;
        }
      }

      // §9.3 cross-check, at publish time rather than load time (see doc comment above).
      // Skipped per-embedder when the knowledge side honestly has NO
      // embeddings of that kind yet (the NO_*_EMBEDDER_VERSION sentinels,
      // e.g. APP-028's vision embeddings being un-QA-gated today) — an
      // absent embedder has no version to disagree with the model pack
      // about, and requiring a match against a sentinel would make every
      // real dry-run fail today for a reason that isn't a real mismatch.
      const knowledgeEmbedders = knowledgeFullBundle
        ? { text: knowledgeFullBundle.manifest.textEmbedderVersion, vision: knowledgeFullBundle.manifest.visionEmbedderVersion }
        : input.knowledgeDelta
          ? { text: input.knowledgeDelta.to.textEmbedderVersion, vision: input.knowledgeDelta.to.visionEmbedderVersion }
          : null;

      if (knowledgeEmbedders) {
        for (const { tier, manifest } of modelBundles) {
          if (knowledgeEmbedders.text !== NO_TEXT_EMBEDDER_VERSION && manifest.textEmbedderVersion !== knowledgeEmbedders.text) {
            return {
              ok: false,
              reason:
                `cross-check failed: model pack tier "${tier}" textEmbedderVersion "${manifest.textEmbedderVersion}" does not match ` +
                `the knowledge pack's textEmbedderVersion "${knowledgeEmbedders.text}" — a published model+knowledge pair must share ` +
                "embedder versions (SPEC-APP.md §9.3; fab-app's checkModelKnowledgeCompatibility would refuse to load this pair)",
            };
          }
          if (knowledgeEmbedders.vision !== NO_VISION_EMBEDDER_VERSION && manifest.visionEmbedderVersion !== knowledgeEmbedders.vision) {
            return {
              ok: false,
              reason:
                `cross-check failed: model pack tier "${tier}" visionEmbedderVersion "${manifest.visionEmbedderVersion}" does not match ` +
                `the knowledge pack's visionEmbedderVersion "${knowledgeEmbedders.vision}" (SPEC-APP.md §9.3)`,
            };
          }
        }
      }

      // Every check passed — flush the real, flat bundle tree.
      fs.mkdirSync(input.outDir, { recursive: true });
      const planAssets: ReleasePlanAsset[] = [];

      for (const { tier, bundle } of modelBundles) {
        for (const asset of bundle.assets) {
          planAssets.push(copyAsset(asset, modelAssetName(tier, asset.assetName), input.outDir, "model-pack", tier));
        }
      }
      if (knowledgeFullBundle && input.knowledgeFull) {
        const version = input.knowledgeFull.input.version;
        for (const asset of knowledgeFullBundle.bundle.assets) {
          planAssets.push(copyAsset(asset, knowledgeFullAssetName(version, asset.assetName), input.outDir, "knowledge-full", version));
        }
      }
      if (knowledgeDeltaBundle && input.knowledgeDelta) {
        const { from, to } = input.knowledgeDelta;
        for (const asset of knowledgeDeltaBundle.bundle.assets) {
          planAssets.push(
            copyAsset(asset, knowledgeDeltaAssetName(from.version, to.version, asset.assetName), input.outDir, "knowledge-delta", `${from.version}-to-${to.version}`),
          );
        }
      }

      fs.writeFileSync(path.join(input.outDir, "checksums.txt"), formatChecksumsFile(planAssets));
      const plan: ReleasePlan = {
        releaseVersion: input.releaseVersion,
        tag: releaseTag(input.releaseVersion),
        createdAt: new Date().toISOString(),
        assets: planAssets,
      };
      fs.writeFileSync(path.join(input.outDir, "release-manifest.json"), JSON.stringify(plan, null, 2) + "\n");

      return { ok: true, plan, modelPackResults, knowledgeDeltaResult };
    } finally {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}
