// APP-085 (SPEC-APP.md §8.8, §4 Glossary "Knowledge pack"; issue #142):
// image/printing embeddings mirror the text-embeddings contract, but the
// "no embedder yet" case here is the EXPECTED, documented state, not a
// stopgap — the real ArcFace recognition embedder (APP-028) trains at
// production scale under a QA gate that hasn't passed yet (real-photo
// benchmark top-1 >=95%, SPEC-APP.md §8.7d), so this repo never fabricates
// image vectors and honestly records the absence + reason.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  loadImageEmbeddingsInput,
  NO_VISION_EMBEDDER_VERSION,
} from "../src/knowledge/imageEmbeddingsInput.js";

function line(rec: unknown): string {
  return JSON.stringify(rec);
}

describe("loadImageEmbeddingsInput", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-knowledge-image-embed-test-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns {provided: false} with a QA-gate reason and a sentinel version when no path is given", () => {
    const result = loadImageEmbeddingsInput(null);
    expect(result.provided).toBe(false);
    if (result.provided) throw new Error("unreachable");
    expect(result.embedderVersion).toBe(NO_VISION_EMBEDDER_VERSION);
    expect(result.reason).toMatch(/APP-028/);
  });

  it("loads a valid JSONL file keyed by printingId", () => {
    const filePath = path.join(tmpDir, "image-embeddings.jsonl");
    fs.writeFileSync(
      filePath,
      [
        line({ printingId: "q9B6nmKrdz8HnQnJMpQdc", embedderVersion: "vision-embed-v1", vector: [0.1, 0.2] }),
        line({ printingId: "aB1c2D3e4F5g6H7i8J9k0", embedderVersion: "vision-embed-v1", vector: [0.3, 0.4] }),
      ].join("\n") + "\n",
    );
    const result = loadImageEmbeddingsInput(filePath);
    expect(result.provided).toBe(true);
    if (!result.provided) throw new Error("unreachable");
    expect(result.embedderVersion).toBe("vision-embed-v1");
    expect(result.dim).toBe(2);
    expect(result.records.size).toBe(2);
  });

  it("throws loudly when a non-null path does not exist", () => {
    const missing = path.join(tmpDir, "does-not-exist.jsonl");
    expect(() => loadImageEmbeddingsInput(missing)).toThrow(/does-not-exist\.jsonl/);
  });

  it("throws when records mix embedder versions", () => {
    const filePath = path.join(tmpDir, "mixed-version.jsonl");
    fs.writeFileSync(
      filePath,
      [
        line({ printingId: "p1", embedderVersion: "vision-embed-v1", vector: [0.1] }),
        line({ printingId: "p2", embedderVersion: "vision-embed-v2", vector: [0.1] }),
      ].join("\n") + "\n",
    );
    expect(() => loadImageEmbeddingsInput(filePath)).toThrow(/embedderVersion/);
  });

  it("throws when records mix vector dimensions", () => {
    const filePath = path.join(tmpDir, "mixed-dim.jsonl");
    fs.writeFileSync(
      filePath,
      [
        line({ printingId: "p1", embedderVersion: "vision-embed-v1", vector: [0.1, 0.2] }),
        line({ printingId: "p2", embedderVersion: "vision-embed-v1", vector: [0.1] }),
      ].join("\n") + "\n",
    );
    expect(() => loadImageEmbeddingsInput(filePath)).toThrow(/dimension/);
  });

  it("throws on a duplicate printingId within the same file", () => {
    const filePath = path.join(tmpDir, "dup.jsonl");
    fs.writeFileSync(
      filePath,
      [
        line({ printingId: "p1", embedderVersion: "vision-embed-v1", vector: [0.1] }),
        line({ printingId: "p1", embedderVersion: "vision-embed-v1", vector: [0.2] }),
      ].join("\n") + "\n",
    );
    expect(() => loadImageEmbeddingsInput(filePath)).toThrow(/duplicate/i);
  });
});
