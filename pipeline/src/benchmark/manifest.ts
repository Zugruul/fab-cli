import crypto from "node:crypto";
import { LABEL_SCHEMA_VERSION, QUAD_TAGS, SCENE_TYPES } from "./types.js";
import { validatePhotoLabel, validateLabelFrame, validateLabelBounds } from "./validate.js";
import type { Orientation, QuadTag, SceneType } from "./types.js";

/** Bumped whenever the manifest's own shape changes (new/removed field,
 * changed count semantics) — independent of LABEL_SCHEMA_VERSION, which
 * versions the per-photo label file shape instead. */
export const BENCHMARK_SCHEMA_VERSION = "0.1.0";

/** One already-loaded photo+label pair, or a label that failed to parse.
 * IO (walking directories, reading files) lives in loadSet.ts — this is the
 * pure input shape the builder consumes so it's unit-testable with
 * in-memory Buffers (see benchmark.manifest.test.ts). */
export interface RawPhotoEntry {
  /** Path of the photo file, relative to the photos dir. */
  fileName: string;
  photoBytes: Buffer;
  /** The label file's raw on-disk bytes — hashed as-is (never a
   * re-serialization of labelRaw, which could differ in formatting). */
  labelBytes: Buffer;
  /** JSON.parse(labelBytes) result — present iff labelParseError is absent. */
  labelRaw?: unknown;
  /** Set instead of labelRaw when the label file wasn't valid JSON. */
  labelParseError?: string;
  /** Real, decoded (EXIF-applied) photo dimensions (#286) — attached by
   * loadSet.ts's `attachFrameDimensions`, NOT computed here (this module
   * stays pure/sync, unit-testable with in-memory Buffers, per this
   * interface's own header). Absent means "not decoded" (e.g. photoBytes
   * isn't a real image, as in several lightweight fixtures in this
   * file's own tests) — the frame-consistency check below is silently
   * skipped in that case, never treated as a violation. */
  frameWidth?: number;
  frameHeight?: number;
}

export interface BenchmarkPhotoManifestEntry {
  photoId: string;
  fileName: string;
  sceneType: SceneType;
  orientation: Orientation;
  quadCount: number;
  photoContentHash: string;
  labelFileHash: string;
}

export interface BenchmarkManifest {
  schemaVersion: string;
  labelSchemaVersion: string;
  buildDate: string;
  photoCount: number;
  countsBySceneType: Record<SceneType, number>;
  /** Count of quads carrying each tag, across every valid photo — a quad
   * with multiple tags counts once per tag it carries. */
  countsByTag: Record<QuadTag, number>;
  photos: BenchmarkPhotoManifestEntry[];
  /** Entries excluded from the set (parse error or failed label
   * validation), each with why — always present, possibly empty, so a
   * degraded build is visible rather than silently under-counting. */
  skipped: { fileName: string; reason: string }[];
}

export function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export interface BuildBenchmarkManifestOptions {
  entries: RawPhotoEntry[];
  now?: () => string;
}

/**
 * Builds a versioned {@link BenchmarkManifest} from already-loaded photo+
 * label entries (SPEC-APP.md §7.7-style versioning, mirrors dataset/
 * manifest.ts). Each entry is validated independently — a parse error or a
 * failed validatePhotoLabel() check skips just that one entry (recorded in
 * `skipped`), never aborting the whole build.
 */
export function buildBenchmarkManifest(opts: BuildBenchmarkManifestOptions): BenchmarkManifest {
  const now = opts.now ?? (() => new Date().toISOString());

  const photos: BenchmarkPhotoManifestEntry[] = [];
  const skipped: { fileName: string; reason: string }[] = [];
  const countsBySceneType = Object.fromEntries(SCENE_TYPES.map((s) => [s, 0])) as Record<SceneType, number>;
  const countsByTag = Object.fromEntries(QUAD_TAGS.map((t) => [t, 0])) as Record<QuadTag, number>;

  for (const entry of opts.entries) {
    if (entry.labelParseError) {
      skipped.push({ fileName: entry.fileName, reason: `invalid JSON: ${entry.labelParseError}` });
      continue;
    }

    const result = validatePhotoLabel(entry.labelRaw);
    if (!result.valid) {
      skipped.push({ fileName: entry.fileName, reason: result.errors.join("; ") });
      continue;
    }

    const label = result.label;

    // #286: cross-check the declared frame against the real decoded one,
    // when a caller has attached it (see RawPhotoEntry.frameWidth's doc
    // comment above for why this is optional/pre-computed rather than
    // decoded here).
    if (entry.frameWidth !== undefined && entry.frameHeight !== undefined) {
      const frameErrors = validateLabelFrame(label, entry.frameWidth, entry.frameHeight);
      if (frameErrors.length > 0) {
        skipped.push({ fileName: entry.fileName, reason: frameErrors.join("; ") });
        continue;
      }
      // #286 review round 2: the bounds-corruption backstop, alongside the
      // orientation check above (see validateLabelBounds's doc comment for
      // why this is a separate, much more generously-margined check).
      const boundsErrors = validateLabelBounds(label, entry.frameWidth, entry.frameHeight);
      if (boundsErrors.length > 0) {
        skipped.push({ fileName: entry.fileName, reason: boundsErrors.join("; ") });
        continue;
      }
    }

    photos.push({
      photoId: label.photoId,
      fileName: entry.fileName,
      sceneType: label.sceneType,
      orientation: label.orientation,
      quadCount: label.quads.length,
      photoContentHash: sha256(entry.photoBytes),
      labelFileHash: sha256(entry.labelBytes),
    });

    countsBySceneType[label.sceneType]++;
    for (const quad of label.quads) {
      for (const tag of quad.tags) countsByTag[tag]++;
    }
  }

  return {
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    labelSchemaVersion: LABEL_SCHEMA_VERSION,
    buildDate: now(),
    photoCount: photos.length,
    countsBySceneType,
    countsByTag,
    photos,
    skipped,
  };
}
