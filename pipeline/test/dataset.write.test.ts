import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeDataset } from "../src/dataset/write.js";
import type { DatasetExample } from "../src/dataset/types.js";
import type { DatasetManifest } from "../src/dataset/manifest.js";

let tmpDir: string;
let outDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-dataset-write-test-"));
  outDir = path.join(tmpDir, "dataset");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeManifest(overrides: Partial<DatasetManifest> = {}): DatasetManifest {
  return {
    schemaVersion: "0.1.0",
    buildDate: "2026-08-02T00:00:00.000Z",
    seed: 1,
    evalFraction: 0.2,
    datasetConfigHash: "deadbeef",
    corpusSnapshot: null,
    teacherModel: null,
    qaSource: "qa-pairs-fallback",
    counts: {
      total: { train: 0, eval: 0 },
      byCategory: {
        "keyword-definitions": { train: 0, eval: 0 },
        "card-facts": { train: 0, eval: 0 },
        "multi-card-interactions": { train: 0, eval: 0 },
        "tournament-procedure": { train: 0, eval: 0 },
        lore: { train: 0, eval: 0 },
        abstention: { train: 0, eval: 0 },
        ood: { train: 0, eval: 0 },
      },
      byExampleType: {
        qa: { train: 0, eval: 0 },
        distractor: { train: 0, eval: 0 },
        dpo: { train: 0, eval: 0 },
        abstention: { train: 0, eval: 0 },
        ood: { train: 0, eval: 0 },
      },
    },
    notes: [],
    ...overrides,
  };
}

const SAMPLE_EXAMPLES: DatasetExample[] = [
  {
    id: "qa-1",
    category: "keyword-definitions",
    adjudicationCritical: false,
    exampleType: "qa",
    chunkId: "brain/card-vault/kw-dominate",
    split: "train",
    payload: {
      id: "qa-1",
      chunk_id: "brain/card-vault/kw-dominate",
      question: "q?",
      answer: "a.",
      cited_chunk_ids: ["brain/card-vault/kw-dominate"],
      entailmentChecked: true,
    },
  },
  {
    id: "qa-2",
    category: "card-facts",
    adjudicationCritical: false,
    exampleType: "qa",
    chunkId: "brain/card-vault/card-branchblade",
    split: "eval",
    payload: {
      id: "qa-2",
      chunk_id: "brain/card-vault/card-branchblade",
      question: "q2?",
      answer: "a2.",
      cited_chunk_ids: ["brain/card-vault/card-branchblade"],
      entailmentChecked: true,
    },
  },
];

describe("writeDataset", () => {
  it("writes train.jsonl, eval.jsonl (split by example.split), and manifest.json", () => {
    writeDataset(outDir, SAMPLE_EXAMPLES, makeManifest());

    expect(fs.existsSync(path.join(outDir, "train.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "eval.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "manifest.json"))).toBe(true);

    const trainLines = fs.readFileSync(path.join(outDir, "train.jsonl"), "utf8").split("\n").filter(Boolean);
    const evalLines = fs.readFileSync(path.join(outDir, "eval.jsonl"), "utf8").split("\n").filter(Boolean);
    expect(trainLines).toHaveLength(1);
    expect(evalLines).toHaveLength(1);
    expect(JSON.parse(trainLines[0]).id).toBe("qa-1");
    expect(JSON.parse(evalLines[0]).id).toBe("qa-2");
  });

  it("writes an empty (not missing) jsonl file for a split with zero examples", () => {
    writeDataset(outDir, [], makeManifest());
    expect(fs.readFileSync(path.join(outDir, "train.jsonl"), "utf8")).toBe("");
    expect(fs.readFileSync(path.join(outDir, "eval.jsonl"), "utf8")).toBe("");
  });

  it("leaves no temp directory behind after a successful write", () => {
    writeDataset(outDir, SAMPLE_EXAMPLES, makeManifest());
    expect(fs.readdirSync(tmpDir)).toEqual(["dataset"]);
  });

  it("replaces a pre-existing output directory atomically (old contents gone, new contents present)", () => {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "stale-file.txt"), "old run leftover");

    writeDataset(outDir, SAMPLE_EXAMPLES, makeManifest());

    expect(fs.existsSync(path.join(outDir, "stale-file.txt"))).toBe(false);
    expect(fs.existsSync(path.join(outDir, "manifest.json"))).toBe(true);
  });

  it("creates parent directories as needed", () => {
    const nested = path.join(tmpDir, "a", "b", "dataset");
    expect(() => writeDataset(nested, SAMPLE_EXAMPLES, makeManifest())).not.toThrow();
    expect(fs.existsSync(path.join(nested, "manifest.json"))).toBe(true);
  });

  it("writes the manifest as pretty-printed JSON matching the given object", () => {
    const manifest = makeManifest({ seed: 42 });
    writeDataset(outDir, [], manifest);
    const written = JSON.parse(fs.readFileSync(path.join(outDir, "manifest.json"), "utf8"));
    expect(written).toEqual(manifest);
  });
});
