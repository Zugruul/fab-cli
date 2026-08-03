/**
 * APP-085 (SPEC-APP.md §8.8, §8.7d; issue #142): the documented
 * printing-image embeddings input contract — mirrors
 * textEmbeddingsInput.ts, keyed by printingId instead of chunkId.
 *
 * Unlike the text embedder, a real image/recognition embedder training
 * chain DOES exist in this repo (APP-028, pipeline/src/train-vision/
 * embedRunner.ts) — but it trains at real scale under a QA gate
 * (real-photo benchmark top-1 >=95%, SPEC-APP.md §8.7d) that has not
 * passed yet (embedRunner.ts's buildManifest records
 * `realPhotoBenchmarkTop1: null` with an explicit QA-gated reason). So
 * "no image embeddings yet" is today's honest, expected state here too —
 * this module records that absence + reason rather than fabricating
 * vectors, exactly like its text counterpart.
 */
import fs from "node:fs";
import type { ImageEmbeddingsResult, ImageEmbeddingRecord } from "./types.js";

/** Sentinel `visionEmbedderVersion` pinned into the pack manifest when no
 * image embeddings were provided. */
export const NO_VISION_EMBEDDER_VERSION = "unset";

export const IMAGE_EMBEDDINGS_NOT_PROVIDED_REASON =
  "no image-embeddings input file provided — APP-028's recognition embedder has not passed its real-photo-" +
  "benchmark QA gate (>=95% top-1, SPEC-APP.md §8.7d) yet, so no production-scale image vectors exist. The " +
  "pack builder never fabricates vectors. Supply --image-embeddings pointing at a JSONL file of " +
  "{printingId, embedderVersion, vector} records once that gate passes.";

interface RawRecord {
  printingId?: unknown;
  embedderVersion?: unknown;
  vector?: unknown;
}

export function loadImageEmbeddingsInput(filePath: string | null): ImageEmbeddingsResult {
  if (filePath === null) {
    return { provided: false, embedderVersion: NO_VISION_EMBEDDER_VERSION, reason: IMAGE_EMBEDDINGS_NOT_PROVIDED_REASON };
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `loadImageEmbeddingsInput: image-embeddings file not found at ${filePath} — re-run the embedding stage, ` +
        `or pass no --image-embeddings flag to build without image embeddings`,
    );
  }

  const lines = fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    throw new Error(`loadImageEmbeddingsInput: ${filePath} exists but contains zero records`);
  }

  const records = new Map<string, ImageEmbeddingRecord>();
  let embedderVersion: string | null = null;
  let dim: number | null = null;

  lines.forEach((line, i) => {
    const raw = JSON.parse(line) as RawRecord;
    const lineNo = i + 1;

    if (typeof raw.printingId !== "string" || raw.printingId.length === 0) {
      throw new Error(`loadImageEmbeddingsInput: ${filePath} line ${lineNo} is missing a string printingId`);
    }
    if (typeof raw.embedderVersion !== "string" || raw.embedderVersion.length === 0) {
      throw new Error(`loadImageEmbeddingsInput: ${filePath} line ${lineNo} is missing a string embedderVersion`);
    }
    if (!Array.isArray(raw.vector) || raw.vector.length === 0 || !raw.vector.every((v) => typeof v === "number")) {
      throw new Error(`loadImageEmbeddingsInput: ${filePath} line ${lineNo} has an invalid vector (expected a non-empty number[])`);
    }

    if (embedderVersion === null) {
      embedderVersion = raw.embedderVersion;
    } else if (embedderVersion !== raw.embedderVersion) {
      throw new Error(
        `loadImageEmbeddingsInput: ${filePath} mixes embedderVersion "${embedderVersion}" and "${raw.embedderVersion}" — ` +
          `a single file must pin exactly one embedder version`,
      );
    }

    if (dim === null) {
      dim = raw.vector.length;
    } else if (dim !== raw.vector.length) {
      throw new Error(`loadImageEmbeddingsInput: ${filePath} mixes vector dimensions ${dim} and ${raw.vector.length}`);
    }

    if (records.has(raw.printingId)) {
      throw new Error(`loadImageEmbeddingsInput: ${filePath} has duplicate printingId "${raw.printingId}"`);
    }
    records.set(raw.printingId, { printingId: raw.printingId, vector: raw.vector as number[] });
  });

  return { provided: true, embedderVersion: embedderVersion!, records, dim: dim! };
}
