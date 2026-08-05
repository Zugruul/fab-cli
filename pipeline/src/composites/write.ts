/**
 * Writes one generation run's output (SPEC-APP.md §8.7b): every
 * composite's PNG + label JSON, plus the run manifest. Output lives under
 * pipeline/out/composites/ (gitignored, see test/noCommitGuard.test.ts) —
 * never committed.
 *
 * Two writers, two different scales:
 *
 * `writeCompositeRun` — the original batch writer: build-everything-in-a-
 * fresh-sibling-tmp-dir-then-rename, mirroring dataset/write.ts. Atomic
 * (a stale/partial outDir is only ever replaced whole, never partially
 * merged) but requires the caller to hold every composite's rendered
 * pixels in memory until the very end — fine at hundreds of composites,
 * catastrophic at coverage-run scale (#272: ~11MB/composite unbounded RSS
 * growth, SIGKILL before a single file was written on a 20,700-composite
 * run). Still used by zones/cli.ts (`zone-generate`), which is out of
 * #272's scope.
 *
 * `beginCompositeRun` — the #272 streaming writer for the plain `generate`
 * command: `writeComposite()` encodes and writes one composite's PNG +
 * label.json IMMEDIATELY, so the caller can drop its RawImage the moment
 * the call resolves rather than holding it for the whole run — memory
 * stays O(1) in run length. This trades the batch writer's whole-dataset
 * atomicity for progressive visibility (files appear on disk as they're
 * produced, the actual point of the fix): `finalize()` writes
 * manifest.json LAST, so its presence is the run's completion marker —
 * output with composite files but no manifest.json means a run was
 * interrupted partway through, not that it silently finished. Any stale
 * leftover in outDir is still cleared up front (mkdir fresh) before the
 * first write, so a killed prior run's partial output never gets
 * mistaken for the new run's.
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

export interface CompositeRunWriter {
  /** Encodes + writes one composite's image and label.json to outDir
   * immediately. Resolves once both files are on disk — the caller is
   * free to drop its RawImage right after (#272: this is what makes
   * generate.ts's per-composite memory O(1) instead of O(composites)). */
  writeComposite(image: RawImage, label: CompositeLabel): Promise<void>;
  /** Writes manifest.json — call this once, after every composite the
   * run intends to produce has already been written. Its presence is the
   * run's completion marker. */
  finalize(manifest: CompositeDatasetManifest): void;
}

export function beginCompositeRun(outDir: string, encodeImage: (img: RawImage) => Promise<Buffer>): CompositeRunWriter {
  // Clear any stale leftover from a previous (possibly killed) run before
  // the first write — same "never partially merge with what was there
  // before" guarantee the batch writer's tmp-then-rename gave, just
  // enforced up front instead of via a hidden staging dir.
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  return {
    async writeComposite(image, label) {
      const buffer = await encodeImage(image);
      fs.writeFileSync(path.join(outDir, label.fileName), buffer);
      fs.writeFileSync(path.join(outDir, `${label.compositeId}.json`), JSON.stringify(label, null, 2) + "\n");
    },
    finalize(manifest) {
      fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    },
  };
}
