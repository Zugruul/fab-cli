// Subprocess integration test (APP-015): proves the legality guard is
// actually wired into `pnpm dataset:build` (src/dataset/cli.ts's main()),
// not just exported and unit-tested in isolation. Exercises a real gap in
// assemble.ts: distractor.jsonl records pass through assembly UNFILTERED
// regardless of their `timeSensitive` flag (assemble.ts only checks
// "chunk found?", never re-derives isLegalityChunk for distractors — see
// legalityGuard.ts's doc comment) — so a malformed/hand-crafted distractor
// artifact carrying a legality chunk_id but `timeSensitive: false` is
// exactly the shape that would otherwise reach train.jsonl silently.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

const PIPELINE_ROOT = path.resolve(import.meta.dirname, "..");
const TSX_BIN = path.resolve(PIPELINE_ROOT, "..", "node_modules", ".bin", "tsx");
const CLI_ENTRY = path.join(PIPELINE_ROOT, "src", "dataset", "cli.ts");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-dataset-legality-cli-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const LEGALITY_CHUNK = {
  chunk_id: "rules/legality/current",
  title: "Card Legality Policy",
  text: "Legality text as of the live policy fetch.",
  source: "https://fabtcg.com/rules-and-policy-center/card-legality-policy/",
  links: [],
  tags: ["legality", "rules"],
};

const OTHER_CHUNK = {
  chunk_id: "rules/cr/1.1",
  title: "CR 1.1",
  text: "Some ordinary rules text.",
  source: "cr",
  links: [],
  tags: ["cr", "rules"],
};

function writeJsonl(filePath: string, records: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : ""));
}

function runCli(distractorRecords: unknown[]): { status: number; stderr: string; stdout: string } {
  const chunksPath = path.join(tmpDir, "chunks.jsonl");
  const qaPairsPath = path.join(tmpDir, "qa-pairs.jsonl");
  const distractorPath = path.join(tmpDir, "distractor.jsonl");
  const configPath = path.join(tmpDir, "dataset-build.json");
  const outDir = path.join(tmpDir, "out-dataset");

  writeJsonl(chunksPath, [LEGALITY_CHUNK, OTHER_CHUNK]);
  writeJsonl(qaPairsPath, [{ chunk_id: OTHER_CHUNK.chunk_id, pairs: [{ question: "q?", answer: "a.", cited_chunk_ids: [OTHER_CHUNK.chunk_id] }] }]);
  writeJsonl(distractorPath, distractorRecords);
  fs.writeFileSync(configPath, JSON.stringify({ seed: 1, evalFraction: 0.2, minEvalChunksPerCategory: 1 }));

  try {
    const stdout = execFileSync(
      TSX_BIN,
      [
        CLI_ENTRY,
        "--chunks", chunksPath,
        "--qa-pairs", qaPairsPath,
        "--accepted", path.join(tmpDir, "missing-accepted.jsonl"),
        "--rejected", path.join(tmpDir, "missing-rejected.jsonl"),
        "--distractor", distractorPath,
        "--abstention", path.join(tmpDir, "missing-abstention.jsonl"),
        "--ood", path.join(tmpDir, "missing-ood.jsonl"),
        "--dpo", path.join(tmpDir, "missing-dpo.jsonl"),
        "--config", configPath,
        "--corpus-manifest", path.join(tmpDir, "missing-manifest.json"),
        "--qa-manifest", path.join(tmpDir, "missing-qa-manifest.json"),
        "--out", outDir,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { status: 0, stderr: "", stdout };
  } catch (err) {
    const e = err as { status: number; stderr: string; stdout: string };
    return { status: e.status, stderr: e.stderr, stdout: e.stdout };
  }
}

describe("dataset:build CLI — legality guard wiring", () => {
  it(
    "exits 0 for a clean build (distractor legality example correctly marked timeSensitive)",
    () => {
      const result = runCli([
        {
          id: "distractor-rules/legality/current-0",
          category: "distractor",
          chunk_id: LEGALITY_CHUNK.chunk_id,
          question: "Is card X currently legal?",
          contextChunkIds: [LEGALITY_CHUNK.chunk_id, OTHER_CHUNK.chunk_id],
          target: { answer: "See the live policy.", citation_ids: [LEGALITY_CHUNK.chunk_id], confidence: "high" },
          timeSensitive: true,
        },
      ]);
      expect(result.status).toBe(0);
    },
    30_000,
  );

  it(
    "exits non-zero and prints a §7.9 legality-guard error when a legality chunk reaches fact-SFT-shaped output (mis-marked distractor slips past assembly's own filters)",
    () => {
      const result = runCli([
        {
          id: "distractor-rules/legality/current-0",
          category: "distractor",
          chunk_id: LEGALITY_CHUNK.chunk_id,
          question: "Is card X currently legal?",
          contextChunkIds: [LEGALITY_CHUNK.chunk_id, OTHER_CHUNK.chunk_id],
          target: { answer: "See the live policy.", citation_ids: [LEGALITY_CHUNK.chunk_id], confidence: "high" },
          timeSensitive: false, // mis-marked: should have been true
        },
      ]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/legality/i);
      expect(result.stderr).toMatch(/§7\.9/);
      expect(fs.existsSync(path.join(tmpDir, "out-dataset", "train.jsonl"))).toBe(false);
    },
    30_000,
  );
});
