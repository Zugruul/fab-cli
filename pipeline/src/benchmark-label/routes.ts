/**
 * Pure(ish) request-handling logic for the labeling tool's local API
 * (issue #258) — plain node:fs calls, no HTTP/JSON-transport concerns, so
 * these are directly unit-testable against a tmp directory (mirrors
 * benchmark/loadSet.ts's testing style) without spinning up a real server.
 * server.ts wires these onto actual HTTP routes.
 */
import fs from "node:fs";
import path from "node:path";
import { validatePhotoLabel } from "../benchmark/validate.js";
import { SCENE_TYPES } from "../benchmark/types.js";
import type { PhotoLabel, SceneType } from "../benchmark/types.js";

const PHOTO_EXTENSIONS = [".jpg", ".jpeg", ".png", ".heic", ".webp"];

/** Thrown when a client-supplied relative path would resolve outside its
 * configured base directory (issue #258 security fix, PR #262 review
 * BLOCKER 1) — a `?file=` containing `../` (or an absolute path) must never
 * be allowed to read/write anywhere the running process can reach. Callers
 * (server.ts) map this to an HTTP 400, distinct from a genuine server
 * error (500). */
export class PathEscapeError extends Error {
  constructor(relPath: string) {
    super(`"${relPath}" escapes the configured directory`);
    this.name = "PathEscapeError";
  }
}

/**
 * Realpath of the nearest EXISTING ancestor of `p` (itself, if it exists —
 * or the closest existing parent directory otherwise). Needed because two
 * legitimate cases have nothing to realpath at `p` itself: a PUT target
 * file that doesn't exist yet (that's the whole point of PUT), and — on a
 * brand-new checkout — `labelsDir` itself, before anything has ever been
 * written into it. Falls back to `p` unchanged only if it climbs all the
 * way to the filesystem root without finding anything real (a pathological
 * input, not a real deployment).
 */
function realpathOfNearestExistingAncestor(p: string): string {
  let current = p;
  for (;;) {
    try {
      return fs.realpathSync(current);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
}

/**
 * Resolves `relPath` against `baseDir` and throws PathEscapeError unless
 * the result stays inside `baseDir` — checked TWO ways, because they catch
 * different attacks:
 *
 * 1. Lexical: compares fully resolved, normalized absolute path STRINGS.
 *    Deliberately not a naive substring/regex check for "..", which
 *    `%2e%2e`-style encoding (already decoded by the time this runs) or
 *    path normalization tricks can defeat. Also rejects an absolute
 *    `relPath`: path.resolve(base, "/etc/passwd") returns "/etc/passwd"
 *    (Node's documented "later absolute argument wins" behavior), which
 *    this recognizes as outside baseDir.
 *
 * 2. Real (PR #262 review round 3): path.resolve in step 1 is PURELY
 *    LEXICAL — it never touches the filesystem, so it has no idea whether
 *    a path component is a symlink. But fs.readFileSync/writeFileSync
 *    (what getLabel/putLabel actually call) DO follow symlinks. The
 *    reviewer proved this live: a symlink planted AT the read target
 *    itself, and a symlink planted as an ANCESTOR DIRECTORY of a write
 *    target — neither request contained ".." or an absolute path at all,
 *    so step 1 alone passed both. This step compares fs.realpathSync of
 *    the nearest EXISTING ancestor on each side instead, which resolves
 *    through any symlink to its real destination.
 */
export function containWithinDir(baseDir: string, relPath: string): string {
  const resolvedBase = path.resolve(baseDir);
  const resolved = path.resolve(resolvedBase, relPath);
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
    throw new PathEscapeError(relPath);
  }

  const realBase = realpathOfNearestExistingAncestor(resolvedBase);
  const realTarget = realpathOfNearestExistingAncestor(resolved);
  if (realTarget !== realBase && !realTarget.startsWith(realBase + path.sep)) {
    throw new PathEscapeError(relPath);
  }

  return resolved;
}

export interface PhotoListEntry {
  /** Path of the photo file, relative to photosDir (e.g. "single/photo-001.jpg"). */
  fileName: string;
  /** First path segment, when it's one of the protocol's known scene
   * types — a labeling convenience default, never authoritative (the
   * label's own sceneType field is, per benchmark-labeling.md). */
  sceneTypeGuess: SceneType | null;
  labeled: boolean;
  quadCount: number;
}

function isKnownSceneType(s: string): s is SceneType {
  return (SCENE_TYPES as readonly string[]).includes(s);
}

function labelPathFor(labelsDir: string, relPhotoPath: string): string {
  const labelRelPath = relPhotoPath.replace(/\.[^./]+$/, ".json");
  return containWithinDir(labelsDir, labelRelPath);
}

function* walkPhotoFiles(dir: string, base = dir): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkPhotoFiles(full, base);
    } else if (entry.isFile() && PHOTO_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
      yield path.relative(base, full).replace(/\\/g, "/");
    }
  }
}

/** Walks photosDir for photo files and pairs each with its label file
 * (same relative-path convention as benchmark/loadSet.ts), reporting
 * labeled state + quad count so the UI can show per-photo progress and
 * which photos still need work. A label file that fails to parse/validate
 * is reported as unlabeled (quadCount 0) rather than crashing the listing —
 * the photo is still walkable/openable so the human can fix it. */
export function listPhotos(photosDir: string, labelsDir: string): PhotoListEntry[] {
  const entries: PhotoListEntry[] = [];
  for (const relPath of walkPhotoFiles(photosDir)) {
    const firstSegment = relPath.split("/")[0];
    const sceneTypeGuess = isKnownSceneType(firstSegment) ? firstSegment : null;

    const label = getLabel(labelsDir, relPath);
    entries.push({
      fileName: relPath,
      sceneTypeGuess,
      labeled: label !== null,
      quadCount: label?.quads.length ?? 0,
    });
  }
  return entries.sort((a, b) => a.fileName.localeCompare(b.fileName));
}

/** Returns the existing label for a photo, or null when none exists yet
 * (a fresh photo) or the existing file doesn't parse/validate (treated the
 * same as "nothing to resume" — the human starts labeling fresh rather
 * than the tool crashing on a corrupt file; the corrupt file is left
 * on disk untouched, not overwritten, until the human explicitly saves). */
export function getLabel(labelsDir: string, relPhotoPath: string): PhotoLabel | null {
  const labelPath = labelPathFor(labelsDir, relPhotoPath);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(labelPath, "utf8"));
  } catch {
    return null;
  }
  const result = validatePhotoLabel(raw);
  return result.valid ? result.label : null;
}

export type PutLabelResult = { ok: true } | { ok: false; errors: string[] };

/**
 * Validates a label via the EXISTING validatePhotoLabel (never
 * reimplemented/loosened here) and writes it verbatim on success —
 * verbatim meaning byte-for-byte from the validated object, with NO
 * coordinate transformation of any kind. This is the single place that
 * would silently corrupt the benchmark if it ever clamped out-of-bounds
 * (amodal) corners to the photo's pixel bounds — see
 * test/benchmarkLabel.routes.test.ts's AMODAL test, which is the merge
 * blocker this function must never regress.
 *
 * An invalid label writes nothing to disk — "never write a label the
 * validator would reject" (issue #258 DoD).
 */
export function putLabel(labelsDir: string, relPhotoPath: string, rawLabel: unknown): PutLabelResult {
  const result = validatePhotoLabel(rawLabel);
  if (!result.valid) return { ok: false, errors: result.errors };

  const labelPath = labelPathFor(labelsDir, relPhotoPath);
  fs.mkdirSync(path.dirname(labelPath), { recursive: true });
  fs.writeFileSync(labelPath, JSON.stringify(result.label, null, 2) + "\n");
  return { ok: true };
}
