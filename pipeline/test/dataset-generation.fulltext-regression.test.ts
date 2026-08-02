// BUG-190 regression guard: proves — via real subprocess invocations of
// each dataset-generation CLI (qa:generate, qa:sample, behavior:build,
// dataset:build) — that (a) pointing --chunks at a fulltext-shaped file
// flows real prose through to generated artifacts, (b) STUB_TEXT_MARKER
// never appears in any dataset-generation output even when a
// stub-mode-shaped chunks.jsonl sits right beside the fulltext file, and
// (c) a missing chunks-fulltext.jsonl is a loud subprocess failure — never
// a silent fallback to chunks.jsonl. See docs/rights-assessment.md's
// "Known follow-up gap" and pipeline/src/shippingModes.ts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { STUB_TEXT_MARKER } from "../src/shippingModes.js";

const PIPELINE_ROOT = path.resolve(import.meta.dirname, "..");
const TSX_BIN = path.resolve(PIPELINE_ROOT, "..", "node_modules", ".bin", "tsx");

const LORE_CHUNK_ID = "lore/world-of-rathe/demonastery";
const PROSE_TEXT =
  "The Demonastery is where Lord Sutcliffe was once imprisoned, long before the events of the current telling.";

function loreChunk(text: string) {
  return {
    chunk_id: LORE_CHUNK_ID,
    title: "Demonastery",
    text,
    source: "https://legendarystories.net/world-of-rathe/demonastery.html",
    links: [],
    tags: ["lore"],
  };
}

function writeJsonl(filePath: string, records: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : ""));
}

function run(entry: string, args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(TSX_BIN, [path.join(PIPELINE_ROOT, "src", entry), ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { status: e.status, stdout: e.stdout, stderr: e.stderr };
  }
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-fulltext-regression-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("dataset-generation CLIs read chunks-fulltext.jsonl and never leak the stub marker (BUG-190)", () => {
  it(
    "qa:generate --dry-run's plan carries real prose, not the stub marker, when --chunks points at the fulltext file",
    () => {
      writeJsonl(path.join(tmpDir, "chunks.jsonl"), [loreChunk(STUB_TEXT_MARKER)]); // sibling stub file, must be ignored
      const fulltextPath = path.join(tmpDir, "chunks-fulltext.jsonl");
      writeJsonl(fulltextPath, [loreChunk(PROSE_TEXT)]);
      const outDir = path.join(tmpDir, "qa-out");

      const result = run("qa/cli.ts", [
        "--chunks", fulltextPath,
        "--config", path.join(PIPELINE_ROOT, "config", "qa-generation.json"),
        "--out", outDir,
        "--dry-run",
      ]);
      expect(result.status).toBe(0);
      const plan = JSON.parse(fs.readFileSync(path.join(outDir, "dry-run-plan.json"), "utf8"));
      const userPrompt = plan[0].request.user as string;
      expect(userPrompt).toContain(PROSE_TEXT);
      expect(userPrompt).not.toContain(STUB_TEXT_MARKER);
    },
    30_000,
  );

  it(
    "qa:generate fails loudly (no silent chunks.jsonl fallback) when chunks-fulltext.jsonl is missing",
    () => {
      writeJsonl(path.join(tmpDir, "chunks.jsonl"), [loreChunk(STUB_TEXT_MARKER)]);
      const missingFulltext = path.join(tmpDir, "chunks-fulltext.jsonl");
      const outDir = path.join(tmpDir, "qa-out");

      const result = run("qa/cli.ts", ["--chunks", missingFulltext, "--out", outDir, "--dry-run"]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/chunks-fulltext\.jsonl/);
      expect(result.stderr).toMatch(/export/i);
      expect(fs.existsSync(path.join(outDir, "dry-run-plan.json"))).toBe(false);
    },
    30_000,
  );

  it(
    "qa:sample --dry-run's plan carries real prose, not the stub marker, when --chunks points at the fulltext file",
    () => {
      writeJsonl(path.join(tmpDir, "chunks.jsonl"), [loreChunk(STUB_TEXT_MARKER)]);
      const fulltextPath = path.join(tmpDir, "chunks-fulltext.jsonl");
      writeJsonl(fulltextPath, [loreChunk(PROSE_TEXT)]);
      const qaPairsPath = path.join(tmpDir, "qa-pairs.jsonl");
      writeJsonl(qaPairsPath, [
        { chunk_id: LORE_CHUNK_ID, pairs: [{ question: "Where was Sutcliffe imprisoned?", answer: "The Demonastery.", cited_chunk_ids: [LORE_CHUNK_ID] }] },
      ]);
      const outDir = path.join(tmpDir, "sampling-out");

      const result = run("sampling/cli.ts", [
        "--chunks", fulltextPath,
        "--qa-pairs", qaPairsPath,
        "--config", path.join(PIPELINE_ROOT, "config", "rejection-sampling.json"),
        "--out", outDir,
        "--dry-run",
      ]);
      expect(result.status).toBe(0);
      const plan = JSON.parse(fs.readFileSync(path.join(outDir, "dry-run-plan.json"), "utf8"));
      const userPrompt = plan[0].request.user as string;
      expect(userPrompt).toContain(PROSE_TEXT);
      expect(userPrompt).not.toContain(STUB_TEXT_MARKER);
    },
    30_000,
  );

  it(
    "qa:sample fails loudly when chunks-fulltext.jsonl is missing",
    () => {
      const missingFulltext = path.join(tmpDir, "chunks-fulltext.jsonl");
      const outDir = path.join(tmpDir, "sampling-out");

      const result = run("sampling/cli.ts", ["--chunks", missingFulltext, "--out", outDir, "--dry-run"]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/chunks-fulltext\.jsonl/);
      expect(result.stderr).toMatch(/export/i);
    },
    30_000,
  );

  it(
    "behavior:build fails loudly when chunks-fulltext.jsonl is missing (defense-in-depth: its output never embeds chunk text today, but reader plumbing must still refuse to silently substitute chunks.jsonl)",
    () => {
      const missingFulltext = path.join(tmpDir, "chunks-fulltext.jsonl");
      const outDir = path.join(tmpDir, "behavior-out");

      const result = run("behavior/cli.ts", ["--chunks", missingFulltext, "--out", outDir]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/chunks-fulltext\.jsonl/);
      expect(result.stderr).toMatch(/export/i);
      expect(fs.existsSync(outDir)).toBe(false);
    },
    30_000,
  );

  it(
    "dataset:build's train/eval output never contains the stub marker even when a stub-shaped chunks.jsonl sits right beside the fulltext file",
    () => {
      writeJsonl(path.join(tmpDir, "chunks.jsonl"), [loreChunk(STUB_TEXT_MARKER)]);
      const fulltextPath = path.join(tmpDir, "chunks-fulltext.jsonl");
      writeJsonl(fulltextPath, [loreChunk(PROSE_TEXT)]);
      const qaPairsPath = path.join(tmpDir, "qa-pairs.jsonl");
      writeJsonl(qaPairsPath, [
        { chunk_id: LORE_CHUNK_ID, pairs: [{ question: "Where was Sutcliffe imprisoned?", answer: "The Demonastery.", cited_chunk_ids: [LORE_CHUNK_ID] }] },
      ]);
      const configPath = path.join(tmpDir, "dataset-build.json");
      fs.writeFileSync(configPath, JSON.stringify({ seed: 1, evalFraction: 0.2, minEvalChunksPerCategory: 1 }));
      const outDir = path.join(tmpDir, "dataset-out");

      const result = run("dataset/cli.ts", [
        "--chunks", fulltextPath,
        "--qa-pairs", qaPairsPath,
        "--accepted", path.join(tmpDir, "missing-accepted.jsonl"),
        "--rejected", path.join(tmpDir, "missing-rejected.jsonl"),
        "--distractor", path.join(tmpDir, "missing-distractor.jsonl"),
        "--abstention", path.join(tmpDir, "missing-abstention.jsonl"),
        "--ood", path.join(tmpDir, "missing-ood.jsonl"),
        "--dpo", path.join(tmpDir, "missing-dpo.jsonl"),
        "--config", configPath,
        "--corpus-manifest", path.join(tmpDir, "missing-manifest.json"),
        "--qa-manifest", path.join(tmpDir, "missing-qa-manifest.json"),
        "--out", outDir,
      ]);
      expect(result.status).toBe(0);
      const trainRaw = fs.readFileSync(path.join(outDir, "train.jsonl"), "utf8");
      const evalRaw = fs.readFileSync(path.join(outDir, "eval.jsonl"), "utf8");
      expect(trainRaw + evalRaw).not.toContain(STUB_TEXT_MARKER);
    },
    30_000,
  );

  it(
    "dataset:build fails loudly when chunks-fulltext.jsonl is missing",
    () => {
      const missingFulltext = path.join(tmpDir, "chunks-fulltext.jsonl");
      const configPath = path.join(tmpDir, "dataset-build.json");
      fs.writeFileSync(configPath, JSON.stringify({ seed: 1, evalFraction: 0.2, minEvalChunksPerCategory: 1 }));
      const outDir = path.join(tmpDir, "dataset-out");

      const result = run("dataset/cli.ts", ["--chunks", missingFulltext, "--config", configPath, "--out", outDir]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/chunks-fulltext\.jsonl/);
      expect(result.stderr).toMatch(/export/i);
      expect(fs.existsSync(path.join(outDir, "train.jsonl"))).toBe(false);
    },
    30_000,
  );
});
