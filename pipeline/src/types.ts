/**
 * A normalized, retrievable/citable unit of the FAB knowledge corpus
 * (SPEC-APP.md §4 Glossary "Corpus", §7.1).
 */
export interface Chunk {
  /** Stable across re-exports of an unchanged source note (see each source
   * module for its id scheme) — derived from source path/slug identity,
   * never from content, so unrelated edits don't reassign ids. */
  chunk_id: string;
  text: string;
  title: string;
  /** Free-text provenance: a note's frontmatter `source`, a rules chunk's
   * `sourceUrl`, or a lore page's `source_url`. */
  source: string;
  /** Deduped, sorted `[[slug]]` zettel references (+ frontmatter refs where
   * the source format carries them). */
  links: string[];
  tags: string[];
}

export type ShippingMode = "verbatim" | "paraphrase" | "stub";

/**
 * A single source entry (a note, a rules-index chunk, a lore page) that
 * failed to export and was skipped rather than aborting its whole source.
 * `path` identifies the entry (file path, or `<indexPath>#<n>` for a
 * malformed rules-index array entry); `reason` is the raw error message.
 */
export interface SkippedEntry {
  path: string;
  reason: string;
}

export interface SourceManifestEntry {
  name: string;
  count: number;
  shippingMode: ShippingMode;
  /** Count of entries skipped for this source (broken symlinks, corrupt
   * records, unreadable files) — always present, 0 when nothing was
   * skipped, so a degraded run is visible in the manifest rather than
   * silently under-counting. */
  skipped: number;
  /** Human-readable explanation covering whichever of: the source's §7.10
   * pending-rights-assessment status (always present), a source-level
   * grace condition (e.g. kb/rules absent or corrupt), and/or a summary of
   * skipped entries with reasons — joined together when more than one
   * applies. */
  note?: string;
}

export interface DocumentVersion {
  document: string;
  file: string;
  lastModified: string;
  lines: number | null;
}

export interface CorpusSnapshotManifest {
  schemaVersion: string;
  exportDate: string;
  contentHash: string;
  chunkCount: number;
  crVersion: string;
  documentVersions: DocumentVersion[];
  latestSetCode: string;
  loreCommit: string;
  sources: SourceManifestEntry[];
}
