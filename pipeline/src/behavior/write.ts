import fs from "node:fs";
import path from "node:path";
import type { BehaviorDatasetsResult } from "./build.js";

function toJsonl(records: unknown[]): string {
  return records.length === 0 ? "" : records.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

/**
 * Writes the full build result to `outDir` atomically: everything is
 * written to a fresh sibling temp directory first, then swapped into place
 * with a single rename — so a reader never observes a partially-written
 * output directory, and a crash mid-write leaves any previous `outDir`
 * untouched. Chosen over a progress/resume file (the pattern qa/runner.ts
 * and the sampling lane use for their long-running, network-bound,
 * resumable batch runs) because this build is a pure, fast, fully-offline
 * in-memory transform with nothing worth checkpointing mid-run — see
 * build.ts's doc comment.
 */
export function writeBehaviorDatasets(outDir: string, result: BehaviorDatasetsResult): void {
  const parent = path.dirname(outDir);
  fs.mkdirSync(parent, { recursive: true });

  const tmpDir = path.join(parent, `.${path.basename(outDir)}.tmp-${process.pid}-${Date.now()}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  fs.writeFileSync(path.join(tmpDir, "distractor.jsonl"), toJsonl(result.distractor));
  fs.writeFileSync(path.join(tmpDir, "abstention.jsonl"), toJsonl(result.abstention));
  fs.writeFileSync(path.join(tmpDir, "ood.jsonl"), toJsonl(result.ood));
  fs.writeFileSync(path.join(tmpDir, "dpo.jsonl"), toJsonl(result.dpo));
  fs.writeFileSync(path.join(tmpDir, "manifest.json"), JSON.stringify(result.manifest, null, 2) + "\n");

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.renameSync(tmpDir, outDir);
}
