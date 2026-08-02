import fs from "node:fs";
import path from "node:path";
import type { QAPair } from "./types.js";

export interface PairsRecord {
  chunk_id: string;
  pairs: QAPair[];
}

function readExistingRecords(qaPairsPath: string): PairsRecord[] {
  let raw: string;
  try {
    raw = fs.readFileSync(qaPairsPath, "utf8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as PairsRecord);
}

/**
 * Durably (synchronously) persists one chunk's accepted pairs, deduping by
 * chunk_id so a chunk reprocessed after a crash — see runner.ts, which
 * awaits the caller's persistence callback BEFORE marking a chunk done —
 * never ends up with two entries for the same chunk_id: the newest
 * generation replaces the old one via a full-file rewrite rather than a
 * plain append, which is also what keeps this correct even if the earlier
 * write only ever got partially durable pairs recorded, not the run's
 * "done" state.
 */
export function appendPairsDurable(qaPairsPath: string, record: PairsRecord): void {
  const existing = readExistingRecords(qaPairsPath).filter((r) => r.chunk_id !== record.chunk_id);
  existing.push(record);
  fs.mkdirSync(path.dirname(qaPairsPath), { recursive: true });
  fs.writeFileSync(qaPairsPath, existing.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

export function readPairsRecords(qaPairsPath: string): PairsRecord[] {
  return readExistingRecords(qaPairsPath);
}
