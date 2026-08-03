/**
 * APP-029 (SPEC-APP.md §8.9; issue #141): assembles a real, schema-valid
 * ModelPackManifest from an artifact-map input. Every artifact's sha256/
 * sizeBytes is computed from the REAL file bytes on disk (never trusted
 * from a caller-supplied or producer-recorded checksum — the manifest that
 * ships is the manifest that matches what's actually on disk). A missing
 * required slot fails loudly, listing every missing slot at once (not just
 * the first), and never writes partial output.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { validateModelPackManifest, type ModelPackArtifact, type ModelPackManifest } from "@fab/manifest-schema";
import type { AssembleModelPackInput, ModelPackArtifactSlot, PublishBundle } from "./types.js";

const SCHEMA_VERSION = "0.1.0";

/** Logical artifact name + assembly order — fixed so a model pack's
 * artifacts[] is always in the same order regardless of input object key
 * order (JS doesn't guarantee that, and a stable order makes manifest
 * diffs across releases meaningful). */
const SLOTS: { slot: ModelPackArtifactSlot; artifactName: string }[] = [
  { slot: "mergedGguf", artifactName: "merged-llm" },
  { slot: "textEmbedderGguf", artifactName: "text-embedder" },
  { slot: "detectorTflite", artifactName: "detector" },
  { slot: "visionEmbedderTflite", artifactName: "vision-embedder" },
];

export class MissingArtifactsError extends Error {
  constructor(
    public readonly tier: string,
    public readonly missing: ModelPackArtifactSlot[],
  ) {
    super(
      `model pack assembly for tier "${tier}" refused: missing required artifact(s): ${missing.join(", ")} — ` +
        "the assembler never fabricates a stand-in file; supply a real artifact for each missing slot, " +
        "or omit this tier from the publish run (partial-tier publishing is supported at the release-plan level).",
    );
    this.name = "MissingArtifactsError";
  }
}

function sha256File(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function assembleModelPack(input: AssembleModelPackInput): { manifest: ModelPackManifest; bundle: PublishBundle } {
  const missing = SLOTS.map((s) => s.slot).filter((slot) => input.artifacts[slot] == null);
  if (missing.length > 0) {
    throw new MissingArtifactsError(input.tier, missing);
  }

  const artifacts: ModelPackArtifact[] = SLOTS.map(({ slot, artifactName }) => {
    const resolved = input.artifacts[slot]!;
    if (!fs.existsSync(resolved.path)) {
      throw new Error(
        `assembleModelPack: artifact "${slot}" (tier "${input.tier}") points at a file that does not exist on disk: ` +
          `${resolved.path} — never fabricated`,
      );
    }
    return {
      name: artifactName,
      file: path.basename(resolved.path),
      sha256: sha256File(resolved.path),
      sizeBytes: fs.statSync(resolved.path).size,
      licenseId: resolved.licenseId,
      version: resolved.version,
    };
  });

  const manifest: ModelPackManifest = {
    schemaVersion: SCHEMA_VERSION,
    tier: input.tier,
    artifacts,
    baseModelHash: input.baseModelHash,
    textEmbedderVersion: input.textEmbedderVersion,
    visionEmbedderVersion: input.visionEmbedderVersion,
    detectorVersion: input.detectorVersion,
    compatibleKnowledgePacks: input.compatibleKnowledgePacks,
    appMinVersion: input.appMinVersion,
    corpusSnapshotHash: input.corpusSnapshotHash,
    evalScores: input.evalScores,
  };

  const validation = validateModelPackManifest(manifest);
  if (!validation.success) {
    throw new Error(`assembleModelPack: assembled manifest failed schema validation: ${JSON.stringify(validation.errors)}`);
  }

  fs.mkdirSync(input.outDir, { recursive: true });
  const manifestPath = path.join(input.outDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(validation.data, null, 2) + "\n");

  const bundle: PublishBundle = {
    kind: "model-pack",
    label: input.tier,
    assets: [
      ...SLOTS.map(({ slot }, i) => ({
        assetName: artifacts[i].file, // releaseLayout.ts prefixes this at plan-assembly time
        localPath: input.artifacts[slot]!.path,
        sha256: artifacts[i].sha256,
        sizeBytes: artifacts[i].sizeBytes,
      })),
      {
        assetName: "manifest.json",
        localPath: manifestPath,
        sha256: sha256File(manifestPath),
        sizeBytes: fs.statSync(manifestPath).size,
      },
    ],
  };

  return { manifest: validation.data, bundle };
}
