import fs from "node:fs";
import path from "node:path";
import type { QAPair, RejectionKind } from "./types.js";

export interface SampledRecord {
  pairId: string;
  chunk_id: string;
  question: string;
  answer: string;
  cited_chunk_ids: string[];
  /** Present (non-null) only on rejected records — see types.ts's
   * RejectionKind. Lets anyone reading rejected.jsonl distinguish a
   * genuine content-quality rejection from infra noise without
   * cross-referencing manifest.json. */
  rejectionKind: RejectionKind | null;
  reason: string;
}

function toRecord(
  pairId: string,
  chunk_id: string,
  pair: QAPair,
  rejectionKind: RejectionKind | null,
  reason: string,
): SampledRecord {
  return {
    pairId,
    chunk_id,
    question: pair.question,
    answer: pair.answer,
    cited_chunk_ids: pair.cited_chunk_ids,
    rejectionKind,
    reason,
  };
}

function readExistingRecords(filePath: string): SampledRecord[] {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as SampledRecord);
}

/**
 * Durably (synchronously) persists one pair's outcome record, deduping by
 * pairId so a pair reprocessed after a crash — see sampler.ts, which
 * awaits the caller's persistence callback BEFORE marking a pair done —
 * never ends up with two entries for the same pairId: the newest check
 * replaces the old one via a full-file rewrite rather than a plain append.
 * Mirrors qa/pairsStore.ts's appendPairsDurable, applied per-pair instead
 * of per-chunk (see dev/data-before-marker-durability house note).
 */
function appendRecordDurable(filePath: string, record: SampledRecord): void {
  const existing = readExistingRecords(filePath).filter((r) => r.pairId !== record.pairId);
  existing.push(record);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, existing.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

export function appendAcceptedDurable(
  acceptedPath: string,
  pairId: string,
  chunk_id: string,
  pair: QAPair,
  reason: string,
): void {
  appendRecordDurable(acceptedPath, toRecord(pairId, chunk_id, pair, null, reason));
}

export function appendRejectedDurable(
  rejectedPath: string,
  pairId: string,
  chunk_id: string,
  pair: QAPair,
  rejectionKind: RejectionKind,
  reason: string,
): void {
  appendRecordDurable(rejectedPath, toRecord(pairId, chunk_id, pair, rejectionKind, reason));
}

export function readAcceptedRecords(acceptedPath: string): SampledRecord[] {
  return readExistingRecords(acceptedPath);
}

export function readRejectedRecords(rejectedPath: string): SampledRecord[] {
  return readExistingRecords(rejectedPath);
}
