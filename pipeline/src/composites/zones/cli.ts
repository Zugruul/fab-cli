#!/usr/bin/env tsx
/**
 * Zone-aware game-state layout CLI (#253):
 *
 *   composites zone-generate [--zone-map <path>] [--playmat <path>]
 *                            [--config <path>] [--card-json <path>]
 *                            [--images-cache-dir <dir>] [--backgrounds-dir <dir>]
 *                            [--out <dir>] [--single-count <n>] [--two-player-count <n>]
 *                            [--seed <n>] [--debug-overlay <path>]
 *                            [--mode single|broadcast]
 *                            [--broadcast-layout <path>] [--broadcast-layouts-dir <dir>]
 *                            [--broadcast-augmentation <path>]
 *                            [--broadcast-count <n>] [--frame-width <n>] [--frame-height <n>]
 *
 *   `--mode broadcast` (#256): builds a tournament-broadcast composite run
 *   instead of the single-mat/two-player run above — --single-count/
 *   --two-player-count are ignored entirely. Reuses the SAME --zone-map/
 *   --config/--playmat (near/far mat planning is otherwise identical, per
 *   #256's brief) plus two new committed configs: the rig pool (measured
 *   chrome/play-area geometry — default --broadcast-layouts-dir
 *   config/broadcast-layouts/, which holds every committed rig; each
 *   composite independently draws which rig it uses, #256 correction —
 *   pass --broadcast-layout <path> instead to pin a run to exactly ONE
 *   rig) and --broadcast-augmentation (sleeve/stack/dice/hand/keystone
 *   knobs, default config/broadcast-augmentation.json). Defaults --out to
 *   out/broadcast-layouts/ (never out/zone-layouts/, so the two modes'
 *   output can never collide) and --frame-width/--frame-height to
 *   2048x1152 (matching the real captures' measured aspect ratio, Phase
 *   B). See generateBroadcastRun.ts for the full pipeline.
 *
 * Wired as a fourth subcommand on the top-level `composites` CLI
 * (composites/cli.ts) — same module, same entry point, per #253's brief.
 * Reads the committed zone map + zone-layout config, loads the vendored
 * catalog, ensures the official card back and the (uncommitted) reference
 * playmat image are cached/imported exactly like real card images
 * (images/downloader.ts, composites/importBackgrounds.ts — no reinvented
 * IO), then delegates all planning/rendering to generateZoneRun.ts and
 * writes the run via the EXISTING writeCompositeRun (write.ts) — the same
 * atomic write, manifest, and sample-sheet compatibility as any other
 * composites run.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { validateZoneMap } from "./zoneMap.js";
import { validateZoneLayoutConfig } from "./planZoneLayout.js";
import type { ZoneLayoutConfig } from "./planZoneLayout.js";
import { loadCardsFromFile } from "../../images/catalog.js";
import { downloadAll, assertDownloadsSucceeded } from "../../images/downloader.js";
import { DEFAULT_DOWNLOAD_OPTIONS } from "../../images/types.js";
import { ensureCardBackCached, CARD_BACK_PRINTING_ID } from "./cardBack.js";
import { generateZoneRun } from "./generateZoneRun.js";
import type { ImageNeed } from "./generateZoneRun.js";
import { decodeImageToRaw, decodeAndNormalizeBackground } from "../imageIO.js";
import { renderZoneOverlay } from "./debugOverlay.js";
import { encodeRawToPng } from "../imageIO.js";
import { writeCompositeRun } from "../write.js";
import { validateBroadcastLayoutConfig, loadBroadcastLayoutConfigsFromDir } from "./broadcastLayout.js";
import type { BroadcastLayoutConfig } from "./broadcastLayout.js";
import { validateBroadcastAugmentationConfig } from "./planBroadcastAugmentation.js";
import type { BroadcastAugmentationConfig } from "./planBroadcastAugmentation.js";
import { generateBroadcastRun } from "./generateBroadcastRun.js";
import { buildBroadcastSampleSheetHtml } from "./broadcastSampleSheet.js";
import type { BroadcastReferenceEntry } from "./broadcastSampleSheet.js";
import type { SampleSheetEntry } from "../sampleSheet.js";
import type { CompositeLabel } from "../types.js";
import type { CompositeDatasetManifest } from "../manifest.js";
import type { ImportCapturesResult } from "../importCaptures.js";

const BASE = path.join(import.meta.dirname, "..", "..", "..");

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

export const ZONE_GENERATE_MODES = ["single", "broadcast"] as const;
export type ZoneGenerateMode = (typeof ZONE_GENERATE_MODES)[number];

export interface ZoneGenerateArgs {
  zoneMapPath: string;
  playmatPath: string;
  configPath: string;
  cardJsonPath: string;
  imagesCacheDir: string;
  backgroundsDir: string;
  outDir: string;
  singleCount: number;
  twoPlayerCount: number;
  seed: number | null;
  debugOverlayOut: string | null;
  /** #256: "single" (default, pre-#256 behavior — plans singleCount +
   * twoPlayerCount composites exactly as before) or "broadcast" (ignores
   * singleCount/twoPlayerCount entirely, generates broadcastCount
   * tournament-broadcast frames instead — see generateBroadcastRun.ts). */
  mode: ZoneGenerateMode;
  /** Explicit single-rig override (`--broadcast-layout <path>`) — pins a
   * run to exactly ONE rig, useful for reproducing/debugging one rig in
   * isolation. `null` (the default) means "draw from the full rig pool at
   * broadcastLayoutsDir instead" (#256 correction, Phase C item #2) —
   * a real run should genuinely mix every configured rig, not silently
   * default to whichever file happens to sort first. */
  broadcastLayoutPath: string | null;
  /** Directory of `*.json` BroadcastLayoutConfig files (#256 correction)
   * — loaded via loadBroadcastLayoutConfigsFromDir, sorted by filename for
   * determinism, and used as the FULL rig pool when broadcastLayoutPath
   * is not set. Defaults to the committed config/broadcast-layouts/ dir,
   * which as of this correction holds both calling-edinburgh.json and
   * pro-tour-las-vegas.json. */
  broadcastLayoutsDir: string;
  broadcastAugmentationPath: string;
  broadcastCount: number;
  frameWidth: number;
  frameHeight: number;
  /** #268 PR #269 review round 1 BLOCKER 2: coverage-driven selection for
   * `--mode single` (the default) — see generateZoneRun.ts's
   * GenerateZoneRunInput.coverage doc for exactly what this does and does
   * NOT cover (selection-only, per-kind, no unavailableUpstream tracking).
   * NOT wired for `--mode broadcast` — that pipeline (generateBroadcastRun.ts)
   * is a documented, deliberate scope gap; see this file's header. */
  coverage: boolean;
}

export function parseZoneGenerateArgs(argv: string[]): ZoneGenerateArgs {
  // Pre-scan for --mode: the default --out value depends on it (a
  // broadcast run must never default into plain zone-generate's
  // out/zone-layouts/ dir, or vice versa), so mode has to be known before
  // the defaults object below is constructed.
  const modeFlagIndex = argv.indexOf("--mode");
  const requestedMode: ZoneGenerateMode = modeFlagIndex !== -1 && argv[modeFlagIndex + 1] === "broadcast" ? "broadcast" : "single";

  const args: ZoneGenerateArgs = {
    zoneMapPath: path.join(BASE, "config", "zone-maps", "combat-chain-playmat.json"),
    playmatPath: path.join(BASE, "out", "zone-reference-playmat.png"),
    configPath: path.join(BASE, "config", "zone-layout-generation.json"),
    cardJsonPath: "",
    imagesCacheDir: path.join(BASE, "out", "images"),
    backgroundsDir: path.join(BASE, "out", "backgrounds", "playmats"),
    outDir: path.join(BASE, "out", requestedMode === "broadcast" ? "broadcast-layouts" : "zone-layouts"),
    singleCount: 24,
    twoPlayerCount: 1,
    seed: null,
    debugOverlayOut: null,
    mode: requestedMode,
    broadcastLayoutPath: null,
    broadcastLayoutsDir: path.join(BASE, "config", "broadcast-layouts"),
    broadcastAugmentationPath: path.join(BASE, "config", "broadcast-augmentation.json"),
    // Landscape, matching the measured real-capture aspect ratio (Phase B:
    // full-broadcast captures measured ~1.75-1.80) — 2048x1152 = 1.778.
    broadcastCount: 8,
    frameWidth: 2048,
    frameHeight: 1152,
    coverage: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--zone-map" && argv[i + 1]) args.zoneMapPath = argv[++i];
    else if (arg === "--playmat" && argv[i + 1]) args.playmatPath = argv[++i];
    else if (arg === "--config" && argv[i + 1]) args.configPath = argv[++i];
    else if (arg === "--card-json" && argv[i + 1]) args.cardJsonPath = argv[++i];
    else if (arg === "--images-cache-dir" && argv[i + 1]) args.imagesCacheDir = argv[++i];
    else if (arg === "--backgrounds-dir" && argv[i + 1]) args.backgroundsDir = argv[++i];
    else if (arg === "--out" && argv[i + 1]) args.outDir = argv[++i];
    else if (arg === "--single-count" && argv[i + 1]) args.singleCount = Number(argv[++i]);
    else if (arg === "--two-player-count" && argv[i + 1]) args.twoPlayerCount = Number(argv[++i]);
    else if (arg === "--seed" && argv[i + 1]) args.seed = Number(argv[++i]);
    else if (arg === "--debug-overlay" && argv[i + 1]) args.debugOverlayOut = argv[++i];
    else if (arg === "--mode" && argv[i + 1]) args.mode = argv[++i] === "broadcast" ? "broadcast" : "single";
    else if (arg === "--broadcast-layout" && argv[i + 1]) args.broadcastLayoutPath = argv[++i];
    else if (arg === "--broadcast-layouts-dir" && argv[i + 1]) args.broadcastLayoutsDir = argv[++i];
    else if (arg === "--broadcast-augmentation" && argv[i + 1]) args.broadcastAugmentationPath = argv[++i];
    else if (arg === "--broadcast-count" && argv[i + 1]) args.broadcastCount = Number(argv[++i]);
    else if (arg === "--frame-width" && argv[i + 1]) args.frameWidth = Number(argv[++i]);
    else if (arg === "--frame-height" && argv[i + 1]) args.frameHeight = Number(argv[++i]);
    else if (arg === "--coverage") args.coverage = true;
  }
  if (args.cardJsonPath === "") {
    args.cardJsonPath = path.join(repoRoot(), "fab-cli", "third_party", "flesh-and-blood-cards", "json", "english", "card.json");
  }
  return args;
}

/** Real fetch/fs deps for images/downloader.ts — same wiring as
 * images/cli.ts, reused verbatim for both the card-back fetch and the
 * per-run catalog-image downloads below. */
function realDownloadDeps() {
  return {
    fetchFn: (url: string) =>
      fetch(url, { headers: { "User-Agent": "fab-companion-app-pipeline/0.1 (+training-host dataset builder, #253)" } }),
    fileExists: (p: string) => fs.existsSync(p),
    writeFile: (p: string, data: Buffer) => fs.writeFileSync(p, data),
    rename: (from: string, to: string) => fs.renameSync(from, to),
    ensureDir: (d: string) => fs.mkdirSync(d, { recursive: true }),
  };
}

/**
 * Imports the single reference playmat file into `backgroundsDir` using
 * the same content-hash-named convention as importBackgrounds.ts (a
 * dedicated single-file path rather than reusing importBackgrounds.ts's
 * own directory-scanning entry point, since the playmat lives alongside
 * unrelated files under pipeline/out/ — scanning that whole directory
 * would sweep up anything else with an image extension). Idempotent: a
 * re-run with unchanged playmat bytes produces the same hash and is a
 * cheap no-op write.
 */
async function importSinglePlaymat(playmatPath: string, backgroundsDir: string): Promise<{ fileName: string; contentHash: string }> {
  const normalized = await decodeAndNormalizeBackground(playmatPath);
  const contentHash = createHash("sha256").update(normalized.png).digest("hex").slice(0, 16);
  const fileName = `${contentHash}.png`;
  fs.mkdirSync(backgroundsDir, { recursive: true });
  const destPath = path.join(backgroundsDir, fileName);
  if (!fs.existsSync(destPath)) fs.writeFileSync(destPath, normalized.png);
  return { fileName, contentHash };
}

export async function zoneGenerateCommand(argv: string[]): Promise<number> {
  const args = parseZoneGenerateArgs(argv);

  const rawZoneMap: unknown = JSON.parse(fs.readFileSync(args.zoneMapPath, "utf8"));
  const zoneMapResult = validateZoneMap(rawZoneMap);
  if (!zoneMapResult.valid) {
    throw new Error(`composites zone-generate: invalid zone map at ${args.zoneMapPath}: ${zoneMapResult.errors.join("; ")}`);
  }

  const rawConfig: unknown = JSON.parse(fs.readFileSync(args.configPath, "utf8"));
  const configResult = validateZoneLayoutConfig(rawConfig);
  if (!configResult.valid) {
    throw new Error(`composites zone-generate: invalid config at ${args.configPath}: ${configResult.errors.join("; ")}`);
  }
  let config: ZoneLayoutConfig = configResult.config;
  if (args.seed != null) config = { ...config, seed: args.seed };

  const cards = loadCardsFromFile(args.cardJsonPath);

  const deps = realDownloadDeps();
  const cardBackImagePath = await ensureCardBackCached(args.imagesCacheDir, deps);

  const { fileName, contentHash } = await importSinglePlaymat(args.playmatPath, args.backgroundsDir);
  const loadedBackground = await decodeImageToRaw(path.join(args.backgroundsDir, fileName));

  if (args.debugOverlayOut) {
    const overlay = renderZoneOverlay(loadedBackground, zoneMapResult.map);
    const png = await encodeRawToPng(overlay);
    fs.mkdirSync(path.dirname(args.debugOverlayOut), { recursive: true });
    fs.writeFileSync(args.debugOverlayOut, png);
    console.log(`zone overlay check image -> ${args.debugOverlayOut}`);
  }

  const ensureImagesDownloaded = async (needs: ImageNeed[]) => {
    const outcomes = await downloadAll(
      needs.map((n) => ({ printingId: n.printingId, imageUrl: n.imageUrl, printCode: "", cardName: "", setId: "" })),
      { ...DEFAULT_DOWNLOAD_OPTIONS, cacheDir: args.imagesCacheDir },
      deps,
    );
    // #256 real-data-run finding: a discarded downloadAll() result means a
    // permanently-failed printing (e.g. a real S3 403) silently proceeds
    // to a much more confusing crash later (a raw sharp "Input file is
    // missing" error) instead of a clear, actionable message here.
    assertDownloadsSucceeded(outcomes);
  };

  if (args.mode === "broadcast") {
    // #256 correction (Phase C, item #2): a real run must draw from EVERY
    // configured rig, not just whichever one happened to be hardcoded —
    // `--broadcast-layout <path>` still pins a run to exactly one rig
    // (useful for reproducing/debugging a single rig in isolation), but
    // the default is the FULL pool at broadcastLayoutsDir, loaded via the
    // same validated, sorted-for-determinism loader
    // loadBroadcastLayoutConfigsFromDir already provides.
    let layouts: BroadcastLayoutConfig[];
    if (args.broadcastLayoutPath) {
      const rawLayout: unknown = JSON.parse(fs.readFileSync(args.broadcastLayoutPath, "utf8"));
      const layoutResult = validateBroadcastLayoutConfig(rawLayout);
      if (!layoutResult.valid) {
        throw new Error(`composites zone-generate --mode broadcast: invalid broadcast-layout config at ${args.broadcastLayoutPath}: ${layoutResult.errors.join("; ")}`);
      }
      layouts = [layoutResult.config];
    } else {
      layouts = loadBroadcastLayoutConfigsFromDir(args.broadcastLayoutsDir, {
        listFiles: (dir) => fs.readdirSync(dir),
        readFile: (p) => fs.readFileSync(p, "utf8"),
      });
    }

    const rawAugmentation: unknown = JSON.parse(fs.readFileSync(args.broadcastAugmentationPath, "utf8"));
    const augmentationResult = validateBroadcastAugmentationConfig(rawAugmentation);
    if (!augmentationResult.valid) {
      throw new Error(
        `composites zone-generate --mode broadcast: invalid broadcast-augmentation config at ${args.broadcastAugmentationPath}: ${augmentationResult.errors.join("; ")}`,
      );
    }
    const augmentationConfig: BroadcastAugmentationConfig = augmentationResult.config;

    const { manifest, composites } = await generateBroadcastRun({
      zoneLayoutConfig: config,
      augmentationConfig,
      layouts,
      zoneMap: zoneMapResult.map,
      cards,
      imagesCacheDir: args.imagesCacheDir,
      loadImage: decodeImageToRaw,
      ensureImagesDownloaded,
      loadedBackground,
      cardBackImagePath,
      cardBackPrintingId: CARD_BACK_PRINTING_ID,
      matWidth: loadedBackground.width,
      matHeight: loadedBackground.height,
      background: { fileName, contentHash },
      frameWidth: args.frameWidth,
      frameHeight: args.frameHeight,
      count: args.broadcastCount,
    });

    await writeCompositeRun(args.outDir, composites, manifest, encodeRawToPng);

    console.log(`broadcast composites: ${manifest.compositeCount} (${args.frameWidth}x${args.frameHeight})`);
    console.log(`seed=${manifest.seed}, configHash=${manifest.generatorConfigHash.slice(0, 12)}`);
    console.log(`-> ${args.outDir}`);
    return 0;
  }

  const { manifest, composites, coverageSummary } = await generateZoneRun({
    config,
    zoneMap: zoneMapResult.map,
    cards,
    imagesCacheDir: args.imagesCacheDir,
    loadImage: decodeImageToRaw,
    ensureImagesDownloaded,
    loadedBackground,
    cardBackImagePath,
    cardBackPrintingId: CARD_BACK_PRINTING_ID,
    matWidth: loadedBackground.width,
    matHeight: loadedBackground.height,
    background: { fileName, contentHash },
    singleCount: args.singleCount,
    twoPlayerCount: args.twoPlayerCount,
    coverage: args.coverage,
  });

  await writeCompositeRun(args.outDir, composites, manifest, encodeRawToPng);

  if (coverageSummary) {
    fs.writeFileSync(path.join(args.outDir, "zone-coverage-report.json"), JSON.stringify(coverageSummary, null, 2) + "\n");
    for (const [kind, summary] of Object.entries(coverageSummary)) {
      console.log(`coverage[${kind}]: ${summary.poolSize} eligible, min=${summary.minAppearances} max=${summary.maxAppearances}, ${summary.zeroAppearanceCount} never placed`);
    }
  }

  console.log(`zone-layout composites: ${manifest.compositeCount} (${args.singleCount} single-mat + ${args.twoPlayerCount} two-player)`);
  console.log(`seed=${manifest.seed}, configHash=${manifest.generatorConfigHash.slice(0, 12)}`);
  console.log(`-> ${args.outDir}`);
  return 0;
}

// --- composites broadcast-sample-sheet ------------------------------------

export interface BroadcastSampleSheetArgs {
  runDir: string;
  capturesDir: string;
  out: string;
  title: string;
  /** Caps how many real reference captures are interleaved (#256 Phase D)
   * — a full 60-capture corpus would otherwise dwarf a modest synthetic
   * run in the sheet; capped, not because more is wrong, just to keep the
   * sheet a reasonable size for a human to actually scroll through. */
  referenceCount: number;
}

export function parseBroadcastSampleSheetArgs(argv: string[]): BroadcastSampleSheetArgs {
  const args: BroadcastSampleSheetArgs = {
    runDir: path.join(BASE, "out", "broadcast-layouts"),
    capturesDir: path.join(BASE, "out", "backgrounds", "captures"),
    out: "",
    title: "Broadcast composite sample sheet",
    referenceCount: 12,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--run-dir" && argv[i + 1]) args.runDir = argv[++i];
    else if (arg === "--captures-dir" && argv[i + 1]) args.capturesDir = argv[++i];
    else if (arg === "--out" && argv[i + 1]) args.out = argv[++i];
    else if (arg === "--title" && argv[i + 1]) args.title = argv[++i];
    else if (arg === "--reference-count" && argv[i + 1]) args.referenceCount = Number(argv[++i]);
  }
  if (args.out === "") args.out = path.join(args.runDir, "broadcast-sample-sheet.html");
  return args;
}

/** Relative path from the sheet's own output file to a source image
 * elsewhere on disk — the sheet's <img src> must resolve correctly
 * regardless of whether runDir/capturesDir/out live in different
 * directories (the common case: a broadcast run and an import-captures
 * run are independent commands with independent --out defaults). */
function relativeToSheet(outPath: string, filePath: string): string {
  return path.relative(path.dirname(outPath), filePath).split(path.sep).join("/");
}

export function broadcastSampleSheetCommand(argv: string[]): void {
  const args = parseBroadcastSampleSheetArgs(argv);

  const manifest = JSON.parse(fs.readFileSync(path.join(args.runDir, "manifest.json"), "utf8")) as CompositeDatasetManifest;
  const syntheticEntries: SampleSheetEntry[] = manifest.composites.map((entry) => {
    const label = JSON.parse(fs.readFileSync(path.join(args.runDir, `${entry.compositeId}.json`), "utf8")) as CompositeLabel;
    return { fileName: relativeToSheet(args.out, path.join(args.runDir, entry.fileName)), label };
  });

  let referenceEntries: BroadcastReferenceEntry[] = [];
  const capturesManifestPath = path.join(args.capturesDir, "manifest.json");
  if (fs.existsSync(capturesManifestPath)) {
    const capturesManifest = JSON.parse(fs.readFileSync(capturesManifestPath, "utf8")) as ImportCapturesResult;
    referenceEntries = capturesManifest.imported.slice(0, args.referenceCount).map((c) => ({
      fileName: relativeToSheet(args.out, path.join(args.capturesDir, c.outputFileName)),
      framing: c.framing,
    }));
  } else {
    console.log(`(no captures manifest found at ${capturesManifestPath} — sheet will have no REFERENCE tiles; run "composites import-captures" first)`);
  }

  const html = buildBroadcastSampleSheetHtml(syntheticEntries, referenceEntries, args.title);
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, html);

  console.log(`broadcast sample sheet: ${syntheticEntries.length} synthetic + ${referenceEntries.length} reference tile(s)`);
  console.log(`-> ${args.out}`);
}
