#!/usr/bin/env tsx
/**
 * Printing-image dataset builder CLI (SPEC-APP.md §8.7a, APP-025):
 *
 *   tsx src/images/cli.ts [--limit N] [--rps N] [--concurrency N] [--out DIR] [--card-json PATH]
 *
 * Reads the vendored the-fab-cube card.json, extracts one image ref per
 * printing (catalog.ts), and downloads whichever aren't already cached
 * (downloader.ts) — rate-limited, retried, resume-safe. Never commits
 * anything under the cache dir (default pipeline/out/images/, already
 * covered by the repo-root .gitignore's `pipeline/out/` rule — see
 * test/noCommitGuard.test.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { extractPrintingImageRefs, loadCardsFromFile } from "./catalog.js";
import { downloadAll } from "./downloader.js";
import { DEFAULT_DOWNLOAD_OPTIONS } from "./types.js";
import type { DownloadOptions } from "./types.js";

export interface CliArgs {
  cardJsonPath: string;
  limit: number | null;
  options: DownloadOptions;
}

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

/** Pure: the CLI's defaults given a repo root — split out from parseArgs so
 * both can be unit-tested without invoking git (see images.cli.test.ts). */
export function defaultArgs(root: string): CliArgs {
  return {
    cardJsonPath: path.join(root, "fab-cli", "third_party", "flesh-and-blood-cards", "json", "english", "card.json"),
    limit: null,
    options: { ...DEFAULT_DOWNLOAD_OPTIONS, cacheDir: path.join(root, "pipeline", "out", "images") },
  };
}

/** Pure: layers flag overrides onto `defaults` without mutating it. */
export function parseArgs(argv: string[], defaults: CliArgs): CliArgs {
  const args: CliArgs = { ...defaults, options: { ...defaults.options } };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--limit" && argv[i + 1]) args.limit = Number(argv[++i]);
    else if (arg === "--rps" && argv[i + 1]) args.options.requestsPerSecond = Number(argv[++i]);
    else if (arg === "--concurrency" && argv[i + 1]) args.options.concurrency = Number(argv[++i]);
    else if (arg === "--out" && argv[i + 1]) args.options.cacheDir = argv[++i];
    else if (arg === "--card-json" && argv[i + 1]) args.cardJsonPath = argv[++i];
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), defaultArgs(repoRoot()));

  const cards = loadCardsFromFile(args.cardJsonPath);
  let refs = extractPrintingImageRefs(cards);
  if (args.limit != null) refs = refs.slice(0, args.limit);

  const outcomes = await downloadAll(refs, args.options, {
    fetchFn: (url) =>
      fetch(url, {
        headers: { "User-Agent": "fab-companion-app-pipeline/0.1 (+training-host dataset builder, APP-025)" },
      }),
    fileExists: (p) => fs.existsSync(p),
    writeFile: (p, data) => fs.writeFileSync(p, data),
    rename: (from, to) => fs.renameSync(from, to),
    ensureDir: (d) => fs.mkdirSync(d, { recursive: true }),
  });

  const cached = outcomes.filter((o) => o.status === "cached").length;
  const downloaded = outcomes.filter((o) => o.status === "downloaded").length;
  const failed = outcomes.filter((o) => o.status === "failed");

  console.log(`printings: ${refs.length} (cached ${cached}, downloaded ${downloaded}, failed ${failed.length})`);
  console.log(`cache dir -> ${args.options.cacheDir}`);
  if (failed.length > 0) {
    console.log("failed:");
    for (const f of failed) console.log(`  ${f.printingId}: ${f.failureReason}`);
  }
}

// Guarded so importing this module (e.g. from tests, for parseArgs/defaultArgs) never
// triggers a real download run as a side effect.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
