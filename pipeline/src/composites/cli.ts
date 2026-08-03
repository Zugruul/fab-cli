#!/usr/bin/env tsx
/**
 * Synthetic-composite generator CLI (SPEC-APP.md §8.7b, APP-026). Two
 * subcommands:
 *
 *   composites generate [--config <composites-generation.json>]
 *                        [--card-json <card.json>] [--images-cache-dir <dir>]
 *                        [--out <dir>] [--seed <n>]
 *     Plans + renders one run (paramStream.ts + compositor.ts) from
 *     whichever printing images are ALREADY cached under
 *     --images-cache-dir (APP-025's `images:download` output — this CLI
 *     never triggers a new download itself, a separate concern), and
 *     writes composite PNGs + label JSON + a run manifest atomically
 *     (write.ts) to --out (default pipeline/out/composites/, gitignored).
 *
 *   composites sample-sheet [--run-dir <dir>] [--out <path>] [--title <text>]
 *     Builds a human-inspection HTML page (sampleSheet.ts) referencing a
 *     previously-generated run's composites + quad overlays, so a human
 *     can eyeball augmentation quality and label fidelity together.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { validateGeneratorConfig } from "./config.js";
import type { GeneratorConfig } from "./config.js";
import { extractPrintingImageRefs, loadCardsFromFile } from "../images/catalog.js";
import { cachePathFor } from "../images/cache.js";
import { generateDataset } from "./generate.js";
import { writeCompositeRun } from "./write.js";
import { decodeImageToRaw, encodeRawToPng } from "./imageIO.js";
import { buildSampleSheetHtml } from "./sampleSheet.js";
import type { SampleSheetEntry } from "./sampleSheet.js";
import type { CompositeDatasetManifest } from "./manifest.js";
import type { CardImageRef } from "./paramStream.js";
import type { CompositeLabel } from "./types.js";

const BASE = path.join(import.meta.dirname, "..", "..");

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

// --- composites generate -----------------------------------------------

export interface GenerateArgs {
  configPath: string;
  cardJsonPath: string;
  imagesCacheDir: string;
  outDir: string;
  seed: number | null;
}

export function parseGenerateArgs(argv: string[]): GenerateArgs {
  const args: GenerateArgs = {
    configPath: path.join(BASE, "config", "composites-generation.json"),
    cardJsonPath: "",
    imagesCacheDir: path.join(BASE, "out", "images"),
    outDir: path.join(BASE, "out", "composites"),
    seed: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--config" && argv[i + 1]) args.configPath = argv[++i];
    else if (arg === "--card-json" && argv[i + 1]) args.cardJsonPath = argv[++i];
    else if (arg === "--images-cache-dir" && argv[i + 1]) args.imagesCacheDir = argv[++i];
    else if (arg === "--out" && argv[i + 1]) args.outDir = argv[++i];
    else if (arg === "--seed" && argv[i + 1]) args.seed = Number(argv[++i]);
  }
  // Lazy: only shells out to git when --card-json wasn't given, since the
  // vendored card.json lives under fab-cli/, a sibling package, not under
  // pipeline/ (mirrors images/cli.ts's defaultArgs(repoRoot()) pattern).
  if (args.cardJsonPath === "") {
    args.cardJsonPath = path.join(repoRoot(), "fab-cli", "third_party", "flesh-and-blood-cards", "json", "english", "card.json");
  }
  return args;
}

/** Every printing with BOTH a real image_url (catalog.ts's extraction
 * already filters this) AND an already-downloaded cache file — this CLI
 * only ever consumes APP-025's downloader output, never triggers a
 * download itself. */
function resolveAvailableCards(cardJsonPath: string, imagesCacheDir: string): CardImageRef[] {
  const cards = loadCardsFromFile(cardJsonPath);
  const refs = extractPrintingImageRefs(cards);
  const available: CardImageRef[] = [];
  for (const ref of refs) {
    const cachePath = cachePathFor(imagesCacheDir, ref);
    if (fs.existsSync(cachePath)) available.push({ printingId: ref.printingId, imagePath: cachePath });
  }
  return available;
}

export async function generateCommand(argv: string[]): Promise<number> {
  const args = parseGenerateArgs(argv);

  const rawConfig: unknown = JSON.parse(fs.readFileSync(args.configPath, "utf8"));
  const validated = validateGeneratorConfig(rawConfig);
  if (!validated.valid) {
    throw new Error(`composites generate: invalid config at ${args.configPath}: ${validated.errors.join("; ")}`);
  }
  const config: GeneratorConfig = args.seed != null ? { ...validated.config, seed: args.seed } : validated.config;

  const availableCards = resolveAvailableCards(args.cardJsonPath, args.imagesCacheDir);
  if (availableCards.length === 0) {
    throw new Error(
      `composites generate: no cached printing images found under ${args.imagesCacheDir} — run "npm run images:download" first (APP-025)`,
    );
  }

  const { manifest, composites } = await generateDataset(config, availableCards, decodeImageToRaw);
  await writeCompositeRun(args.outDir, composites, manifest, encodeRawToPng);

  console.log(`composites: ${manifest.compositeCount} (seed=${manifest.seed}, configHash=${manifest.generatorConfigHash.slice(0, 12)})`);
  console.log(`available card images: ${availableCards.length}`);
  console.log(`-> ${args.outDir}`);
  return 0;
}

// --- composites sample-sheet ---------------------------------------------

export interface SampleSheetArgs {
  runDir: string;
  out: string;
  title: string;
}

export function parseSampleSheetArgs(argv: string[]): SampleSheetArgs {
  const args: SampleSheetArgs = {
    runDir: path.join(BASE, "out", "composites"),
    out: "",
    title: "Composite sample sheet",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--run-dir" && argv[i + 1]) args.runDir = argv[++i];
    else if (arg === "--out" && argv[i + 1]) args.out = argv[++i];
    else if (arg === "--title" && argv[i + 1]) args.title = argv[++i];
  }
  if (args.out === "") args.out = path.join(args.runDir, "sample-sheet.html");
  return args;
}

export function sampleSheetCommand(argv: string[]): void {
  const args = parseSampleSheetArgs(argv);
  const manifest = JSON.parse(fs.readFileSync(path.join(args.runDir, "manifest.json"), "utf8")) as CompositeDatasetManifest;

  const entries: SampleSheetEntry[] = manifest.composites.map((entry) => {
    const label = JSON.parse(fs.readFileSync(path.join(args.runDir, `${entry.compositeId}.json`), "utf8")) as CompositeLabel;
    return { fileName: entry.fileName, label };
  });

  const html = buildSampleSheetHtml(entries, args.title);
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, html);

  console.log(`sample sheet: ${entries.length} composite(s)`);
  console.log(`-> ${args.out}`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "generate") {
    const code = await generateCommand(rest);
    process.exitCode = code;
    return;
  }
  if (command === "sample-sheet") {
    sampleSheetCommand(rest);
    return;
  }
  console.error(`unknown composites command: ${command ?? "(none)"} — expected "generate" or "sample-sheet"`);
  process.exitCode = 1;
}

// Guarded so importing this module (e.g. from tests, for parseArgs) never
// triggers a real run as a side effect — see eval/cli.ts's matching guard.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
