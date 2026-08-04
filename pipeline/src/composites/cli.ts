#!/usr/bin/env tsx
/**
 * Synthetic-composite generator CLI (SPEC-APP.md §8.7b, APP-026, #244).
 * Three subcommands:
 *
 *   composites generate [--config <composites-generation.json>]
 *                        [--card-json <card.json>] [--images-cache-dir <dir>]
 *                        [--out <dir>] [--seed <n>]
 *                        [--backgrounds-dir <dir>] [--external-background-probability <p>]
 *     Plans + renders one run (paramStream.ts + compositor.ts) from
 *     whichever printing images are ALREADY cached under
 *     --images-cache-dir (APP-025's `images:download` output — this CLI
 *     never triggers a new download itself, a separate concern), and
 *     writes composite PNGs + label JSON + a run manifest atomically
 *     (write.ts) to --out (default pipeline/out/composites/, gitignored).
 *     `--backgrounds-dir`/`--external-background-probability` override the
 *     config file's `backgroundsDir`/`externalBackgroundProbability`
 *     fields, same "explicit override, no silent default" pattern as
 *     `--seed` (#244). When config.backgroundsDir resolves to zero usable
 *     images, this is a LOUD failure (the user explicitly configured it —
 *     see resolveAvailableBackgrounds), never a silent procedural fallback.
 *
 *   composites import-backgrounds --source <dir> [--out <dir>]
 *     Normalizes a directory of real background/playmat photos (#244,
 *     importBackgrounds.ts) into canonical, content-hash-named PNGs under
 *     --out (default pipeline/out/backgrounds/playmats/, gitignored — see
 *     test/noCommitGuard.test.ts) — the dir consumed by `generate`'s
 *     `--backgrounds-dir`.
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
import { decodeImageToRaw, encodeRawToPng, decodeAndNormalizeBackground } from "./imageIO.js";
import { loadExternalBackgroundRefs } from "./background.js";
import { importBackgrounds } from "./importBackgrounds.js";
import { buildSampleSheetHtml } from "./sampleSheet.js";
import type { SampleSheetEntry } from "./sampleSheet.js";
import type { CompositeDatasetManifest } from "./manifest.js";
import type { CardImageRef } from "./paramStream.js";
import type { CompositeLabel } from "./types.js";
import { zoneGenerateCommand } from "./zones/cli.js";

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
  /** #244: undefined = "no CLI override, use whatever the config file
   * says" — distinct from null, which is a legitimate config VALUE
   * ("no external backgrounds"). Mirrors --seed's override pattern. */
  backgroundsDir: string | null | undefined;
  externalBackgroundProbability: number | null;
}

export function parseGenerateArgs(argv: string[]): GenerateArgs {
  const args: GenerateArgs = {
    configPath: path.join(BASE, "config", "composites-generation.json"),
    cardJsonPath: "",
    imagesCacheDir: path.join(BASE, "out", "images"),
    outDir: path.join(BASE, "out", "composites"),
    seed: null,
    backgroundsDir: undefined,
    externalBackgroundProbability: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--config" && argv[i + 1]) args.configPath = argv[++i];
    else if (arg === "--card-json" && argv[i + 1]) args.cardJsonPath = argv[++i];
    else if (arg === "--images-cache-dir" && argv[i + 1]) args.imagesCacheDir = argv[++i];
    else if (arg === "--out" && argv[i + 1]) args.outDir = argv[++i];
    else if (arg === "--seed" && argv[i + 1]) args.seed = Number(argv[++i]);
    else if (arg === "--backgrounds-dir" && argv[i + 1]) args.backgroundsDir = argv[++i];
    else if (arg === "--external-background-probability" && argv[i + 1]) args.externalBackgroundProbability = Number(argv[++i]);
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

/**
 * Resolves the sorted list of usable background FILE NAMES (not full
 * paths — see background.ts's loadExternalBackgroundRefs) for a run.
 *
 * Boundary decision (#244): a null backgroundsDir means "no external
 * backgrounds, procedural only" — silent, the expected default. A
 * NON-null backgroundsDir that resolves to zero usable files (missing
 * dir, unreadable, or genuinely empty/all-corrupt) is instead a LOUD
 * failure: the user explicitly configured this directory, so silently
 * falling back to procedural-only would silently drop content they asked
 * for.
 */
function resolveAvailableBackgrounds(backgroundsDir: string | null): string[] {
  if (backgroundsDir === null) return [];
  const files = loadExternalBackgroundRefs(backgroundsDir);
  if (files.length === 0) {
    throw new Error(
      `composites generate: backgroundsDir is set to "${backgroundsDir}" but no usable background images ` +
        `(.jpg/.jpeg/.png/.webp) were found there — run "composites import-backgrounds --source <dir>" first, ` +
        `or set backgroundsDir to null in the config`,
    );
  }
  return files;
}

export async function generateCommand(argv: string[]): Promise<number> {
  const args = parseGenerateArgs(argv);

  const rawConfig: unknown = JSON.parse(fs.readFileSync(args.configPath, "utf8"));
  const validated = validateGeneratorConfig(rawConfig);
  if (!validated.valid) {
    throw new Error(`composites generate: invalid config at ${args.configPath}: ${validated.errors.join("; ")}`);
  }
  let config: GeneratorConfig = validated.config;
  if (args.seed != null) config = { ...config, seed: args.seed };
  if (args.backgroundsDir !== undefined) config = { ...config, backgroundsDir: args.backgroundsDir };
  if (args.externalBackgroundProbability != null) config = { ...config, externalBackgroundProbability: args.externalBackgroundProbability };

  const availableCards = resolveAvailableCards(args.cardJsonPath, args.imagesCacheDir);
  if (availableCards.length === 0) {
    throw new Error(
      `composites generate: no cached printing images found under ${args.imagesCacheDir} — run "npm run images:download" first (APP-025)`,
    );
  }
  const availableBackgrounds = resolveAvailableBackgrounds(config.backgroundsDir);

  const { manifest, composites } = await generateDataset(config, availableCards, decodeImageToRaw, undefined, availableBackgrounds);
  await writeCompositeRun(args.outDir, composites, manifest, encodeRawToPng);

  console.log(`composites: ${manifest.compositeCount} (seed=${manifest.seed}, configHash=${manifest.generatorConfigHash.slice(0, 12)})`);
  console.log(`available card images: ${availableCards.length}`);
  if (config.backgroundsDir !== null) console.log(`available backgrounds: ${availableBackgrounds.length} (${config.backgroundsDir})`);
  console.log(`-> ${args.outDir}`);
  return 0;
}

// --- composites import-backgrounds --------------------------------------

export interface ImportBackgroundsArgs {
  sourceDir: string;
  outDir: string;
}

export function parseImportBackgroundsArgs(argv: string[]): ImportBackgroundsArgs {
  const args: ImportBackgroundsArgs = {
    sourceDir: "",
    outDir: path.join(BASE, "out", "backgrounds", "playmats"),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--source" && argv[i + 1]) args.sourceDir = argv[++i];
    else if (arg === "--out" && argv[i + 1]) args.outDir = argv[++i];
  }
  if (args.sourceDir === "") {
    throw new Error("composites import-backgrounds: --source <dir> is required");
  }
  return args;
}

export async function importBackgroundsCommand(argv: string[]): Promise<number> {
  const args = parseImportBackgroundsArgs(argv);

  const result = await importBackgrounds(args.sourceDir, args.outDir, {
    normalizeImage: decodeAndNormalizeBackground,
    listDir: (dir) => {
      try {
        return fs.readdirSync(dir);
      } catch (err) {
        throw new Error(`composites import-backgrounds: cannot read source dir "${dir}": ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
    writeFile: (p, data) => fs.writeFileSync(p, data),
  });

  const deduped = result.imported.filter((i) => i.dedupedAgainst !== null);
  console.log(`backgrounds: ${result.imported.length} imported, ${result.skipped.length} skipped`);
  if (deduped.length > 0) {
    console.log(`  (${deduped.length} deduped against an earlier file with identical content)`);
  }
  for (const s of result.skipped) console.log(`  skip: ${s.sourceFile} — ${s.reason}`);
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
  if (command === "import-backgrounds") {
    const code = await importBackgroundsCommand(rest);
    process.exitCode = code;
    return;
  }
  if (command === "sample-sheet") {
    sampleSheetCommand(rest);
    return;
  }
  if (command === "zone-generate") {
    const code = await zoneGenerateCommand(rest);
    process.exitCode = code;
    return;
  }
  console.error(`unknown composites command: ${command ?? "(none)"} — expected "generate", "import-backgrounds", "sample-sheet", or "zone-generate"`);
  process.exitCode = 1;
}

// Guarded so importing this module (e.g. from tests, for parseArgs) never
// triggers a real run as a side effect — see eval/cli.ts's matching guard.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
