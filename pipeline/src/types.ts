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

export interface SourceManifestEntry {
  name: string;
  count: number;
  shippingMode: ShippingMode;
  /** Present when the source degraded gracefully (e.g. kb/rules absent). */
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
