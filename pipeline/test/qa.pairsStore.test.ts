import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { appendPairsDurable, readPairsRecords } from "../src/qa/pairsStore.js";

let tmpDir: string;
let qaPairsPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-qa-pairsstore-test-"));
  qaPairsPath = path.join(tmpDir, "qa-pairs.jsonl");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("appendPairsDurable / readPairsRecords", () => {
  it("creates the file and writes one record on the first write", () => {
    appendPairsDurable(qaPairsPath, {
      chunk_id: "chunk-1",
      pairs: [{ question: "Q?", answer: "A.", cited_chunk_ids: ["chunk-1"] }],
    });
    const records = readPairsRecords(qaPairsPath);
    expect(records).toHaveLength(1);
    expect(records[0].chunk_id).toBe("chunk-1");
    expect(records[0].pairs).toHaveLength(1);
  });

  it("does not throw and returns an empty list when the file doesn't exist yet", () => {
    expect(() => readPairsRecords(qaPairsPath)).not.toThrow();
    expect(readPairsRecords(qaPairsPath)).toEqual([]);
  });

  it("creates parent directories as needed", () => {
    const nested = path.join(tmpDir, "nested", "dir", "qa-pairs.jsonl");
    expect(() =>
      appendPairsDurable(nested, { chunk_id: "chunk-1", pairs: [] }),
    ).not.toThrow();
    expect(fs.existsSync(nested)).toBe(true);
  });

  it("appends a second record for a different chunk", () => {
    appendPairsDurable(qaPairsPath, {
      chunk_id: "chunk-1",
      pairs: [{ question: "Q1?", answer: "A1.", cited_chunk_ids: ["chunk-1"] }],
    });
    appendPairsDurable(qaPairsPath, {
      chunk_id: "chunk-2",
      pairs: [{ question: "Q2?", answer: "A2.", cited_chunk_ids: ["chunk-2"] }],
    });
    const records = readPairsRecords(qaPairsPath);
    expect(records.map((r) => r.chunk_id).sort()).toEqual(["chunk-1", "chunk-2"]);
  });

  it("deduplicates: writing the same chunk_id again replaces the earlier record instead of duplicating it", () => {
    appendPairsDurable(qaPairsPath, {
      chunk_id: "chunk-1",
      pairs: [{ question: "Stale Q", answer: "Stale A", cited_chunk_ids: ["chunk-1"] }],
    });
    appendPairsDurable(qaPairsPath, {
      chunk_id: "chunk-2",
      pairs: [{ question: "Q2", answer: "A2", cited_chunk_ids: ["chunk-2"] }],
    });
    appendPairsDurable(qaPairsPath, {
      chunk_id: "chunk-1",
      pairs: [{ question: "Fresh Q", answer: "Fresh A", cited_chunk_ids: ["chunk-1"] }],
    });

    const records = readPairsRecords(qaPairsPath);
    expect(records).toHaveLength(2); // one per chunk_id, never duplicated
    const chunk1 = records.find((r) => r.chunk_id === "chunk-1")!;
    expect(chunk1.pairs[0].question).toBe("Fresh Q"); // latest generation wins
  });

  it("preserves other chunks' records untouched when deduping one chunk_id", () => {
    appendPairsDurable(qaPairsPath, {
      chunk_id: "chunk-a",
      pairs: [{ question: "QA", answer: "AA", cited_chunk_ids: ["chunk-a"] }],
    });
    appendPairsDurable(qaPairsPath, {
      chunk_id: "chunk-b",
      pairs: [{ question: "QB", answer: "AB", cited_chunk_ids: ["chunk-b"] }],
    });
    appendPairsDurable(qaPairsPath, {
      chunk_id: "chunk-a",
      pairs: [{ question: "QA2", answer: "AA2", cited_chunk_ids: ["chunk-a"] }],
    });

    const records = readPairsRecords(qaPairsPath);
    expect(records.map((r) => r.chunk_id).sort()).toEqual(["chunk-a", "chunk-b"]);
    const chunkB = records.find((r) => r.chunk_id === "chunk-b")!;
    expect(chunkB.pairs[0].question).toBe("QB");
  });
});
