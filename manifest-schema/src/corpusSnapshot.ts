import { z } from "zod";

/**
 * SPEC-APP.md §7.10: how a corpus source's text ships in a knowledge pack —
 * full text, a paraphrase, or a retrieval stub (title/tags/source_url only,
 * full text fetched on demand).
 */
export const ShippingModeSchema = z.enum(["verbatim", "paraphrase", "stub"]);
export type ShippingMode = z.infer<typeof ShippingModeSchema>;

/**
 * Mirrors pipeline/src/types.ts's SourceManifestEntry — shippingMode and
 * skipped are REQUIRED (the exporter always stamps both, never omits them
 * even when nothing was skipped), note is optional.
 */
export const SourceManifestEntrySchema = z.object({
  name: z.string(),
  count: z.number().int().nonnegative(),
  shippingMode: ShippingModeSchema,
  skipped: z.number().int().nonnegative(),
  note: z.string().optional(),
});
export type SourceManifestEntry = z.infer<typeof SourceManifestEntrySchema>;

export const DocumentVersionSchema = z.object({
  document: z.string(),
  file: z.string(),
  lastModified: z.string(),
  lines: z.number().int().nonnegative().nullable(),
});
export type DocumentVersion = z.infer<typeof DocumentVersionSchema>;

/**
 * Corpus snapshot manifest (SPEC-APP.md §4 Glossary "Corpus snapshot",
 * §7.11): an immutable, hashed export of the corpus, stamped with CR
 * version, latest set code, and per-source shipping-mode disclosure.
 */
export const CorpusSnapshotManifestSchema = z.object({
  schemaVersion: z.string().min(1),
  exportDate: z.string(),
  contentHash: z.string(),
  chunkCount: z.number().int().nonnegative(),
  crVersion: z.string(),
  documentVersions: z.array(DocumentVersionSchema),
  latestSetCode: z.string(),
  /** ISO 8601 timestamp of when the live Card Legality Policy page was last
   * fetched, or the literal "unknown" when no rules-KB legality record was
   * available at export time. REQUIRED — the exporter always stamps one or
   * the other, never omits the field (SPEC-APP.md §4 Glossary). */
  legalityPolicyFetchedAt: z.string().min(1),
  loreCommit: z.string(),
  sources: z.array(SourceManifestEntrySchema),
});
export type CorpusSnapshotManifest = z.infer<typeof CorpusSnapshotManifestSchema>;
