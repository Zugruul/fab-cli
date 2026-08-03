/**
 * APP-085 (SPEC-APP.md §8.8, §9.7; issue #142): assembles a real
 * KnowledgePackManifest and writes the index files it describes.
 *
 * Two files intentionally NOT produced here: a real op-sqlite `.sqlite`
 * database and a populated sqlite-vec `vec0` virtual table. Neither the
 * pipeline package nor this task adds a native sqlite dependency — the
 * op-sqlite-backed SqliteVecStore is fab-app's own "thin adapter, lands
 * with device wiring" (SPEC-APP.md §9.7, already the documented boundary
 * for fab-app/src/retrieval's real implementation). Instead this builder
 * writes plain, documented JSONL/JSON files that fully describe the rows
 * a future importer loads into those on-device tables — "sqlite-vec-ready"
 * in the sense of carrying every row needed, not in the sense of already
 * being sqlite bytes. See README.md in this directory for the exact file
 * shapes.
 *
 * retrievalFloor/oodThreshold are threaded straight from an APP-022
 * CalibrationArtifact (pipeline/src/eval/calibration.ts, written to
 * pipeline/eval-runs/calibration/<embedderVersion>.json by `eval
 * calibrate`) — never hardcoded, never defaulted. The calibration
 * artifact's own `embedderVersion` MUST match the text embeddings being
 * packed (a floor calibrated for a different embedder is meaningless for
 * this pack) — checked here as a runtime guard.
 *
 * Boundary convention: if text embeddings ARE provided, they must cover
 * EVERY shipped chunk. Partial coverage is refused rather than silently
 * shipping some chunks with no semantic-search vector at all.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { validateKnowledgePackManifest, type KnowledgePackManifest } from "@fab/manifest-schema";
import type { CalibrationArtifact } from "../eval/calibration.js";
import type { Chunk, ImageEmbeddingsResult, PrintingRegistry, TextEmbeddingsResult } from "./types.js";

const SCHEMA_VERSION = "0.1.0";

export interface BuildManifestInput {
  version: string;
  corpusSnapshotHash: string;
  /** The SHIPPED chunk set (respecting §7.10 shipping modes — e.g. a
   * stub-mode source's text is the stub marker here) — what the pack
   * actually ships for display/citation. Embedding VECTORS are looked up
   * by chunk_id regardless of what text produced them upstream. */
  chunks: Chunk[];
  textEmbeddings: TextEmbeddingsResult;
  imageEmbeddings: ImageEmbeddingsResult;
  printingRegistry: PrintingRegistry;
  calibration: CalibrationArtifact;
  outDir: string;
}

export interface WrittenIndexFile {
  name: string;
  path: string;
  sizeBytes: number;
  sha256: string;
}

export interface BuildManifestResult {
  manifest: KnowledgePackManifest;
  writtenFiles: WrittenIndexFile[];
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function writeIndexFile(outDir: string, name: string, contents: string): WrittenIndexFile {
  fs.mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, name);
  fs.writeFileSync(filePath, contents);
  const bytes = fs.readFileSync(filePath);
  return { name, path: filePath, sizeBytes: bytes.length, sha256: sha256(bytes) };
}

function jsonl(lines: string[]): string {
  return lines.length === 0 ? "" : lines.join("\n") + "\n";
}

export function buildKnowledgePackManifest(input: BuildManifestInput): BuildManifestResult {
  if (input.calibration.embedderVersion !== input.textEmbeddings.embedderVersion) {
    throw new Error(
      `buildKnowledgePackManifest: calibration artifact is calibrated for embedder "${input.calibration.embedderVersion}" ` +
        `but text embeddings are for "${input.textEmbeddings.embedderVersion}" — floors must be calibrated against the ` +
        `exact embedder version being packed (SPEC-APP.md §9.7)`,
    );
  }

  if (input.textEmbeddings.provided) {
    const embeddings = input.textEmbeddings;
    const missing = input.chunks.filter((c) => !embeddings.records.has(c.chunk_id)).map((c) => c.chunk_id);
    if (missing.length > 0) {
      throw new Error(
        `buildKnowledgePackManifest: ${missing.length} chunk(s) have no text embedding (e.g. "${missing[0]}") — ` +
          `embeddings must cover every shipped chunk, or be entirely absent`,
      );
    }
  }

  const chunksFile = writeIndexFile(input.outDir, "chunks-index.jsonl", jsonl(input.chunks.map((c) => JSON.stringify(c))));

  const vectorRows = input.textEmbeddings.provided
    ? input.chunks.map((c) => JSON.stringify({ chunkId: c.chunk_id, vector: input.textEmbeddings.records.get(c.chunk_id)!.vector }))
    : [];
  const vectorsFile = writeIndexFile(input.outDir, "text-vectors.jsonl", jsonl(vectorRows));

  const registryFile = writeIndexFile(
    input.outDir,
    "printing-registry.json",
    JSON.stringify(input.printingRegistry, null, 2) + "\n",
  );

  const indexFiles = [chunksFile, vectorsFile, registryFile];

  if (input.imageEmbeddings.provided) {
    const imageEmbeddings = input.imageEmbeddings;
    const imageVectorRows = [...imageEmbeddings.records.values()].map((r) => JSON.stringify(r));
    indexFiles.push(writeIndexFile(input.outDir, "image-vectors.jsonl", jsonl(imageVectorRows)));
  }

  const manifest: KnowledgePackManifest = {
    schemaVersion: SCHEMA_VERSION,
    version: input.version,
    corpusSnapshotHash: input.corpusSnapshotHash,
    textEmbedderVersion: input.textEmbeddings.embedderVersion,
    visionEmbedderVersion: input.imageEmbeddings.embedderVersion,
    printingRegistryVersion: input.printingRegistry.version,
    retrievalFloor: input.calibration.retrievalFloor,
    oodThreshold: input.calibration.oodThreshold,
    chunkCount: input.chunks.length,
    indexFiles: indexFiles.map(({ name, sha256: hash, sizeBytes }) => ({ name, sha256: hash, sizeBytes })),
  };

  const validation = validateKnowledgePackManifest(manifest);
  if (!validation.success) {
    throw new Error(`buildKnowledgePackManifest: assembled manifest failed schema validation: ${JSON.stringify(validation.errors)}`);
  }

  return { manifest: validation.data, writtenFiles: indexFiles };
}
