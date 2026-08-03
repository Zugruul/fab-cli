#!/usr/bin/env tsx
/**
 * Knowledge-pack builder CLI (SPEC-APP.md §8.8, issue #142/APP-085):
 *
 *   tsx src/knowledge/cli.ts full --version <semver> [flags...]
 *   tsx src/knowledge/cli.ts delta --from <dir> --to <dir> [--out <dir>]
 *
 * `full` reads APP-010's exporter output (pipeline/out/chunks.jsonl +
 * manifest.json), the-fab-cube's printing catalog (or an explicit
 * --printing-ids list), optional text/image embeddings-input files
 * (see textEmbeddingsInput.ts/imageEmbeddingsInput.ts — absent is a
 * first-class, honestly-recorded state, never fabricated), and an APP-022
 * calibration artifact, then writes a full knowledge pack to --out.
 *
 * `delta` reads back two full packs this CLI already built (via
 * build.ts's loadSnapshotFromPackDir) and writes a delta-pack manifest —
 * refusing and exiting non-zero if either embedder version changed
 * between them (SPEC-APP.md §8.8).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadCardsFromFile, extractPrintingImageRefs } from "../images/catalog.js";
import type { Chunk } from "../types.js";
import type { CalibrationArtifact } from "../eval/calibration.js";
import { loadTextEmbeddingsInput } from "./textEmbeddingsInput.js";
import { loadImageEmbeddingsInput } from "./imageEmbeddingsInput.js";
import { buildFullPack, loadSnapshotFromPackDir } from "./build.js";
import { buildDeltaPack } from "./deltaPack.js";
import type { PrintingRegistry } from "./types.js";

export interface FullArgs {
  version: string | null;
  outDir: string;
  chunksPath: string;
  corpusManifestPath: string;
  cardJsonPath: string;
  printingIdsPath: string | null;
  previousRegistryPath: string | null;
  registryVersion: string | null;
  textEmbeddingsPath: string | null;
  imageEmbeddingsPath: string | null;
  calibrationPath: string | null;
}

export interface DeltaArgs {
  fromDir: string | null;
  toDir: string | null;
  outDir: string;
}

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

export function defaultFullArgs(root: string): FullArgs {
  return {
    version: null,
    outDir: path.join(root, "pipeline", "out", "knowledge", "full"),
    chunksPath: path.join(root, "pipeline", "out", "chunks.jsonl"),
    corpusManifestPath: path.join(root, "pipeline", "out", "manifest.json"),
    cardJsonPath: path.join(root, "fab-cli", "third_party", "flesh-and-blood-cards", "json", "english", "card.json"),
    printingIdsPath: null,
    previousRegistryPath: null,
    registryVersion: null,
    textEmbeddingsPath: null,
    imageEmbeddingsPath: null,
    calibrationPath: null,
  };
}

export function parseFullArgs(argv: string[], defaults: FullArgs): FullArgs {
  const args: FullArgs = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--version" && argv[i + 1]) args.version = argv[++i];
    else if (arg === "--out" && argv[i + 1]) args.outDir = argv[++i];
    else if (arg === "--chunks" && argv[i + 1]) args.chunksPath = argv[++i];
    else if (arg === "--corpus-manifest" && argv[i + 1]) args.corpusManifestPath = argv[++i];
    else if (arg === "--card-json" && argv[i + 1]) args.cardJsonPath = argv[++i];
    else if (arg === "--printing-ids" && argv[i + 1]) args.printingIdsPath = argv[++i];
    else if (arg === "--previous-registry" && argv[i + 1]) args.previousRegistryPath = argv[++i];
    else if (arg === "--registry-version" && argv[i + 1]) args.registryVersion = argv[++i];
    else if (arg === "--text-embeddings" && argv[i + 1]) args.textEmbeddingsPath = argv[++i];
    else if (arg === "--image-embeddings" && argv[i + 1]) args.imageEmbeddingsPath = argv[++i];
    else if (arg === "--calibration" && argv[i + 1]) args.calibrationPath = argv[++i];
  }
  return args;
}

export function defaultDeltaArgs(root: string): DeltaArgs {
  return {
    fromDir: null,
    toDir: null,
    outDir: path.join(root, "pipeline", "out", "knowledge", "delta"),
  };
}

export function parseDeltaArgs(argv: string[], defaults: DeltaArgs): DeltaArgs {
  const args: DeltaArgs = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--from" && argv[i + 1]) args.fromDir = argv[++i];
    else if (arg === "--to" && argv[i + 1]) args.toDir = argv[++i];
    else if (arg === "--out" && argv[i + 1]) args.outDir = argv[++i];
  }
  return args;
}

function loadChunksJsonl(chunksPath: string): Chunk[] {
  if (!fs.existsSync(chunksPath)) {
    throw new Error(`knowledge/cli full: chunks file not found at ${chunksPath} — run the corpus exporter first (npm run export)`);
  }
  return fs
    .readFileSync(chunksPath, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Chunk);
}

function loadPrintingIds(args: FullArgs): string[] {
  if (args.printingIdsPath) {
    return JSON.parse(fs.readFileSync(args.printingIdsPath, "utf8")) as string[];
  }
  const cards = loadCardsFromFile(args.cardJsonPath);
  return extractPrintingImageRefs(cards).map((ref) => ref.printingId);
}

function loadPreviousRegistry(args: FullArgs): PrintingRegistry | null {
  if (!args.previousRegistryPath) return null;
  return JSON.parse(fs.readFileSync(args.previousRegistryPath, "utf8")) as PrintingRegistry;
}

function loadCalibration(args: FullArgs, textEmbedderVersion: string, root: string): CalibrationArtifact {
  const calibrationPath =
    args.calibrationPath ?? path.join(root, "pipeline", "eval-runs", "calibration", `${textEmbedderVersion}.json`);
  if (!fs.existsSync(calibrationPath)) {
    throw new Error(
      `knowledge/cli full: no calibration artifact at ${calibrationPath} — run \`eval calibrate --embedder-version ` +
        `${textEmbedderVersion}\` first, or pass --calibration explicitly`,
    );
  }
  return JSON.parse(fs.readFileSync(calibrationPath, "utf8")) as CalibrationArtifact;
}

function readCorpusSnapshotHash(corpusManifestPath: string): string {
  if (!fs.existsSync(corpusManifestPath)) {
    throw new Error(`knowledge/cli full: corpus manifest not found at ${corpusManifestPath} — run the corpus exporter first`);
  }
  const manifest = JSON.parse(fs.readFileSync(corpusManifestPath, "utf8")) as { shippedContentHash?: string };
  if (!manifest.shippedContentHash) {
    throw new Error(`knowledge/cli full: ${corpusManifestPath} has no shippedContentHash`);
  }
  return manifest.shippedContentHash;
}

function runFull(argv: string[]): void {
  const root = repoRoot();
  const args = parseFullArgs(argv, defaultFullArgs(root));
  if (!args.version) throw new Error("knowledge/cli full: --version <semver> is required");

  const chunks = loadChunksJsonl(args.chunksPath);
  const corpusSnapshotHash = readCorpusSnapshotHash(args.corpusManifestPath);
  const printingIds = loadPrintingIds(args);
  const previousRegistry = loadPreviousRegistry(args);
  const textEmbeddings = loadTextEmbeddingsInput(args.textEmbeddingsPath);
  const imageEmbeddings = loadImageEmbeddingsInput(args.imageEmbeddingsPath);
  const calibration = loadCalibration(args, textEmbeddings.embedderVersion, root);

  const result = buildFullPack({
    version: args.version,
    corpusSnapshotHash,
    chunks,
    printingIds,
    previousRegistry,
    registryVersion: args.registryVersion ?? args.version,
    textEmbeddings,
    imageEmbeddings,
    calibration,
    outDir: args.outDir,
  });

  console.log(`knowledge pack ${args.version}: ${result.manifest.chunkCount} chunks, ${result.registry.entries.length} printings -> ${args.outDir}`);
  console.log(`textEmbedderVersion=${result.manifest.textEmbedderVersion} visionEmbedderVersion=${result.manifest.visionEmbedderVersion}`);
  console.log(`retrievalFloor=${result.manifest.retrievalFloor} oodThreshold=${result.manifest.oodThreshold}`);
}

function runDelta(argv: string[]): void {
  const root = repoRoot();
  const args = parseDeltaArgs(argv, defaultDeltaArgs(root));
  if (!args.fromDir || !args.toDir) throw new Error("knowledge/cli delta: --from <dir> and --to <dir> are required");

  const from = loadSnapshotFromPackDir(args.fromDir);
  const to = loadSnapshotFromPackDir(args.toDir);
  const result = buildDeltaPack(from, to);

  if (result.refused) {
    throw new Error(`knowledge/cli delta: ${result.reason}`);
  }

  fs.mkdirSync(args.outDir, { recursive: true });
  fs.writeFileSync(path.join(args.outDir, "manifest.json"), JSON.stringify(result.manifest, null, 2) + "\n");
  console.log(
    `delta ${result.manifest.fromVersion} -> ${result.manifest.toVersion}: +${result.manifest.addedCount} ~${result.manifest.changedCount} ` +
      `-${result.manifest.tombstones.chunkIds.length}chunks/-${result.manifest.tombstones.printingIds.length}printings -> ${args.outDir}`,
  );
}

function main(): void {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === "full") return runFull(rest);
  if (mode === "delta") return runDelta(rest);
  throw new Error('knowledge/cli: first argument must be "full" or "delta"');
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main();
}
