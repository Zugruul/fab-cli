/**
 * Playmat/background photo importer (#244): normalizes a directory of
 * user-supplied real background photos (arbitrary jpg/jpeg/png/webp) into
 * canonical PNGs under a content-hash-derived filename, so:
 *   - re-imports are idempotent regardless of source filename churn (the
 *     user adding/renaming/removing files in their source folder never
 *     produces duplicate or stale output for unchanged content)
 *   - two different source files that normalize to identical pixel bytes
 *     collapse to ONE output file — content-hash naming makes this
 *     structural, not a bug: an identical file name is only ever produced
 *     from identical input bytes
 *   - two DIFFERENT contents can never collide at the same name — a real
 *     sha256 collision is not a real-world concern at this corpus size, so
 *     a matching output name is proof of matching content, by construction
 * A corrupt/unreadable/non-image file is skipped with a loud per-file
 * reason (never crashes the batch) — see `NormalizeImageFn`'s contract.
 *
 * IO is fully injected (`ImportBackgroundsIO`) so this module's core logic
 * (hashing, dedupe, skip handling, processing order) is unit-testable
 * without real fs/sharp — see composites.importBackgrounds.test.ts. The
 * real CLI wiring (cli.ts) supplies fs + imageIO.ts's
 * decodeAndNormalizeBackground.
 */
import path from "node:path";
import { sha256 } from "../benchmark/manifest.js";

export interface NormalizedImage {
  png: Buffer;
  width: number;
  height: number;
}

/** Injected IO: decodes+normalizes one source file to a canonical PNG.
 * Must throw on any failure (corrupt file, unsupported format) — caught
 * per-file by importBackgrounds so one bad file never aborts the batch. */
export type NormalizeImageFn = (filePath: string) => Promise<NormalizedImage>;

export interface ImportedBackground {
  sourceFile: string;
  outputFileName: string;
  /** First 16 hex chars of the normalized PNG's sha256 — matches
   * outputFileName's stem exactly. */
  contentHash: string;
  width: number;
  height: number;
  /** The earlier sourceFile this exact content (by hash) was already
   * produced from in THIS SAME import run — null when this is the first
   * source file to produce this content. */
  dedupedAgainst: string | null;
}

export interface SkippedBackground {
  sourceFile: string;
  reason: string;
}

export interface ImportBackgroundsResult {
  imported: ImportedBackground[];
  skipped: SkippedBackground[];
}

export interface ImportBackgroundsIO {
  normalizeImage: NormalizeImageFn;
  listDir: (dir: string) => string[];
  ensureDir: (dir: string) => void;
  writeFile: (p: string, data: Buffer) => void;
}

const RECOGNIZED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export async function importBackgrounds(sourceDir: string, outDir: string, io: ImportBackgroundsIO): Promise<ImportBackgroundsResult> {
  const entries = [...io.listDir(sourceDir)].sort();
  io.ensureDir(outDir);

  const imported: ImportedBackground[] = [];
  const skipped: SkippedBackground[] = [];
  // shortHash -> first sourceFile that produced it (for dedupedAgainst).
  const seenHashes = new Map<string, string>();

  for (const entry of entries) {
    const ext = path.extname(entry).toLowerCase();
    if (!RECOGNIZED_EXTENSIONS.has(ext)) {
      skipped.push({
        sourceFile: entry,
        reason: `unrecognized extension "${ext || "(none)"}" — expected one of ${[...RECOGNIZED_EXTENSIONS].join(", ")}`,
      });
      continue;
    }

    let normalized: NormalizedImage;
    try {
      normalized = await io.normalizeImage(path.join(sourceDir, entry));
    } catch (err) {
      skipped.push({ sourceFile: entry, reason: `failed to decode: ${err instanceof Error ? err.message : String(err)}` });
      continue;
    }

    const shortHash = sha256(normalized.png).slice(0, 16);
    const outputFileName = `${shortHash}.png`;
    const dedupedAgainst = seenHashes.get(shortHash) ?? null;
    if (dedupedAgainst === null) seenHashes.set(shortHash, entry);

    // Content-hash naming makes a two-different-contents collision
    // structurally impossible: the output name IS the content's hash, so
    // writing here can only ever overwrite bytes identical to what's
    // already there (same hash -> same content, by construction) — never
    // a different file silently clobbering another's data.
    io.writeFile(path.join(outDir, outputFileName), normalized.png);

    imported.push({
      sourceFile: entry,
      outputFileName,
      contentHash: shortHash,
      width: normalized.width,
      height: normalized.height,
      dedupedAgainst,
    });
  }

  return { imported, skipped };
}
