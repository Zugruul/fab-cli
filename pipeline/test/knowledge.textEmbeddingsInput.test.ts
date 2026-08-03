// APP-085 (SPEC-APP.md §8.8, issue #142): text-chunk embeddings are
// embedder-version-pinned and NEVER fabricated. No local text embedder is
// runnable in this repo (bge-small-en-v1.5 per SPEC-APP.md §5 has no
// training/export chain here, unlike the vision embedder's APP-028
// pipeline) — so the knowledge-pack builder consumes a documented input
// contract: a JSONL file of `{chunkId, embedderVersion, vector}` records,
// produced by whatever out-of-repo process ran the embedder. This file
// covers loadTextEmbeddingsInput's contract in isolation.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  loadTextEmbeddingsInput,
  NO_TEXT_EMBEDDER_VERSION,
} from "../src/knowledge/textEmbeddingsInput.js";

function line(rec: unknown): string {
  return JSON.stringify(rec);
}

describe("loadTextEmbeddingsInput", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-knowledge-text-embed-test-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns {provided: false} with an honest reason and a sentinel version when no path is given (no local embedder exists yet)", () => {
    const result = loadTextEmbeddingsInput(null);
    expect(result.provided).toBe(false);
    if (result.provided) throw new Error("unreachable");
    expect(result.embedderVersion).toBe(NO_TEXT_EMBEDDER_VERSION);
    expect(result.reason.length).toBeGreaterThan(0);
    expect(result.reason).not.toMatch(/^\s*$/);
  });

  it("loads a valid JSONL file: one embedderVersion, consistent vector dim, all records present", () => {
    const filePath = path.join(tmpDir, "text-embeddings.jsonl");
    fs.writeFileSync(
      filePath,
      [
        line({ chunkId: "brain/judge/a", embedderVersion: "text-embed-v1", vector: [0.1, 0.2, 0.3] }),
        line({ chunkId: "brain/judge/b", embedderVersion: "text-embed-v1", vector: [0.4, 0.5, 0.6] }),
      ].join("\n") + "\n",
    );
    const result = loadTextEmbeddingsInput(filePath);
    expect(result.provided).toBe(true);
    if (!result.provided) throw new Error("unreachable");
    expect(result.embedderVersion).toBe("text-embed-v1");
    expect(result.dim).toBe(3);
    expect(result.records.size).toBe(2);
    expect(result.records.get("brain/judge/a")?.vector).toEqual([0.1, 0.2, 0.3]);
  });

  it("throws loudly when a non-null path does not exist (a broken/mistyped upstream stage, not a silent degrade)", () => {
    const missing = path.join(tmpDir, "does-not-exist.jsonl");
    expect(() => loadTextEmbeddingsInput(missing)).toThrow(/does-not-exist\.jsonl/);
  });

  it("throws on an empty (zero-record) file rather than silently returning provided:false", () => {
    const filePath = path.join(tmpDir, "empty.jsonl");
    fs.writeFileSync(filePath, "");
    expect(() => loadTextEmbeddingsInput(filePath)).toThrow(/zero records/);
  });

  it("throws when records mix embedder versions (ambiguous which is authoritative)", () => {
    const filePath = path.join(tmpDir, "mixed-version.jsonl");
    fs.writeFileSync(
      filePath,
      [
        line({ chunkId: "a", embedderVersion: "text-embed-v1", vector: [0.1, 0.2] }),
        line({ chunkId: "b", embedderVersion: "text-embed-v2", vector: [0.1, 0.2] }),
      ].join("\n") + "\n",
    );
    expect(() => loadTextEmbeddingsInput(filePath)).toThrow(/embedderVersion/);
  });

  it("throws when records mix vector dimensions", () => {
    const filePath = path.join(tmpDir, "mixed-dim.jsonl");
    fs.writeFileSync(
      filePath,
      [
        line({ chunkId: "a", embedderVersion: "text-embed-v1", vector: [0.1, 0.2] }),
        line({ chunkId: "b", embedderVersion: "text-embed-v1", vector: [0.1, 0.2, 0.3] }),
      ].join("\n") + "\n",
    );
    expect(() => loadTextEmbeddingsInput(filePath)).toThrow(/dimension/);
  });

  it("throws on a duplicate chunkId within the same file", () => {
    const filePath = path.join(tmpDir, "dup.jsonl");
    fs.writeFileSync(
      filePath,
      [
        line({ chunkId: "a", embedderVersion: "text-embed-v1", vector: [0.1] }),
        line({ chunkId: "a", embedderVersion: "text-embed-v1", vector: [0.2] }),
      ].join("\n") + "\n",
    );
    expect(() => loadTextEmbeddingsInput(filePath)).toThrow(/duplicate/i);
  });

  it("throws on a record missing chunkId, embedderVersion, or a valid vector", () => {
    const missingChunkId = path.join(tmpDir, "missing-chunkid.jsonl");
    fs.writeFileSync(missingChunkId, line({ embedderVersion: "v1", vector: [0.1] }) + "\n");
    expect(() => loadTextEmbeddingsInput(missingChunkId)).toThrow(/chunkId/);

    const badVector = path.join(tmpDir, "bad-vector.jsonl");
    fs.writeFileSync(badVector, line({ chunkId: "a", embedderVersion: "v1", vector: "nope" }) + "\n");
    expect(() => loadTextEmbeddingsInput(badVector)).toThrow(/vector/);
  });
});
