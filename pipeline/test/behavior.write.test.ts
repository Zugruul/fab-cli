import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeBehaviorDatasets } from "../src/behavior/write.js";
import type { BehaviorDatasetsResult } from "../src/behavior/build.js";

let tmpDir: string;
let outDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-behavior-write-test-"));
  outDir = path.join(tmpDir, "behavior");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeResult(overrides: Partial<BehaviorDatasetsResult> = {}): BehaviorDatasetsResult {
  return {
    distractor: [],
    abstention: [],
    ood: [],
    dpo: [],
    manifest: {
      schemaVersion: "0.1.0",
      buildDate: "2026-08-02T00:00:00.000Z",
      seed: 1,
      configHash: "deadbeef",
      counts: { distractor: 0, abstention: 0, ood: 0, dpo: 0 },
      minimums: { distractor: 0, abstention: 0, ood: 0, dpo: 0 },
      skippedCounts: { distractor: 0, abstention: 0, dpo: 0 },
      timeSensitiveDistractorCount: 0,
      dpoMethodCounts: { "rejection-sample": 0, "synthetic-citation-stripped": 0, "synthetic-confident-wrong": 0 },
      oodDiversity: { totalTemplates: 0, distinctTemplatesUsed: 0, templateUsageRatio: 0, styleCount: 0, stylesCovered: 0, styleCoverageRatio: 0 },
    },
    ...overrides,
  };
}

describe("writeBehaviorDatasets", () => {
  it("writes one jsonl file per category plus manifest.json", () => {
    writeBehaviorDatasets(outDir, makeResult({ ood: [{ id: "ood-sports-0", category: "ood", style: "sports", question: "q?", target: { answer: "no", citation_ids: [], confidence: "high" } }] }));
    expect(fs.existsSync(path.join(outDir, "distractor.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "abstention.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "ood.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "dpo.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "manifest.json"))).toBe(true);

    const oodLines = fs
      .readFileSync(path.join(outDir, "ood.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean);
    expect(oodLines).toHaveLength(1);
    expect(JSON.parse(oodLines[0]).id).toBe("ood-sports-0");
  });

  it("leaves no temp directory behind after a successful write", () => {
    writeBehaviorDatasets(outDir, makeResult());
    const siblings = fs.readdirSync(tmpDir);
    expect(siblings).toEqual(["behavior"]);
  });

  it("replaces a pre-existing output directory atomically (old contents gone, new contents present)", () => {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "stale-file.txt"), "old run leftover");

    writeBehaviorDatasets(outDir, makeResult());

    expect(fs.existsSync(path.join(outDir, "stale-file.txt"))).toBe(false);
    expect(fs.existsSync(path.join(outDir, "manifest.json"))).toBe(true);
  });

  it("creates parent directories as needed", () => {
    const nested = path.join(tmpDir, "a", "b", "behavior");
    expect(() => writeBehaviorDatasets(nested, makeResult())).not.toThrow();
    expect(fs.existsSync(path.join(nested, "manifest.json"))).toBe(true);
  });
});
