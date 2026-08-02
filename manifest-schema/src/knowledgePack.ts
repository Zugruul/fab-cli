import { z } from "zod";

const SHA256_RE = /^[0-9a-f]{64}$/i;

export const KnowledgePackIndexFileSchema = z.object({
  name: z.string(),
  sha256: z.string().regex(SHA256_RE, "sha256 must be a 64-character hex string"),
});
export type KnowledgePackIndexFile = z.infer<typeof KnowledgePackIndexFileSchema>;

/**
 * Knowledge pack manifest (SPEC-APP.md §4 Glossary "Knowledge pack").
 * retrievalFloor and oodThreshold are REQUIRED, not defaulted in-app: §9.7
 * requires the retrieval-confidence abstention floor to be "calibrated per
 * embedder version against the eval set (not hardcoded)", and §10.9's OOD
 * fast-path threshold is likewise a separate calibrated value "well below
 * the abstention floor" — both must ship with every knowledge pack.
 */
export const KnowledgePackManifestSchema = z.object({
  schemaVersion: z.string().min(1),
  version: z.string(),
  corpusSnapshotHash: z.string(),
  textEmbedderVersion: z.string(),
  visionEmbedderVersion: z.string(),
  printingRegistryVersion: z.string(),
  retrievalFloor: z.number(),
  oodThreshold: z.number(),
  chunkCount: z.number().int().nonnegative(),
  indexFiles: z.array(KnowledgePackIndexFileSchema),
});
export type KnowledgePackManifest = z.infer<typeof KnowledgePackManifestSchema>;
