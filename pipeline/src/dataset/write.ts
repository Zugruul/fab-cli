import fs from "node:fs";
import path from "node:path";
import type { DatasetExample } from "./types.js";
import type { DatasetManifest } from "./manifest.js";

function toJsonl(records: unknown[]): string {
  return records.length === 0 ? "" : records.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

/**
 * Writes the assembled dataset to `outDir` atomically: everything is
 * written to a fresh sibling temp directory first, then swapped into place
 * with a single rename — mirrors behavior/write.ts's atomic-directory-swap
 * pattern exactly, for the same reason (a pure, fast, in-memory build with
 * nothing worth checkpointing mid-run — no resumable progress file).
 *
 * Bulk output (train.jsonl/eval.jsonl) stays out of git — `outDir` is
 * expected to live under pipeline/out/dataset/, already covered by
 * pipeline/out/'s .gitignore entry.
 */
export function writeDataset(outDir: string, examples: DatasetExample[], manifest: DatasetManifest): void {
  const parent = path.dirname(outDir);
  fs.mkdirSync(parent, { recursive: true });

  const tmpDir = path.join(parent, `.${path.basename(outDir)}.tmp-${process.pid}-${Date.now()}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const train = examples.filter((e) => e.split === "train");
  const evalExamples = examples.filter((e) => e.split === "eval");

  fs.writeFileSync(path.join(tmpDir, "train.jsonl"), toJsonl(train));
  fs.writeFileSync(path.join(tmpDir, "eval.jsonl"), toJsonl(evalExamples));
  fs.writeFileSync(path.join(tmpDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.renameSync(tmpDir, outDir);
}
