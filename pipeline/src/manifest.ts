import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { Chunk, CorpusSnapshotManifest, DocumentVersion, SourceManifestEntry } from "./types.js";

const SCHEMA_VERSION = "0.1.0"; // local/plain for now — APP-016 formalizes a shared schema package

/**
 * Order-independent content hash over `{chunk_id, text}` for every chunk:
 * sorted by chunk_id before hashing so re-exports of an unchanged corpus
 * (regardless of source-scan order) produce an identical hash, and any
 * chunk's text (or the chunk set itself) changing produces a different one.
 * Deliberately excludes title/source/links/tags/manifest metadata (export
 * date, etc.) — this is a *content* hash, not a full-manifest hash.
 */
export function contentHash(chunks: Chunk[]): string {
  const sorted = [...chunks]
    .map((c) => ({ chunk_id: c.chunk_id, text: c.text }))
    .sort((a, b) => (a.chunk_id < b.chunk_id ? -1 : a.chunk_id > b.chunk_id ? 1 : 0));
  const hash = createHash("sha256");
  hash.update(JSON.stringify(sorted));
  return hash.digest("hex");
}

const VERSIONS_LINE_RE = /^(en-fab-([a-z]+)\.txt)\s+last-modified:\s+(.+?)\s+lines:\s+(\d+)\s*$/;

export interface VersionsInfo {
  documentVersions: DocumentVersion[];
  crVersion: string;
}

/**
 * Parses `third_party/fab-rules/VERSIONS.txt` (produced by `fab-cli rules
 * update-docs`). There is no explicit rules-version number upstream, so
 * `crVersion` honestly reports the CR document's last-modified date as the
 * best available version proxy — never fabricated, never defaulted to a
 * made-up semver.
 */
export function readVersionsTxt(versionsTxtPath: string): VersionsInfo | null {
  let raw: string;
  try {
    raw = fs.readFileSync(versionsTxtPath, "utf8");
  } catch {
    return null;
  }

  const documentVersions: DocumentVersion[] = [];
  for (const line of raw.split("\n")) {
    const match = VERSIONS_LINE_RE.exec(line.trim());
    if (!match) continue;
    const [, file, document, lastModified, lines] = match;
    documentVersions.push({ document, file, lastModified, lines: parseInt(lines, 10) });
  }

  const cr = documentVersions.find((d) => d.document === "cr");
  return { documentVersions, crVersion: cr?.lastModified ?? "unknown" };
}

interface SetPrinting {
  initial_release_date?: string;
}
interface SetEntry {
  id: string;
  printings?: SetPrinting[];
}

/**
 * Derives "latest set code" as the set whose printings include the most
 * recent `initial_release_date` across the-fab-cube's set.json — the same
 * dataset already vendored for card data, so no new source is introduced.
 * Any parse/read failure records "unknown" rather than guessing, per
 * SPEC-APP.md APP-010's brief ("record 'unknown' honestly").
 */
export function readLatestSetCode(setJsonPath: string): string {
  try {
    const raw = fs.readFileSync(setJsonPath, "utf8");
    const sets = JSON.parse(raw) as SetEntry[];
    let latestId = "unknown";
    let latestDate = 0;
    for (const set of sets) {
      for (const printing of set.printings ?? []) {
        if (!printing.initial_release_date) continue;
        const t = Date.parse(printing.initial_release_date);
        if (!Number.isNaN(t) && t > latestDate) {
          latestDate = t;
          latestId = set.id;
        }
      }
    }
    return latestId;
  } catch {
    return "unknown";
  }
}

/**
 * `git -C <fabloreDir> rev-parse HEAD`, falling back to the fablore commit
 * embedded in a lore page's own frontmatter (self-reported provenance) when
 * the submodule isn't checked out, and to "unknown" only if neither works.
 */
export function readLoreCommit(fabloreDir: string, fallback: string | null): string {
  try {
    const out = execFileSync("git", ["-C", fabloreDir, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (out) return out;
  } catch {
    // fall through to fallback
  }
  return fallback ?? "unknown";
}

export interface BuildManifestOptions {
  chunks: Chunk[];
  versionsTxtPath: string;
  setJsonPath: string;
  loreCommit: string;
  sources: SourceManifestEntry[];
  now?: () => string;
}

export function buildManifest(opts: BuildManifestOptions): CorpusSnapshotManifest {
  const versions = readVersionsTxt(opts.versionsTxtPath);
  const now = opts.now ?? (() => new Date().toISOString());

  return {
    schemaVersion: SCHEMA_VERSION,
    exportDate: now(),
    contentHash: contentHash(opts.chunks),
    chunkCount: opts.chunks.length,
    crVersion: versions?.crVersion ?? "unknown",
    documentVersions: versions?.documentVersions ?? [],
    latestSetCode: readLatestSetCode(opts.setJsonPath),
    loreCommit: opts.loreCommit,
    sources: opts.sources,
  };
}
