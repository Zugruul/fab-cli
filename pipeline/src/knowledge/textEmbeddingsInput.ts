/**
 * APP-085 (SPEC-APP.md §8.8; issue #142): the documented text-chunk
 * embeddings input contract.
 *
 * SPEC-APP.md §5 names bge-small-en-v1.5 as the default text embedder, but
 * this repo has no runnable local text-embedder training/export chain
 * today (unlike the vision embedder's APP-028 pipeline under
 * pipeline/src/train-vision/) — the only training work that exists is the
 * SLM itself (APP-020/021). So the knowledge-pack builder never runs an
 * embedder; it consumes a JSONL file produced by whatever out-of-repo
 * process embedded the corpus's chunks, one record per line:
 *
 *   {"chunkId": "brain/judge/...", "embedderVersion": "text-embed-v1", "vector": [0.1, 0.2, ...]}
 *
 * Every record in the file must share the SAME embedderVersion and vector
 * length — a file mixing either is refused outright (ambiguous which is
 * authoritative for the pack being built). `filePath === null` is the
 * expected, first-class "no embedder run yet" state, never treated as an
 * error; a NON-null path that doesn't resolve to a real file IS an error
 * (a broken/mistyped upstream stage should fail loud, mirroring
 * dataset/cli.ts's loadChunks convention for a missing required file).
 */
import fs from "node:fs";
import type { TextEmbeddingsResult, TextEmbeddingRecord } from "./types.js";

/** Sentinel `textEmbedderVersion` pinned into the pack manifest when no
 * text embeddings were provided — never a fabricated real-looking
 * version string. */
export const NO_TEXT_EMBEDDER_VERSION = "unembedded";

export const TEXT_EMBEDDINGS_NOT_PROVIDED_REASON =
  "no text-embeddings input file provided — no local text embedder is runnable in this repo yet; " +
  "the pack builder never fabricates vectors. Supply --text-embeddings pointing at a JSONL file of " +
  "{chunkId, embedderVersion, vector} records once an out-of-repo embedder run has produced one.";

interface RawRecord {
  chunkId?: unknown;
  embedderVersion?: unknown;
  vector?: unknown;
}

export function loadTextEmbeddingsInput(filePath: string | null): TextEmbeddingsResult {
  if (filePath === null) {
    return { provided: false, embedderVersion: NO_TEXT_EMBEDDER_VERSION, reason: TEXT_EMBEDDINGS_NOT_PROVIDED_REASON };
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `loadTextEmbeddingsInput: text-embeddings file not found at ${filePath} — re-run the embedding stage, ` +
        `or pass no --text-embeddings flag to build without text embeddings`,
    );
  }

  const lines = fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    throw new Error(`loadTextEmbeddingsInput: ${filePath} exists but contains zero records`);
  }

  const records = new Map<string, TextEmbeddingRecord>();
  let embedderVersion: string | null = null;
  let dim: number | null = null;

  lines.forEach((line, i) => {
    const raw = JSON.parse(line) as RawRecord;
    const lineNo = i + 1;

    if (typeof raw.chunkId !== "string" || raw.chunkId.length === 0) {
      throw new Error(`loadTextEmbeddingsInput: ${filePath} line ${lineNo} is missing a string chunkId`);
    }
    if (typeof raw.embedderVersion !== "string" || raw.embedderVersion.length === 0) {
      throw new Error(`loadTextEmbeddingsInput: ${filePath} line ${lineNo} is missing a string embedderVersion`);
    }
    if (!Array.isArray(raw.vector) || raw.vector.length === 0 || !raw.vector.every((v) => typeof v === "number")) {
      throw new Error(`loadTextEmbeddingsInput: ${filePath} line ${lineNo} has an invalid vector (expected a non-empty number[])`);
    }

    if (embedderVersion === null) {
      embedderVersion = raw.embedderVersion;
    } else if (embedderVersion !== raw.embedderVersion) {
      throw new Error(
        `loadTextEmbeddingsInput: ${filePath} mixes embedderVersion "${embedderVersion}" and "${raw.embedderVersion}" — ` +
          `a single file must pin exactly one embedder version`,
      );
    }

    if (dim === null) {
      dim = raw.vector.length;
    } else if (dim !== raw.vector.length) {
      throw new Error(`loadTextEmbeddingsInput: ${filePath} mixes vector dimensions ${dim} and ${raw.vector.length}`);
    }

    if (records.has(raw.chunkId)) {
      throw new Error(`loadTextEmbeddingsInput: ${filePath} has duplicate chunkId "${raw.chunkId}"`);
    }
    records.set(raw.chunkId, { chunkId: raw.chunkId, vector: raw.vector as number[] });
  });

  return { provided: true, embedderVersion: embedderVersion!, records, dim: dim! };
}
