#!/usr/bin/env tsx
/**
 * Corpus exporter CLI (SPEC-APP.md §7.1-§7.2). Resolves the real monorepo
 * paths and runs the export end to end, writing chunks + a snapshot
 * manifest under an output directory (default `pipeline/out/`, gitignored
 * — exported corpus content is never committed, only regenerated).
 *
 * This is the sanctioned build-time entry point for reading the FAB
 * identity brains directly (SPEC-APP.md §7.1: "via the brain machinery or a
 * build-time bypass approved for pipeline use") — never read brain notes
 * from an interactive agent session.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runExport } from "./export.js";

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

function parseArgs(argv: string[]): { out: string } {
  let out = "out";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out" && argv[i + 1]) {
      out = argv[i + 1];
      i++;
    }
  }
  return { out };
}

function main() {
  const root = repoRoot();
  const { out } = parseArgs(process.argv.slice(2));
  const outDir = path.isAbsolute(out) ? out : path.join(import.meta.dirname, "..", out);

  const { chunks, manifest } = runExport({
    identitiesRoot: path.join(root, ".claude", "identities"),
    kbRulesDir: path.join(root, "fab-cli", "kb", "rules"),
    loreDir: path.join(root, "fab-cli", "lore"),
    versionsTxtPath: path.join(root, "fab-cli", "third_party", "fab-rules", "VERSIONS.txt"),
    setJsonPath: path.join(
      root,
      "fab-cli",
      "third_party",
      "flesh-and-blood-cards",
      "json",
      "english",
      "set.json",
    ),
    fabloreDir: path.join(root, "fab-cli", "third_party", "fablore"),
  });

  fs.mkdirSync(outDir, { recursive: true });
  const chunksPath = path.join(outDir, "chunks.jsonl");
  const manifestPath = path.join(outDir, "manifest.json");
  fs.writeFileSync(chunksPath, chunks.map((c) => JSON.stringify(c)).join("\n") + "\n");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  console.log(`chunks: ${chunks.length} -> ${chunksPath}`);
  console.log(`manifest -> ${manifestPath}`);
  console.log(JSON.stringify(manifest, null, 2));
}

main();
