#!/usr/bin/env tsx
/**
 * Benchmark quad-labeling tool CLI (issue #258):
 *
 *   tsx src/benchmark-label/cli.ts [--photos-dir DIR] [--labels-dir DIR]
 *                                  [--card-json PATH] [--images-cache-dir DIR]
 *                                  [--port N]
 *
 * Starts the local-only labeling server (server.ts) and prints the URL to
 * open. No external network calls — see server.ts's doc comment. Defaults
 * mirror benchmark/cli.ts's (pipeline/out/benchmark-photos/[labels/]) and
 * images/cli.ts's (fab-cli/third_party/flesh-and-blood-cards/json/english/
 * card.json, pipeline/out/images/) so this tool points at the same
 * directories every other benchmark/images command uses by default.
 */
import path from "node:path";
import { execFileSync } from "node:child_process";
import { startServer } from "./server.js";
import type { ServerConfig } from "./server.js";

export interface CliArgs {
  config: ServerConfig;
  port: number;
}

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

/** Pure: the CLI's defaults given a repo root — split out from parseArgs so
 * both can be unit-tested without invoking git (mirrors images/cli.ts's
 * defaultArgs(root) pattern). */
export function defaultArgs(root: string): CliArgs {
  return {
    config: {
      photosDir: path.join(root, "pipeline", "out", "benchmark-photos"),
      labelsDir: path.join(root, "pipeline", "out", "benchmark-photos", "labels"),
      cardJsonPath: path.join(root, "fab-cli", "third_party", "flesh-and-blood-cards", "json", "english", "card.json"),
      imagesCacheDir: path.join(root, "pipeline", "out", "images"),
    },
    port: 4173,
  };
}

/** Pure: layers flag overrides onto `defaults` without mutating it. */
export function parseArgs(argv: string[], defaults: CliArgs): CliArgs {
  const args: CliArgs = { config: { ...defaults.config }, port: defaults.port };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--photos-dir" && argv[i + 1]) args.config.photosDir = argv[++i];
    else if (arg === "--labels-dir" && argv[i + 1]) args.config.labelsDir = argv[++i];
    else if (arg === "--card-json" && argv[i + 1]) args.config.cardJsonPath = argv[++i];
    else if (arg === "--images-cache-dir" && argv[i + 1]) args.config.imagesCacheDir = argv[++i];
    else if (arg === "--port" && argv[i + 1]) args.port = Number(argv[++i]);
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2), defaultArgs(repoRoot()));
  startServer(args.config, args.port);
  console.log(`benchmark labeling tool: http://localhost:${args.port}`);
  console.log(`  photos dir  -> ${args.config.photosDir}`);
  console.log(`  labels dir  -> ${args.config.labelsDir}`);
  console.log(`  card.json   -> ${args.config.cardJsonPath}`);
  console.log(`  images cache -> ${args.config.imagesCacheDir}`);
}

// Guarded so importing this module (e.g. from tests, for parseArgs/defaultArgs)
// never starts a real server as a side effect.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
