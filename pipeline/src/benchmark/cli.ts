#!/usr/bin/env tsx
/**
 * Real-photo benchmark manifest CLI (SPEC-APP.md §8.7e, APP-025):
 *
 *   tsx src/benchmark/cli.ts [--photos-dir DIR] [--labels-dir DIR] [--out FILE]
 *
 * Builds + validates a versioned manifest (manifest.ts) from a labeled
 * photo set (loadSet.ts) per the protocol in pipeline/docs/benchmark-
 * labeling.md. Defaults point at pipeline/out/benchmark-photos/ — the
 * photos themselves live in artifact storage, never git (see the repo-root
 * .gitignore's `pipeline/out/` rule and test/noCommitGuard.test.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { buildManifestFromDirs } from "./loadSet.js";

export interface CliArgs {
  photosDir: string;
  labelsDir: string;
  out: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const base = path.join(import.meta.dirname, "..", "..");
  const args: CliArgs = {
    photosDir: path.join(base, "out", "benchmark-photos"),
    labelsDir: path.join(base, "out", "benchmark-photos", "labels"),
    out: path.join(base, "out", "benchmark", "manifest.json"),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--photos-dir" && argv[i + 1]) args.photosDir = argv[++i];
    else if (arg === "--labels-dir" && argv[i + 1]) args.labelsDir = argv[++i];
    else if (arg === "--out" && argv[i + 1]) args.out = argv[++i];
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const { manifest, missingLabels } = buildManifestFromDirs(args.photosDir, args.labelsDir);

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(manifest, null, 2) + "\n");

  console.log(`photos: ${manifest.photoCount} (skipped ${manifest.skipped.length})`);
  for (const [scene, count] of Object.entries(manifest.countsBySceneType)) {
    console.log(`  ${scene}: ${count}`);
  }
  console.log(`tags: ${Object.entries(manifest.countsByTag).map(([t, c]) => `${t}=${c}`).join(", ")}`);
  if (missingLabels.length > 0) {
    console.log(`photos with no label file: ${missingLabels.length}`);
  }
  if (manifest.skipped.length > 0) {
    console.log("skipped:");
    for (const s of manifest.skipped) console.log(`  ${s.fileName}: ${s.reason}`);
  }
  console.log(`-> ${args.out}`);
}

// Guarded so importing this module (e.g. from tests, for parseArgs) never
// triggers a real manifest build as a side effect.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
