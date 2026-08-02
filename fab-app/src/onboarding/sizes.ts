import type { ModelPackManifest } from "@fab/manifest-schema";
import type { ArtifactSizes, KnowledgePackSizeInfo } from "./types";

/** Sums the model pack manifest's per-artifact sizeBytes (§9.9 "sizes shown
 * ... from the manifests: model pack per tier") — the one manifest that
 * actually carries byte sizes (ModelPackArtifactSchema.sizeBytes); see
 * KnowledgePackSizeInfo's doc comment in ./types for why the knowledge pack
 * side is supplied separately instead of read off its manifest. */
export function deriveModelPackSizeBytes(modelPack: ModelPackManifest): number {
  return modelPack.artifacts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0);
}

export function deriveArtifactSizes(
  modelPack: ModelPackManifest,
  knowledgePack: KnowledgePackSizeInfo,
): ArtifactSizes {
  const modelPackBytes = deriveModelPackSizeBytes(modelPack);
  const knowledgePackBytes = knowledgePack.sizeBytes;
  return {
    modelPackBytes,
    knowledgePackBytes,
    totalBytes: modelPackBytes + knowledgePackBytes,
  };
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** Human-readable size for consent-screen display (e.g. "1.7 GB"). Decimal
 * (1000-based) scaling, matching how app stores usually quote download
 * sizes rather than binary GiB. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";

  let value = bytes;
  let unitIndex = 0;
  while (value >= 1000 && unitIndex < UNITS.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }

  const rounded = unitIndex === 0 ? String(value) : value < 10 ? value.toFixed(1) : String(Math.round(value));
  return `${rounded} ${UNITS[unitIndex]}`;
}
