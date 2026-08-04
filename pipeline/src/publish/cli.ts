#!/usr/bin/env tsx
/**
 * APP-029 (SPEC-APP.md §8.9; issue #141): pack assembly + publish CLI.
 *
 *   tsx src/publish/cli.ts dry-run --release-version <semver> --tier <1.7B|0.6B> [...]
 *   tsx src/publish/cli.ts publish --release-version <semver> --yes [--force]
 *
 * `dry-run` never touches the network: it reads a JSON artifact-map config
 * (see README.md in this directory for the exact shape) describing which
 * real producer outputs to assemble for the requested tiers/knowledge
 * packs, runs buildReleasePlan, and reports the result. `publish` re-reads
 * the SAME dry-run output (release-manifest.json under --out) and uploads
 * it via `gh release` — it is a hard no-op unless --yes is passed
 * explicitly (never defaults to true), matching the task's "guard the real
 * publish path behind an explicit flag" requirement.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildReleasePlan } from "./releasePlan.js";
import { publishReleasePlan, realCommandRunner } from "./ghRelease.js";
import { parseDryRunConfigJson } from "./config.js";
import type { BuildReleasePlanInput, ModelPackTier, ReleasePlan } from "./types.js";

export interface DryRunArgs {
  releaseVersion: string | null;
  outDir: string;
  tiers: ModelPackTier[];
  configPath: string | null;
}

export interface PublishArgs {
  releaseVersion: string | null;
  outDir: string;
  yes: boolean;
  force: boolean;
}

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

export function defaultDryRunArgs(root: string): DryRunArgs {
  return {
    releaseVersion: null,
    outDir: path.join(root, "pipeline", "out", "publish"),
    tiers: [],
    configPath: null,
  };
}

export function parseDryRunArgs(argv: string[], defaults: DryRunArgs): DryRunArgs {
  const args: DryRunArgs = { ...defaults, tiers: [...defaults.tiers] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--release-version" && argv[i + 1]) args.releaseVersion = argv[++i];
    else if (arg === "--out" && argv[i + 1]) args.outDir = argv[++i];
    else if (arg === "--tier" && argv[i + 1]) args.tiers.push(argv[++i] as ModelPackTier);
    else if (arg === "--config" && argv[i + 1]) args.configPath = argv[++i];
  }
  return args;
}

export function defaultPublishArgs(root: string): PublishArgs {
  return {
    releaseVersion: null,
    outDir: path.join(root, "pipeline", "out", "publish"),
    yes: false,
    force: false,
  };
}

export function parsePublishArgs(argv: string[], defaults: PublishArgs): PublishArgs {
  const args: PublishArgs = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--release-version" && argv[i + 1]) args.releaseVersion = argv[++i];
    else if (arg === "--out" && argv[i + 1]) args.outDir = argv[++i];
    else if (arg === "--yes") args.yes = true;
    else if (arg === "--force") args.force = true;
  }
  return args;
}

/** The JSON config `dry-run --config <path>` reads — a plain, committed-
 * outside-git artifact-map file (see README.md), NOT a manifest-schema
 * shape itself. Kept as `unknown`-adjacent here; buildReleasePlan's own
 * input types + the assemblers' schema validation are what actually
 * enforce correctness. */
type DryRunConfig = Omit<BuildReleasePlanInput, "releaseVersion" | "outDir">;

function loadConfig(configPath: string): DryRunConfig {
  if (!fs.existsSync(configPath)) {
    throw new Error(`publish/cli dry-run: config file not found at ${configPath}`);
  }
  const raw: unknown = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return parseDryRunConfigJson(raw);
}

/** `--tier` narrows a `--config` file's `modelPacks` to only the requested
 * tier(s) — e.g. dry-running just "0.6B" out of a config that lists both
 * tiers, without editing the config file. Passthrough (unchanged order and
 * content) when no `--tier` was given. A `--tier` naming a tier the config
 * doesn't have IS an error (a typo silently dry-running zero model packs
 * would be a worse failure than a loud one) — the message names every
 * missing tier at once plus what IS available, mirroring
 * MissingArtifactsError's style. */
export function filterModelPacksByTier<T extends { tier: ModelPackTier }>(modelPacks: T[], tiers: ModelPackTier[]): T[] {
  if (tiers.length === 0) return modelPacks;
  const available = new Set(modelPacks.map((m) => m.tier));
  const missing = tiers.filter((t) => !available.has(t));
  if (missing.length > 0) {
    throw new Error(
      `publish/cli dry-run: --tier ${missing.join(", ")} not present in --config's modelPacks ` +
        `(available: ${[...available].join(", ") || "none"})`,
    );
  }
  const wanted = new Set(tiers);
  return modelPacks.filter((m) => wanted.has(m.tier));
}

function runDryRun(argv: string[]): void {
  const root = repoRoot();
  const args = parseDryRunArgs(argv, defaultDryRunArgs(root));
  if (!args.releaseVersion) throw new Error("publish/cli dry-run: --release-version <semver> is required");
  if (!args.configPath) throw new Error("publish/cli dry-run: --config <path> is required (see pipeline/src/publish/README.md)");

  const config = loadConfig(args.configPath);
  const modelPacks = filterModelPacksByTier(config.modelPacks, args.tiers);
  const outDir = path.join(args.outDir, args.releaseVersion);
  const result = buildReleasePlan({ ...config, modelPacks, releaseVersion: args.releaseVersion, outDir });

  if (!result.ok) {
    throw new Error(`publish/cli dry-run refused: ${result.reason}`);
  }

  console.log(`dry-run ${result.plan.tag}: ${result.plan.assets.length} asset(s) -> ${outDir}`);
  for (const r of result.modelPackResults) {
    console.log(`  model pack ${r.tier}: ${r.status}${r.status === "failed" ? ` (${r.error})` : ""}`);
  }
  if (result.knowledgeDeltaResult) {
    console.log(`  knowledge delta: ${result.knowledgeDeltaResult.status}${result.knowledgeDeltaResult.status === "refused" ? ` (${result.knowledgeDeltaResult.reason})` : ""}`);
  }
}

function runPublish(argv: string[]): void {
  const root = repoRoot();
  const args = parsePublishArgs(argv, defaultPublishArgs(root));
  if (!args.releaseVersion) throw new Error("publish/cli publish: --release-version <semver> is required");
  if (!args.yes) {
    throw new Error("publish/cli publish: refusing to publish without --yes (this uploads real assets to a GitHub Release)");
  }

  const outDir = path.join(args.outDir, args.releaseVersion);
  const planPath = path.join(outDir, "release-manifest.json");
  if (!fs.existsSync(planPath)) {
    throw new Error(`publish/cli publish: no dry-run output at ${planPath} — run \`dry-run\` for this --release-version first`);
  }
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8")) as ReleasePlan;

  publishReleasePlan(plan, { force: args.force }, realCommandRunner);
  console.log(`published ${plan.tag}: ${plan.assets.length} asset(s)`);
}

function main(): void {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === "dry-run") return runDryRun(rest);
  if (mode === "publish") return runPublish(rest);
  throw new Error('publish/cli: first argument must be "dry-run" or "publish"');
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main();
}
