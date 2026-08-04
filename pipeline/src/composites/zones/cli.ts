#!/usr/bin/env tsx
/**
 * Zone-aware game-state layout CLI (#253):
 *
 *   composites zone-generate [--zone-map <path>] [--playmat <path>]
 *                            [--config <path>] [--card-json <path>]
 *                            [--images-cache-dir <dir>] [--backgrounds-dir <dir>]
 *                            [--out <dir>] [--single-count <n>] [--two-player-count <n>]
 *                            [--seed <n>] [--debug-overlay <path>]
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
import { downloadAll } from "../../images/downloader.js";
import { DEFAULT_DOWNLOAD_OPTIONS } from "../../images/types.js";
import { ensureCardBackCached, CARD_BACK_PRINTING_ID } from "./cardBack.js";
import { generateZoneRun } from "./generateZoneRun.js";
import type { ImageNeed } from "./generateZoneRun.js";
import { decodeImageToRaw, decodeAndNormalizeBackground } from "../imageIO.js";
import { renderZoneOverlay } from "./debugOverlay.js";
import { encodeRawToPng } from "../imageIO.js";
import { writeCompositeRun } from "../write.js";

const BASE = path.join(import.meta.dirname, "..", "..", "..");

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

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
}

export function parseZoneGenerateArgs(argv: string[]): ZoneGenerateArgs {
  const args: ZoneGenerateArgs = {
    zoneMapPath: path.join(BASE, "config", "zone-maps", "combat-chain-playmat.json"),
    playmatPath: path.join(BASE, "out", "zone-reference-playmat.png"),
    configPath: path.join(BASE, "config", "zone-layout-generation.json"),
    cardJsonPath: "",
    imagesCacheDir: path.join(BASE, "out", "images"),
    backgroundsDir: path.join(BASE, "out", "backgrounds", "playmats"),
    outDir: path.join(BASE, "out", "zone-layouts"),
    singleCount: 24,
    twoPlayerCount: 1,
    seed: null,
    debugOverlayOut: null,
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

  const { manifest, composites } = await generateZoneRun({
    config,
    zoneMap: zoneMapResult.map,
    cards,
    imagesCacheDir: args.imagesCacheDir,
    loadImage: decodeImageToRaw,
    ensureImagesDownloaded: async (needs: ImageNeed[]) => {
      await downloadAll(
        needs.map((n) => ({ printingId: n.printingId, imageUrl: n.imageUrl, printCode: "", cardName: "", setId: "" })),
        { ...DEFAULT_DOWNLOAD_OPTIONS, cacheDir: args.imagesCacheDir },
        deps,
      );
    },
    loadedBackground,
    cardBackImagePath,
    cardBackPrintingId: CARD_BACK_PRINTING_ID,
    matWidth: loadedBackground.width,
    matHeight: loadedBackground.height,
    background: { fileName, contentHash },
    singleCount: args.singleCount,
    twoPlayerCount: args.twoPlayerCount,
  });

  await writeCompositeRun(args.outDir, composites, manifest, encodeRawToPng);

  console.log(`zone-layout composites: ${manifest.compositeCount} (${args.singleCount} single-mat + ${args.twoPlayerCount} two-player)`);
  console.log(`seed=${manifest.seed}, configHash=${manifest.generatorConfigHash.slice(0, 12)}`);
  console.log(`-> ${args.outDir}`);
  return 0;
}
