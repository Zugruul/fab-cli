/**
 * APP-085 (SPEC-APP.md §8.8; issue #142): top-level full-pack build
 * orchestration — wires buildPrintingRegistry + buildKnowledgePackManifest
 * together, then writes `manifest.json` (the exact, schema-valid
 * artifact) and `report.json` (the richer, honest build record — embedder
 * absence + reason, registry counts — that doesn't fit
 * KnowledgePackManifestSchema's fixed shape but still needs to be visible
 * to a human or a later pipeline stage) into the pack's output directory.
 *
 * Kept as a pure-ish function over already-loaded data (chunks array,
 * printingIds array, parsed embeddings/calibration) rather than reading
 * files itself — file I/O (reading pipeline/out/chunks.jsonl, the
 * corpus manifest, the-fab-cube's card.json, etc.) lives in cli.ts, same
 * split as the rest of this pipeline's assemble.ts-vs-cli.ts modules.
 */
import fs from "node:fs";
import path from "node:path";
import type { KnowledgePackManifest } from "@fab/manifest-schema";
import type { CalibrationArtifact } from "../eval/calibration.js";
import { buildPrintingRegistry } from "./printingRegistry.js";
import { buildKnowledgePackManifest, type WrittenIndexFile } from "./manifestBuilder.js";
import type { Chunk, ImageEmbeddingsResult, PrintingRegistry, TextEmbeddingsResult } from "./types.js";
import type { SnapshotForDelta } from "./deltaPack.js";

export interface BuildFullPackInput {
  version: string;
  corpusSnapshotHash: string;
  chunks: Chunk[];
  printingIds: string[];
  previousRegistry: PrintingRegistry | null;
  registryVersion: string;
  textEmbeddings: TextEmbeddingsResult;
  imageEmbeddings: ImageEmbeddingsResult;
  calibration: CalibrationArtifact;
  outDir: string;
}

export interface BuildFullPackResult {
  manifest: KnowledgePackManifest;
  registry: PrintingRegistry;
  writtenFiles: WrittenIndexFile[];
}

/** The richer, non-schema-constrained build record (see doc comment
 * above) — always honest about embedder absence, never squeezed into
 * KnowledgePackManifestSchema's fixed fields. */
export interface KnowledgePackBuildReport {
  version: string;
  textEmbeddings: { provided: boolean; embedderVersion: string; reason: string | null; chunkCount: number | null };
  imageEmbeddings: { provided: boolean; embedderVersion: string; reason: string | null; printingCount: number | null };
  registry: { total: number; alive: number; dead: number };
}

function buildReport(input: BuildFullPackInput, registry: PrintingRegistry): KnowledgePackBuildReport {
  return {
    version: input.version,
    textEmbeddings: {
      provided: input.textEmbeddings.provided,
      embedderVersion: input.textEmbeddings.embedderVersion,
      reason: input.textEmbeddings.provided ? null : input.textEmbeddings.reason,
      chunkCount: input.textEmbeddings.provided ? input.textEmbeddings.records.size : null,
    },
    imageEmbeddings: {
      provided: input.imageEmbeddings.provided,
      embedderVersion: input.imageEmbeddings.embedderVersion,
      reason: input.imageEmbeddings.provided ? null : input.imageEmbeddings.reason,
      printingCount: input.imageEmbeddings.provided ? input.imageEmbeddings.records.size : null,
    },
    registry: {
      total: registry.entries.length,
      alive: registry.entries.filter((e) => !e.dead).length,
      dead: registry.entries.filter((e) => e.dead).length,
    },
  };
}

export function buildFullPack(input: BuildFullPackInput): BuildFullPackResult {
  const registry = buildPrintingRegistry(input.printingIds, input.previousRegistry, input.registryVersion);

  const { manifest, writtenFiles } = buildKnowledgePackManifest({
    version: input.version,
    corpusSnapshotHash: input.corpusSnapshotHash,
    chunks: input.chunks,
    textEmbeddings: input.textEmbeddings,
    imageEmbeddings: input.imageEmbeddings,
    printingRegistry: registry,
    calibration: input.calibration,
    outDir: input.outDir,
  });

  fs.mkdirSync(input.outDir, { recursive: true });
  fs.writeFileSync(path.join(input.outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(
    path.join(input.outDir, "report.json"),
    JSON.stringify(buildReport(input, registry), null, 2) + "\n",
  );

  return { manifest, registry, writtenFiles };
}

/**
 * Reads back a full pack this module wrote (manifest.json,
 * chunks-index.jsonl, printing-registry.json) as a `SnapshotForDelta` —
 * the shape buildDeltaPack expects. This is how the CLI's `delta` mode
 * and this module's own round-trip tests get their two snapshots without
 * re-deriving them from the original corpus/printing-id inputs.
 */
export function loadSnapshotFromPackDir(dir: string): SnapshotForDelta {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) as KnowledgePackManifest;

  const chunks: Chunk[] = fs
    .readFileSync(path.join(dir, "chunks-index.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Chunk);

  const registry = JSON.parse(fs.readFileSync(path.join(dir, "printing-registry.json"), "utf8")) as PrintingRegistry;
  const printingIds = registry.entries.filter((e) => !e.dead).map((e) => e.printingId);

  return {
    version: manifest.version,
    chunks,
    printingIds,
    textEmbedderVersion: manifest.textEmbedderVersion,
    visionEmbedderVersion: manifest.visionEmbedderVersion,
  };
}
