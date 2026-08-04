#!/usr/bin/env tsx
/**
 * Printing-image dataset builder CLI (SPEC-APP.md §8.7a, APP-025):
 *
 *   tsx src/images/cli.ts [--limit N] [--rps N] [--concurrency N] [--out DIR] [--card-json PATH] [--download-failures PATH]
 *
 * Reads the vendored the-fab-cube card.json, extracts one image ref per
 * printing (catalog.ts), and downloads whichever aren't already cached
 * (downloader.ts) — rate-limited, retried, resume-safe. Never commits
 * anything under the cache dir (default pipeline/out/images/, already
 * covered by the repo-root .gitignore's `pipeline/out/` rule — see
 * test/noCommitGuard.test.ts).
 *
 * #268: every run OVERWRITES a download-failures manifest (default
 * pipeline/out/download-failures.json, a sibling of the cache dir — see
 * `--download-failures`) with exactly this run's `summarizeFailedDownloads`
 * output (printingId + parsed HTTP status + reason). This never changes
 * `downloadAll`'s own existing behavior (one bad printing still never
 * aborts the others) — it's purely an additional, machine-readable record
 * of WHICH printings permanently failed and why, so `composites generate
 * --coverage` can exclude them from its eligible pool and report them as
 * "unavailable upstream" instead of either aborting or silently treating a
 * missing cache file as an ordinary coverage shortfall.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { extractPrintingImageRefs, loadCardsFromFile } from "./catalog.js";
import { downloadAll, summarizeFailedDownloads } from "./downloader.js";
import { DEFAULT_DOWNLOAD_OPTIONS } from "./types.js";
import type { DownloadOptions } from "./types.js";
import type { FetchLikeResponse } from "./downloader.js";

export interface CliArgs {
  cardJsonPath: string;
  limit: number | null;
  options: DownloadOptions;
  /** #268: where the download-failures manifest is written after every
   * run (overwritten, not appended/merged — see downloadCommand's doc).
   * Deliberately a SIBLING of the cache dir (out/download-failures.json,
   * not inside out/images/ itself) so nothing that scans the cache dir
   * expecting only image files ever has to special-case it. */
  downloadFailuresPath: string;
}

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

/** Pure: the CLI's defaults given a repo root — split out from parseArgs so
 * both can be unit-tested without invoking git (see images.cli.test.ts). */
export function defaultArgs(root: string): CliArgs {
  const cacheDir = path.join(root, "pipeline", "out", "images");
  return {
    cardJsonPath: path.join(root, "fab-cli", "third_party", "flesh-and-blood-cards", "json", "english", "card.json"),
    limit: null,
    options: { ...DEFAULT_DOWNLOAD_OPTIONS, cacheDir },
    downloadFailuresPath: path.join(path.dirname(cacheDir), "download-failures.json"),
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
    else if (arg === "--download-failures" && argv[i + 1]) args.downloadFailuresPath = argv[++i];
  }
  return args;
}

/** Injectable subset of downloadAll's real deps this command needs to
 * override for testing — mirrors composites/zones/cli.ts's
 * realDownloadDeps() pattern, but partial (only fetchFn/maxRetries are
 * ever worth swapping in a test; fs deps stay real so a test can assert
 * against real files on disk, same as composites.cli.test.ts's style). */
export interface DownloadCommandOverrides {
  fetchFn?: (url: string) => Promise<FetchLikeResponse>;
  maxRetries?: number;
}

/**
 * Runs one full download pass: reads the catalog, downloads whichever
 * printings aren't already cached (downloadAll — resume-safe, one bad
 * printing never aborts the others), then OVERWRITES the download-failures
 * manifest with exactly this run's failures (#268) — not a merge/append
 * across runs, since a stale prior failure that has since started
 * succeeding (or simply wasn't attempted this time, e.g. under --limit)
 * must never linger in the manifest as a false "still unavailable" entry.
 * A full, unlimited run is what makes this manifest authoritative for a
 * coverage report; a --limit'd run's manifest only covers what it actually
 * attempted, which is why composites/cli.ts's coverage mode documents this
 * as "best-effort, from the most recent full download run."
 */
export async function downloadCommand(argv: string[], overrides: DownloadCommandOverrides = {}): Promise<void> {
  const args = parseArgs(argv, defaultArgs(repoRoot()));

  const cards = loadCardsFromFile(args.cardJsonPath);
  let refs = extractPrintingImageRefs(cards);
  if (args.limit != null) refs = refs.slice(0, args.limit);

  const options: DownloadOptions = overrides.maxRetries != null ? { ...args.options, maxRetries: overrides.maxRetries } : args.options;

  const outcomes = await downloadAll(refs, options, {
    fetchFn:
      overrides.fetchFn ??
      ((url) =>
        fetch(url, {
          headers: { "User-Agent": "fab-companion-app-pipeline/0.1 (+training-host dataset builder, APP-025)" },
        })),
    fileExists: (p) => fs.existsSync(p),
    writeFile: (p, data) => fs.writeFileSync(p, data),
    rename: (from, to) => fs.renameSync(from, to),
    ensureDir: (d) => fs.mkdirSync(d, { recursive: true }),
  });

  const cached = outcomes.filter((o) => o.status === "cached").length;
  const downloaded = outcomes.filter((o) => o.status === "downloaded").length;
  const failed = outcomes.filter((o) => o.status === "failed");
  const failureSummary = summarizeFailedDownloads(outcomes);

  fs.mkdirSync(path.dirname(args.downloadFailuresPath), { recursive: true });
  fs.writeFileSync(args.downloadFailuresPath, JSON.stringify(failureSummary, null, 2) + "\n");

  console.log(`printings: ${refs.length} (cached ${cached}, downloaded ${downloaded}, failed ${failed.length})`);
  console.log(`cache dir -> ${args.options.cacheDir}`);
  console.log(`download-failures manifest -> ${args.downloadFailuresPath}`);
  if (failed.length > 0) {
    console.log("failed:");
    for (const f of failed) console.log(`  ${f.printingId}: ${f.failureReason}`);
  }
}

// Guarded so importing this module (e.g. from tests, for parseArgs/defaultArgs) never
// triggers a real download run as a side effect.
if (import.meta.url === `file://${process.argv[1]}`) {
  downloadCommand(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
