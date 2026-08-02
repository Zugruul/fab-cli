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
import { STUB_TEXT_MARKER, sourceNameForChunk } from "./shippingModes.js";

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

  const { chunks, chunksFullText, manifest } = runExport({
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
    // APP-017 (SPEC-APP.md §7.10): committed, per-source shipping-mode
    // config, rationalized in docs/rights-assessment.md.
    shippingModesPath: path.join(import.meta.dirname, "..", "config", "shipping-modes.json"),
  });

  fs.mkdirSync(outDir, { recursive: true });
  const chunksPath = path.join(outDir, "chunks.jsonl");
  const chunksFullTextPath = path.join(outDir, "chunks-fulltext.jsonl");
  const manifestPath = path.join(outDir, "manifest.json");
  // chunks.jsonl carries the §7.10-enforced, shipped text (stub-mode
  // sources' text replaced by the stub marker); chunks-fulltext.jsonl is
  // the parallel, always-full-text file for pipeline-internal dataset
  // generation (§7.3-§7.9) and stub-chunk embeddings at pack-build time —
  // see docs/rights-assessment.md's "Exporter enforcement" section for the
  // two-file design rationale.
  fs.writeFileSync(chunksPath, chunks.map((c) => JSON.stringify(c)).join("\n") + "\n");
  fs.writeFileSync(
    chunksFullTextPath,
    chunksFullText.map((c) => JSON.stringify(c)).join("\n") + "\n",
  );
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  console.log(`chunks (shipping-mode enforced): ${chunks.length} -> ${chunksPath}`);
  console.log(`chunks (full text, pipeline-internal): ${chunksFullText.length} -> ${chunksFullTextPath}`);
  console.log(`manifest -> ${manifestPath}`);
  console.log("");
  console.log("per-source shipping modes (SPEC-APP.md §7.10, docs/rights-assessment.md):");
  for (const source of manifest.sources) {
    console.log(`  ${source.name}: ${source.shippingMode} (count=${source.count}, skipped=${source.skipped})`);
  }
  const stubSources = new Set(manifest.sources.filter((s) => s.shippingMode === "stub").map((s) => s.name));
  const stubbedChunks = chunks.filter((c) => stubSources.has(sourceNameForChunk(c.chunk_id)));
  const confirmedStubbed = stubbedChunks.filter((c) => c.text === STUB_TEXT_MARKER);
  console.log("");
  console.log(
    `stub verification: ${confirmedStubbed.length}/${stubbedChunks.length} chunk(s) from stub-mode ` +
      `source(s) carry the stub marker in chunks.jsonl — real text lives only in ${chunksFullTextPath}`,
  );
  if (confirmedStubbed.length !== stubbedChunks.length) {
    throw new Error(
      `stub enforcement failed: ${stubbedChunks.length - confirmedStubbed.length} chunk(s) from a ` +
        `stub-mode source did not carry the stub marker in chunks.jsonl`,
    );
  }
  console.log(JSON.stringify(manifest, null, 2));
}

main();
