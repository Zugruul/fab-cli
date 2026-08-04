/**
 * Tournament-broadcast real-capture importer (#256, APP-026 follow-up).
 * Layers exactly ONE new thing on top of importBackgrounds.ts's already-
 * proven decode/EXIF-rotate/normalize/content-hash/dedupe/skip discipline
 * (reused wholesale below, never reimplemented): a per-capture `framing`
 * classification, so a real broadcast-layout composite generator (Phase C)
 * and a human eyeballing the sample sheet (Phase D) both know which
 * imported files are full frames (chrome + play area) vs. play-area-only
 * crops (chrome already cropped away by whoever captured the source).
 *
 * ## Honest constraint (issue #256, restated here since this is the one
 * module that ingests the real captures)
 *
 * These real broadcast screenshots carry NO ground-truth labels. They are
 * calibration/reference material only — Phase B measures chrome/play-area
 * geometry against them, Phase D's sample sheet shows them side by side
 * with synthetic renders for a human to eyeball the realism gap. They must
 * NEVER be fed to `composites generate --backgrounds-dir` (or any other
 * "paste labeled synthetic cards over this photo" path): they already
 * contain real, unlabeled cards, so doing that would produce composites
 * full of unlabeled real cards baked into the "background" — the exact
 * same label-noise hazard #252 fixed for fully-occluded labels, just
 * introduced from the opposite direction (a falsely-empty region that
 * actually has real card content in it). This module writes its output to
 * its own dedicated directory (never `pipeline/out/backgrounds/playmats/`,
 * the directory `--backgrounds-dir` actually reads) specifically so the two
 * can never be pointed at each other by a copy-paste CLI-flag mistake.
 *
 * ## Framing classification — config-driven, not hand-classified
 *
 * `classifyFraming` is a pure function of (width, height, config) — a
 * single aspect-ratio threshold (`config/broadcast-import.json`, committed
 * and documented with the exact measurements it was set from). This is
 * deliberately NOT a per-file lookup table: the brief is explicit that real
 * files must never be hand-classified, since that table would silently go
 * stale the moment new captures are added from the same or a different rig
 * — which is exactly what happened during development: the corpus grew
 * from 37 files (one rig) to 60 (two DIFFERENT physical rigs, Calling
 * Edinburgh + Pro Tour Las Vegas), and the same threshold was re-verified
 * against both independently rather than assumed to generalize. See
 * broadcast-import.json's own doc string for the measured full-broadcast
 * vs. play-area-crop aspect-ratio ranges this threshold sits between, per
 * rig.
 */
import { importBackgrounds } from "./importBackgrounds.js";
import type { ImportBackgroundsIO, SkippedBackground } from "./importBackgrounds.js";

export const CAPTURE_FRAMINGS = ["full-broadcast", "play-area-crop"] as const;
export type CaptureFraming = (typeof CAPTURE_FRAMINGS)[number];

export interface BroadcastImportConfig {
  /** A capture's width/height aspect ratio at or above this value is
   * classified "full-broadcast" (chrome + play area); below it,
   * "play-area-crop" (chrome already cropped away). Inclusive at the
   * boundary — see classifyFraming. */
  fullBroadcastMinAspectRatio: number;
}

export type ValidateBroadcastImportConfigResult = { valid: true; config: BroadcastImportConfig } | { valid: false; errors: string[] };

/** Validates a parsed BroadcastImportConfig JSON object — mirrors this
 * package's existing validate*Config style (config.ts, planZoneLayout.ts):
 * collects every violation rather than stopping at the first. */
export function validateBroadcastImportConfig(raw: unknown): ValidateBroadcastImportConfigResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { valid: false, errors: ["broadcast-import config is not a JSON object"] };
  }
  const r = raw as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof r.fullBroadcastMinAspectRatio !== "number" || r.fullBroadcastMinAspectRatio <= 0) {
    errors.push('"fullBroadcastMinAspectRatio" must be a positive number');
  }
  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, config: { fullBroadcastMinAspectRatio: r.fullBroadcastMinAspectRatio as number } };
}

/**
 * Pure aspect-ratio classification — no fs, no rng, callable directly from
 * a unit test with bare numbers. Inclusive at the threshold: a capture at
 * EXACTLY `fullBroadcastMinAspectRatio` reads as "full-broadcast" (mirrors
 * this codebase's other inclusive-boundary conventions, e.g.
 * minVisibleFraction's `>=`).
 */
export function classifyFraming(width: number, height: number, config: BroadcastImportConfig): CaptureFraming {
  return width / height >= config.fullBroadcastMinAspectRatio ? "full-broadcast" : "play-area-crop";
}

export interface ImportedCapture {
  sourceFile: string;
  outputFileName: string;
  contentHash: string;
  width: number;
  height: number;
  dedupedAgainst: string | null;
  framing: CaptureFraming;
}

export interface ImportCapturesResult {
  imported: ImportedCapture[];
  skipped: SkippedBackground[];
}

/**
 * Imports every recognized-extension file in `sourceDir`, reusing
 * importBackgrounds's exact decode/hash/dedupe/skip behavior unchanged
 * (same `io` contract, same content-hash-named output, same idempotent
 * re-import semantics), then classifies each imported file's `framing`
 * from its own (already-decoded) width/height — no separate decode pass.
 */
export async function importCaptures(
  sourceDir: string,
  outDir: string,
  config: BroadcastImportConfig,
  io: ImportBackgroundsIO,
): Promise<ImportCapturesResult> {
  const base = await importBackgrounds(sourceDir, outDir, io);
  const imported: ImportedCapture[] = base.imported.map((entry) => ({
    ...entry,
    framing: classifyFraming(entry.width, entry.height, config),
  }));
  return { imported, skipped: base.skipped };
}
