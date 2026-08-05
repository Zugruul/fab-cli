import fs from "node:fs";
import path from "node:path";
import { buildBenchmarkManifest } from "./manifest.js";
import { decodeImageToRaw } from "../composites/imageIO.js";
import type { BenchmarkManifest, RawPhotoEntry } from "./manifest.js";

const PHOTO_EXTENSIONS = [".jpg", ".jpeg", ".png", ".heic", ".webp"];

export interface LoadedBenchmarkPhotoSet {
  entries: RawPhotoEntry[];
  /** Relative photo paths (same scheme as entries[].fileName) that had no
   * matching label file under labelsDir — reported, never silently
   * dropped. */
  missingLabels: string[];
}

/**
 * Walks `photosDir` recursively for photo files, pairing each with a
 * same-relative-path `.json` label file under `labelsDir` (e.g.
 * `field/photo-001.jpg` <-> `<labelsDir>/field/photo-001.json`). A photo
 * with no matching label file is recorded in `missingLabels` rather than
 * silently skipped; a label file that isn't valid JSON is carried through
 * as a `labelParseError` entry (see manifest.ts, which handles both
 * outcomes as `skipped` reasons).
 */
export function loadBenchmarkPhotoSet(photosDir: string, labelsDir: string): LoadedBenchmarkPhotoSet {
  const entries: RawPhotoEntry[] = [];
  const missingLabels: string[] = [];

  for (const relPath of walkPhotoFiles(photosDir)) {
    const photoBytes = fs.readFileSync(path.join(photosDir, relPath));
    const labelRelPath = relPath.replace(/\.[^./]+$/, ".json");

    let labelBytes: Buffer;
    try {
      labelBytes = fs.readFileSync(path.join(labelsDir, labelRelPath));
    } catch {
      missingLabels.push(relPath);
      continue;
    }

    try {
      const labelRaw = JSON.parse(labelBytes.toString("utf8"));
      entries.push({ fileName: relPath, photoBytes, labelBytes, labelRaw });
    } catch (err) {
      entries.push({
        fileName: relPath,
        photoBytes,
        labelBytes,
        labelParseError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { entries, missingLabels };
}

/**
 * Decodes each entry's REAL photo bytes (composites/imageIO.ts's
 * decodeImageToRaw — the same EXIF-aware decoder #286 fixed) and attaches
 * the resulting (displayed/EXIF-applied) width/height, so
 * buildBenchmarkManifest's validateLabelFrame check has a real frame to
 * compare each label's declared `orientation` against (#286: this is what
 * lets `npm run benchmark:manifest`, not just the export path, catch a
 * label authored against the wrong frame).
 *
 * Only attempts entries with a parseable label (labelRaw present) — an
 * entry with a parse error is already going to be skipped for that reason
 * alone, decoding its photo would be wasted work. A decode failure (the
 * bytes aren't a real image — this never happens for real photos, only
 * for lightweight non-image fixtures some tests use) is caught per-entry
 * and left unset, never thrown, never aborting the batch: the same "one
 * bad photo never blocks the rest" discipline as the rest of this file.
 */
export async function attachFrameDimensions(entries: RawPhotoEntry[]): Promise<void> {
  await Promise.all(
    entries.map(async (entry) => {
      if (entry.labelRaw === undefined) return;
      try {
        const { width, height } = await decodeImageToRaw(entry.photoBytes);
        entry.frameWidth = width;
        entry.frameHeight = height;
      } catch {
        // Not a real decodable image — frame check simply doesn't run for
        // this entry (see doc comment above).
      }
    }),
  );
}

/** Loads a photos+labels dir pair and builds its manifest in one call — the
 * CLI's main entry point. A photo missing its label file is folded into
 * the manifest's `skipped` list (reason: "no matching label file") so the
 * whole set's health is visible from the manifest alone. */
export async function buildManifestFromDirs(
  photosDir: string,
  labelsDir: string,
  now?: () => string,
): Promise<{ manifest: BenchmarkManifest; missingLabels: string[] }> {
  const { entries, missingLabels } = loadBenchmarkPhotoSet(photosDir, labelsDir);
  await attachFrameDimensions(entries);
  const manifest = buildBenchmarkManifest({ entries, now });
  manifest.skipped.push(...missingLabels.map((fileName) => ({ fileName, reason: "no matching label file" })));
  return { manifest, missingLabels };
}

function* walkPhotoFiles(dir: string, base = dir): Generator<string> {
  let dirEntries: fs.Dirent[];
  try {
    dirEntries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of dirEntries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkPhotoFiles(full, base);
    } else if (entry.isFile() && PHOTO_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
      yield path.relative(base, full).replace(/\\/g, "/");
    }
  }
}
