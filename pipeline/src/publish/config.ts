/**
 * APP-029 (issue #141): normalizes the CLI's `--config` JSON file into
 * `buildReleasePlan`'s real input shape. Plain JSON can't represent a
 * `Map`, so a config file's `textEmbeddings`/`imageEmbeddings.records`
 * are written as a JSON-friendly array of `{chunkId|printingId, vector}`
 * records; this module converts that array into the `Map` the
 * knowledge-pack builder actually consumes. `SnapshotForDelta` (used by
 * `knowledgeDelta`) carries no embeddings at all — only chunks, printing
 * ids, and embedder VERSION strings — so it needs no conversion and
 * passes through untouched.
 */
import type { BuildReleasePlanInput } from "./types.js";

type DryRunConfigInput = Omit<BuildReleasePlanInput, "releaseVersion" | "outDir">;

interface JsonEmbeddingRecord {
  [key: string]: unknown;
}

interface JsonEmbeddingsProvided {
  provided: true;
  embedderVersion: string;
  dim: number;
  records: JsonEmbeddingRecord[];
}

interface JsonEmbeddingsAbsent {
  provided: false;
  embedderVersion: string;
  reason: string;
}

type JsonEmbeddings = JsonEmbeddingsProvided | JsonEmbeddingsAbsent;

function toRecordsMap(records: JsonEmbeddingRecord[], key: string): Map<string, JsonEmbeddingRecord> {
  return new Map(records.map((r) => [r[key] as string, r]));
}

function normalizeEmbeddings(raw: JsonEmbeddings, key: "chunkId" | "printingId"): unknown {
  if (!raw.provided) return raw;
  return { provided: true, embedderVersion: raw.embedderVersion, dim: raw.dim, records: toRecordsMap(raw.records, key) };
}

export function parseDryRunConfigJson(raw: unknown): DryRunConfigInput {
  const config = raw as DryRunConfigInput & {
    knowledgeFull?: { input: Record<string, unknown> & { textEmbeddings: JsonEmbeddings; imageEmbeddings: JsonEmbeddings } };
  };

  if (!config.knowledgeFull) {
    return config as DryRunConfigInput;
  }

  return {
    ...config,
    knowledgeFull: {
      input: {
        ...config.knowledgeFull.input,
        textEmbeddings: normalizeEmbeddings(config.knowledgeFull.input.textEmbeddings, "chunkId"),
        imageEmbeddings: normalizeEmbeddings(config.knowledgeFull.input.imageEmbeddings, "printingId"),
      },
    },
  } as DryRunConfigInput;
}
