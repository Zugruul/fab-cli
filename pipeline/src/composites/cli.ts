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
 *   composites import-captures --source <dir> [--out <dir>] [--config <path>]
 *     Imports real tournament-broadcast screenshots (#256) into
 *     canonical, content-hash-named PNGs under --out (default
 *     pipeline/out/backgrounds/captures/, gitignored — DELIBERATELY a
 *     different directory than import-backgrounds's playmats/ output, see
 *     importCaptures.ts's header for why these must never be pointed at
 *     `generate --backgrounds-dir`), classifying each capture's `framing`
 *     (full-broadcast | play-area-crop) via a config-driven aspect-ratio
 *     threshold (--config, default pipeline/config/broadcast-import.json)
 *     and recording width/height/hash/framing per capture in a manifest.json
 *     alongside the imported PNGs — calibration/reference material for
 *     `--mode broadcast` (Phase B/C), never labeled training data itself.
 *
 *   composites broadcast-sample-sheet [--run-dir <dir>] [--captures-dir <dir>]
 *                                     [--out <path>] [--title <text>] [--reference-count <n>]
 *     Phase D (#256): a DEDICATED sheet interleaving a completed
 *     `zone-generate --mode broadcast` run's synthetic composites (label
 *     overlays, region markers) with real imported captures (--captures-dir,
 *     default pipeline/out/backgrounds/captures/) shown as unlabeled
 *     REFERENCE tiles only — see zones/broadcastSampleSheet.ts. Wired here
 *     (zones/cli.ts) rather than the plain `sample-sheet` above since it
 *     reads TWO independent manifests, not one.
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
import { decodeImageToRaw, encodeRawToPng, encodeRawToJpeg, decodeAndNormalizeBackground } from "./imageIO.js";
import { loadExternalBackgroundRefs } from "./background.js";
import { importBackgrounds } from "./importBackgrounds.js";
import { importCaptures, validateBroadcastImportConfig } from "./importCaptures.js";
import type { BroadcastImportConfig, ImportCapturesResult } from "./importCaptures.js";
import { buildSampleSheetHtml } from "./sampleSheet.js";
import type { SampleSheetEntry } from "./sampleSheet.js";
import type { CompositeDatasetManifest } from "./manifest.js";
import type { CardImageRef } from "./paramStream.js";
import type { CompositeImageFormat } from "./compositor.js";
import type { CompositeLabel } from "./types.js";
import { CoverageTracker } from "./coverageTracker.js";
import { buildCoverageReport } from "./coverageReport.js";
import type { UnavailablePrinting } from "./coverageReport.js";
import { zoneGenerateCommand, broadcastSampleSheetCommand } from "./zones/cli.js";

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
  /** #268: null = "no CLI override, use config.compositesPerRun" — a real
   * coverage run needs a MUCH larger composite budget than the committed
   * default (thousands, to cover the full 16k-printing catalog), so this
   * mirrors --seed's explicit-override pattern rather than requiring a
   * dedicated coverage-run config file. */
  compositesPerRun: number | null;
  /** #268: coverage-driven card selection — every eligible printing
   * guaranteed >= minAppearances placements (budget permitting; see the
   * emitted coverage-report.json for what was actually achieved). false
   * (default) is byte-identical to pre-#268 uniform-random selection. */
  coverage: boolean;
  minAppearances: number;
  /** #268: where downloadCommand's failures manifest lives — read (best-
   * effort; missing file = "no download run has ever failed, or no
   * manifest was ever written") ONLY when --coverage is set, to exclude
   * unavailable-upstream printings from the eligible pool and report them
   * distinctly. Defaults to images/cli.ts's own default location so the
   * two commands agree without the user having to pass this explicitly. */
  downloadFailuresPath: string;
  /** #268 "Also needed for the real run": training composites can use
   * JPEG instead of PNG (~5x smaller; lossless buys nothing for
   * training). "png" (default) is unchanged pre-#268 behavior — sample-
   * sheet/QA output never changes format unless explicitly asked. */
  imageFormat: CompositeImageFormat;
  jpegQuality: number;
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
    compositesPerRun: null,
    coverage: false,
    minAppearances: 1,
    downloadFailuresPath: path.join(BASE, "out", "download-failures.json"),
    imageFormat: "png",
    jpegQuality: 85,
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
    else if (arg === "--composites-per-run" && argv[i + 1]) args.compositesPerRun = Number(argv[++i]);
    else if (arg === "--coverage") args.coverage = true;
    else if (arg === "--min-appearances" && argv[i + 1]) args.minAppearances = Number(argv[++i]);
    else if (arg === "--download-failures" && argv[i + 1]) args.downloadFailuresPath = argv[++i];
    else if (arg === "--format" && argv[i + 1]) args.imageFormat = argv[++i] === "jpeg" ? "jpeg" : "png";
    else if (arg === "--jpeg-quality" && argv[i + 1]) args.jpegQuality = Number(argv[++i]);
  }
  // Lazy: only shells out to git when --card-json wasn't given, since the
  // vendored card.json lives under fab-cli/, a sibling package, not under
  // pipeline/ (mirrors images/cli.ts's defaultArgs(repoRoot()) pattern).
  if (args.cardJsonPath === "") {
    args.cardJsonPath = path.join(repoRoot(), "fab-cli", "third_party", "flesh-and-blood-cards", "json", "english", "card.json");
  }
  return args;
}

/** Best-effort read of the download-failures manifest (images/cli.ts's
 * downloadCommand writes it) — see GenerateArgs.downloadFailuresPath's
 * doc. A missing file is NOT an error (most runs, and every run before
 * #268, never had one); a present-but-unparseable file IS a loud failure,
 * since that indicates real corruption the user should know about rather
 * than a coverage report silently treating every printing as available. */
function loadDownloadFailures(downloadFailuresPath: string): UnavailablePrinting[] {
  if (!fs.existsSync(downloadFailuresPath)) return [];
  const raw = fs.readFileSync(downloadFailuresPath, "utf8");
  try {
    return JSON.parse(raw) as UnavailablePrinting[];
  } catch (err) {
    throw new Error(
      `composites generate: --download-failures manifest at ${downloadFailuresPath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
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
  if (args.compositesPerRun != null) config = { ...config, compositesPerRun: args.compositesPerRun };

  const availableCards = resolveAvailableCards(args.cardJsonPath, args.imagesCacheDir);
  if (availableCards.length === 0) {
    throw new Error(
      `composites generate: no cached printing images found under ${args.imagesCacheDir} — run "npm run images:download" first (APP-025)`,
    );
  }
  const availableBackgrounds = resolveAvailableBackgrounds(config.backgroundsDir);

  // #268: coverage mode threads a fresh CoverageTracker through planRun
  // (index i <-> availableCards[i], see coverageTracker.ts/coverageReport.ts's
  // docs) and, after the run, builds + writes a report distinguishing
  // covered / eligibleButNotPlaced / unavailableUpstream. Coverage-off runs
  // (the default) skip all of this — byte-identical to pre-#268 behavior.
  const coverageTracker = args.coverage ? new CoverageTracker(availableCards.length) : null;

  const { manifest, composites } = await generateDataset(
    config,
    availableCards,
    decodeImageToRaw,
    undefined,
    availableBackgrounds,
    coverageTracker,
    args.imageFormat,
  );
  const encodeImage = args.imageFormat === "jpeg" ? (img: Parameters<typeof encodeRawToJpeg>[0]) => encodeRawToJpeg(img, args.jpegQuality) : encodeRawToPng;
  await writeCompositeRun(args.outDir, composites, manifest, encodeImage);

  if (coverageTracker) {
    // Best-effort: unavailable-upstream printings never entered
    // availableCards in the first place (their download failed, so nothing
    // got cached) — filter the manifest defensively against a stale entry
    // for a printing that HAS since been cached (e.g. a later successful
    // re-download whose manifest overwrite this run happens to predate).
    const availableIds = new Set(availableCards.map((c) => c.printingId));
    const unavailableUpstream = loadDownloadFailures(args.downloadFailuresPath).filter((u) => !availableIds.has(u.printingId));
    const report = buildCoverageReport(availableCards, coverageTracker, args.minAppearances, unavailableUpstream);
    fs.writeFileSync(path.join(args.outDir, "coverage-report.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(
      `coverage: ${report.covered}/${report.totalEligible} eligible printings reached >= ${report.minAppearances} appearances ` +
        `(min=${report.minObservedAppearances}, max=${report.maxObservedAppearances}); ` +
        `${report.eligibleButNotPlaced.length} eligibleButNotPlaced, ${report.unavailableUpstream.length} unavailableUpstream`,
    );
  }

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

// --- composites import-captures ------------------------------------------

export interface ImportCapturesArgs {
  sourceDir: string;
  outDir: string;
  configPath: string;
}

export function parseImportCapturesArgs(argv: string[]): ImportCapturesArgs {
  const args: ImportCapturesArgs = {
    sourceDir: "",
    // Deliberately its OWN directory (captures/, not playmats/) — see this
    // file's header doc and importCaptures.ts's honest-constraint comment
    // for why real broadcast captures must never land where `generate
    // --backgrounds-dir` would find and paste labeled cards over them.
    outDir: path.join(BASE, "out", "backgrounds", "captures"),
    configPath: path.join(BASE, "config", "broadcast-import.json"),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--source" && argv[i + 1]) args.sourceDir = argv[++i];
    else if (arg === "--out" && argv[i + 1]) args.outDir = argv[++i];
    else if (arg === "--config" && argv[i + 1]) args.configPath = argv[++i];
  }
  if (args.sourceDir === "") {
    throw new Error("composites import-captures: --source <dir> is required");
  }
  return args;
}

export async function importCapturesCommand(argv: string[]): Promise<number> {
  const args = parseImportCapturesArgs(argv);

  const rawConfig: unknown = JSON.parse(fs.readFileSync(args.configPath, "utf8"));
  const configResult = validateBroadcastImportConfig(rawConfig);
  if (!configResult.valid) {
    throw new Error(`composites import-captures: invalid config at ${args.configPath}: ${configResult.errors.join("; ")}`);
  }
  const config: BroadcastImportConfig = configResult.config;

  const result: ImportCapturesResult = await importCaptures(args.sourceDir, args.outDir, config, {
    normalizeImage: decodeAndNormalizeBackground,
    listDir: (dir) => {
      try {
        return fs.readdirSync(dir);
      } catch (err) {
        throw new Error(`composites import-captures: cannot read source dir "${dir}": ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
    writeFile: (p, data) => fs.writeFileSync(p, data),
  });

  fs.writeFileSync(path.join(args.outDir, "manifest.json"), JSON.stringify(result, null, 2) + "\n");

  const fullCount = result.imported.filter((c) => c.framing === "full-broadcast").length;
  const cropCount = result.imported.filter((c) => c.framing === "play-area-crop").length;
  const deduped = result.imported.filter((i) => i.dedupedAgainst !== null);
  console.log(`captures: ${result.imported.length} imported (${fullCount} full-broadcast, ${cropCount} play-area-crop), ${result.skipped.length} skipped`);
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
  if (command === "import-captures") {
    const code = await importCapturesCommand(rest);
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
  if (command === "broadcast-sample-sheet") {
    broadcastSampleSheetCommand(rest);
    return;
  }
  console.error(
    `unknown composites command: ${command ?? "(none)"} — expected "generate", "import-backgrounds", "import-captures", "sample-sheet", "zone-generate", or "broadcast-sample-sheet"`,
  );
  process.exitCode = 1;
}

// Guarded so importing this module (e.g. from tests, for parseArgs) never
// triggers a real run as a side effect — see eval/cli.ts's matching guard.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
