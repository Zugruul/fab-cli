/**
 * Atomically writes one generation run's output (SPEC-APP.md §8.7b):
 * every composite's PNG + label JSON, plus the run manifest. Mirrors
 * dataset/write.ts's write-to-a-fresh-sibling-tmp-dir-then-rename pattern
 * — a pure, fast, in-memory-first build with nothing worth checkpointing
 * mid-run. Output lives under pipeline/out/composites/ (gitignored, see
 * test/noCommitGuard.test.ts) — never committed.
 */
import fs from "node:fs";
import path from "node:path";
import type { CompositeLabel } from "./types.js";
import type { RawImage } from "./rawImage.js";
import type { CompositeDatasetManifest } from "./manifest.js";

export interface WritableComposite {
  label: CompositeLabel;
  image: RawImage;
}

export async function writeCompositeRun(
  outDir: string,
  composites: WritableComposite[],
  manifest: CompositeDatasetManifest,
  encodePng: (img: RawImage) => Promise<Buffer>,
): Promise<void> {
  const parent = path.dirname(outDir);
  fs.mkdirSync(parent, { recursive: true });

  const tmpDir = path.join(parent, `.${path.basename(outDir)}.tmp-${process.pid}-${Date.now()}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  for (const { label, image } of composites) {
    const pngBuffer = await encodePng(image);
    fs.writeFileSync(path.join(tmpDir, label.fileName), pngBuffer);
    fs.writeFileSync(path.join(tmpDir, `${label.compositeId}.json`), JSON.stringify(label, null, 2) + "\n");
  }
  fs.writeFileSync(path.join(tmpDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.renameSync(tmpDir, outDir);
}
