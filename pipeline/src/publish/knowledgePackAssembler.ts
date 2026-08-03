/**
 * APP-029 (SPEC-APP.md §8.9; issue #141): wraps APP-085's knowledge-pack
 * builder (pipeline/src/knowledge/build.ts + deltaPack.ts) into publish
 * bundles. Deliberately thin — it reuses buildFullPack/buildDeltaPack
 * verbatim rather than reimplementing any of their logic, per the task
 * brief ("reuse pipeline/src/knowledge/, don't reimplement"). Its only two
 * jobs:
 *   1. turn a full-pack build's real written files into a flat asset list
 *      (never re-deriving hashes — buildKnowledgePackManifest already
 *      computed them for every file it wrote);
 *   2. surface buildDeltaPack's refusal decision as a typed, non-throwing
 *      result rather than swallowing it into a generic assembly failure —
 *      the delta-equivalence-with-deletion and embedder-refusal properties
 *      THEMSELVES are already covered by knowledge.build.test.ts /
 *      knowledge.deltaPack.test.ts and are not re-tested here.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { validateDeltaPackManifest, type DeltaPackManifest, type KnowledgePackManifest } from "@fab/manifest-schema";
import { buildFullPack, type BuildFullPackInput } from "../knowledge/build.js";
import { buildDeltaPack, type SnapshotForDelta } from "../knowledge/deltaPack.js";
import type { PublishBundle } from "./types.js";

function sha256File(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function assembleKnowledgeFullPack(input: BuildFullPackInput): { manifest: KnowledgePackManifest; bundle: PublishBundle } {
  // buildFullPack throws directly on real builder-level refusals (e.g. a
  // calibration artifact computed for the wrong embedder version, or
  // partial text-embedding coverage) — deliberately NOT caught here, so
  // that refusal propagates to the caller unchanged rather than being
  // reworded into a different, assembly-layer error.
  const { manifest, writtenFiles } = buildFullPack(input);

  const manifestPath = path.join(input.outDir, "manifest.json");
  const bundle: PublishBundle = {
    kind: "knowledge-full",
    label: input.version,
    assets: [
      ...writtenFiles.map((f) => ({ assetName: f.name, localPath: f.path, sha256: f.sha256, sizeBytes: f.sizeBytes })),
      { assetName: "manifest.json", localPath: manifestPath, sha256: sha256File(manifestPath), sizeBytes: fs.statSync(manifestPath).size },
    ],
  };

  return { manifest, bundle };
}

export type AssembleKnowledgeDeltaResult =
  | { status: "refused"; reason: string; changedEmbedders: ("text" | "vision")[] }
  | { status: "ok"; manifest: DeltaPackManifest; bundle: PublishBundle };

export function assembleKnowledgeDeltaPack(from: SnapshotForDelta, to: SnapshotForDelta, outDir: string): AssembleKnowledgeDeltaResult {
  const result = buildDeltaPack(from, to);
  if (result.refused) {
    // Surfaced verbatim, not swallowed — buildDeltaPack's `reason` already
    // names the changed embedder(s) per SPEC-APP.md §8.8.
    return { status: "refused", reason: result.reason, changedEmbedders: result.changedEmbedders };
  }

  const validation = validateDeltaPackManifest(result.manifest);
  if (!validation.success) {
    throw new Error(`assembleKnowledgeDeltaPack: assembled manifest failed schema validation: ${JSON.stringify(validation.errors)}`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const manifestPath = path.join(outDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(validation.data, null, 2) + "\n");

  const bundle: PublishBundle = {
    kind: "knowledge-delta",
    label: `${validation.data.fromVersion}-to-${validation.data.toVersion}`,
    assets: [{ assetName: "manifest.json", localPath: manifestPath, sha256: sha256File(manifestPath), sizeBytes: fs.statSync(manifestPath).size }],
  };

  return { status: "ok", manifest: validation.data, bundle };
}
