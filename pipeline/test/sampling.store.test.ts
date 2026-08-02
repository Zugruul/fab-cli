import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { appendAcceptedDurable, appendRejectedDurable, readAcceptedRecords, readRejectedRecords } from "../src/sampling/store.js";
import { makePair } from "./sampling.helpers.js";

let tmpDir: string;
let acceptedPath: string;
let rejectedPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-sampling-store-test-"));
  acceptedPath = path.join(tmpDir, "accepted.jsonl");
  rejectedPath = path.join(tmpDir, "rejected.jsonl");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("appendAcceptedDurable / readAcceptedRecords", () => {
  it("creates the file and writes one record on the first write", () => {
    appendAcceptedDurable(acceptedPath, "chunk-1#0", "chunk-1", makePair(), "fully supported");
    const records = readAcceptedRecords(acceptedPath);
    expect(records).toHaveLength(1);
    expect(records[0].pairId).toBe("chunk-1#0");
    expect(records[0].chunk_id).toBe("chunk-1");
    expect(records[0].reason).toBe("fully supported");
  });

  it("does not throw and returns an empty list when the file doesn't exist yet", () => {
    expect(() => readAcceptedRecords(acceptedPath)).not.toThrow();
    expect(readAcceptedRecords(acceptedPath)).toEqual([]);
  });

  it("creates parent directories as needed", () => {
    const nested = path.join(tmpDir, "nested", "dir", "accepted.jsonl");
    expect(() => appendAcceptedDurable(nested, "chunk-1#0", "chunk-1", makePair(), "ok")).not.toThrow();
    expect(fs.existsSync(nested)).toBe(true);
  });

  it("deduplicates: writing the same pairId again replaces the earlier record instead of duplicating it", () => {
    appendAcceptedDurable(acceptedPath, "chunk-1#0", "chunk-1", makePair({ answer: "Stale answer" }), "stale reason");
    appendAcceptedDurable(acceptedPath, "chunk-2#0", "chunk-2", makePair(), "unrelated");
    appendAcceptedDurable(acceptedPath, "chunk-1#0", "chunk-1", makePair({ answer: "Fresh answer" }), "fresh reason");

    const records = readAcceptedRecords(acceptedPath);
    expect(records).toHaveLength(2); // one per pairId, never duplicated
    const chunk1 = records.find((r) => r.pairId === "chunk-1#0")!;
    expect(chunk1.answer).toBe("Fresh answer"); // latest check wins
    expect(chunk1.reason).toBe("fresh reason");
  });

  it("preserves other pairs' records untouched when deduping one pairId", () => {
    appendAcceptedDurable(acceptedPath, "chunk-a#0", "chunk-a", makePair({ question: "QA" }), "r1");
    appendAcceptedDurable(acceptedPath, "chunk-b#0", "chunk-b", makePair({ question: "QB" }), "r2");
    appendAcceptedDurable(acceptedPath, "chunk-a#0", "chunk-a", makePair({ question: "QA2" }), "r3");

    const records = readAcceptedRecords(acceptedPath);
    expect(records.map((r) => r.pairId).sort()).toEqual(["chunk-a#0", "chunk-b#0"]);
    const chunkB = records.find((r) => r.pairId === "chunk-b#0")!;
    expect(chunkB.question).toBe("QB");
  });
});

describe("appendRejectedDurable / readRejectedRecords", () => {
  it("writes a rejected record with its reason, independent of the accepted store", () => {
    appendRejectedDurable(rejectedPath, "chunk-1#1", "chunk-1", makePair(), "not entailed: adds an outside fact");
    const records = readRejectedRecords(rejectedPath);
    expect(records).toHaveLength(1);
    expect(records[0].reason).toBe("not entailed: adds an outside fact");
    expect(fs.existsSync(acceptedPath)).toBe(false);
  });

  it("multiple pairs from the same chunk get distinct records via distinct pairIds", () => {
    appendRejectedDurable(rejectedPath, "chunk-1#0", "chunk-1", makePair({ question: "Q0" }), "r0");
    appendRejectedDurable(rejectedPath, "chunk-1#1", "chunk-1", makePair({ question: "Q1" }), "r1");
    const records = readRejectedRecords(rejectedPath);
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.pairId).sort()).toEqual(["chunk-1#0", "chunk-1#1"]);
  });
});
